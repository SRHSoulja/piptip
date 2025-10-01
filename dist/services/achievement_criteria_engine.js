import { prisma } from "./db.js";
import { startTimer, endTimer } from "./performance.js";
class CriteriaRegistry {
  static evaluators = /* @__PURE__ */ new Map();
  static register(evaluator) {
    this.evaluators.set(evaluator.type, evaluator);
    console.log(`\u{1F4CB} Registered criteria evaluator: ${evaluator.type}`);
  }
  static get(type) {
    return this.evaluators.get(type) || null;
  }
  static getAll() {
    return Array.from(this.evaluators.values());
  }
  static getTypes() {
    return Array.from(this.evaluators.keys());
  }
}
class CountEvaluator {
  type = "count";
  async evaluate(userId, criteriaData) {
    const { field, table, filter = {} } = criteriaData;
    startTimer("count_evaluation");
    try {
      if (this.canUseUserStats(table, field)) {
        const result2 = await this.evaluateFromUserStats(userId, field);
        endTimer("count_evaluation", { method: "userStats", result: result2 });
        return result2;
      }
      const result = await this.evaluateFromTable(userId, table, field, filter);
      endTimer("count_evaluation", { method: "directQuery", result });
      return result;
    } catch (error) {
      endTimer("count_evaluation", { success: false, error: String(error) });
      throw error;
    }
  }
  canUseUserStats(table, field) {
    const optimizedFields = {
      "matches": ["won", "lost", "tied"],
      "tips": ["sent", "received"],
      "deposits": ["count", "total"]
    };
    return optimizedFields[table]?.includes(field) || false;
  }
  async evaluateFromUserStats(userId, field) {
    const stats = await prisma.userStats.findUnique({
      where: { userId }
    });
    if (!stats) return 0;
    const fieldMapping = {
      "won": "matchesWon",
      "lost": "matchesLost",
      "tied": "matchesTied",
      "sent": "totalTipsSent",
      "received": "totalTipsReceived"
    };
    const mappedField = fieldMapping[field];
    if (!mappedField) return 0;
    const value = stats[mappedField];
    return typeof value === "number" ? value : Number(value) || 0;
  }
  async evaluateFromTable(userId, table, field, filter) {
    console.warn(`Direct table query not implemented for ${table}.${field}`);
    return 0;
  }
  getDescription(criteriaData) {
    const { field, table } = criteriaData;
    return `Count of ${field} in ${table}`;
  }
  validateConfig(criteriaData) {
    const errors = [];
    if (!criteriaData.field) errors.push("field is required");
    if (!criteriaData.table) errors.push("table is required");
    return { valid: errors.length === 0, errors };
  }
}
class SumEvaluator {
  type = "sum";
  async evaluate(userId, criteriaData) {
    const { field, table, filter = {} } = criteriaData;
    startTimer("sum_evaluation");
    try {
      let result = 0;
      if (table === "tips" && field === "amount_sent") {
        const stats = await prisma.userStats.findUnique({
          where: { userId },
          select: { totalTipAmountSent: true }
        });
        result = Number(stats?.totalTipAmountSent || 0);
      } else if (table === "tips" && field === "amount_received") {
        const stats = await prisma.userStats.findUnique({
          where: { userId },
          select: { totalTipAmountReceived: true }
        });
        result = Number(stats?.totalTipAmountReceived || 0);
      } else if (table === "deposits" && field === "total_amount") {
        const stats = await prisma.userStats.findUnique({
          where: { userId },
          select: { totalDeposited: true }
        });
        result = Number(stats?.totalDeposited || 0);
      } else {
        console.warn(`Sum evaluation not optimized for ${table}.${field}`);
        result = 0;
      }
      endTimer("sum_evaluation", { table, field, result });
      return result;
    } catch (error) {
      endTimer("sum_evaluation", { success: false, error: String(error) });
      throw error;
    }
  }
  getDescription(criteriaData) {
    const { field, table } = criteriaData;
    return `Sum of ${field} in ${table}`;
  }
  validateConfig(criteriaData) {
    const errors = [];
    if (!criteriaData.field) errors.push("field is required");
    if (!criteriaData.table) errors.push("table is required");
    return { valid: errors.length === 0, errors };
  }
}
class StreakEvaluator {
  type = "streak";
  async evaluate(userId, criteriaData) {
    const { field } = criteriaData;
    startTimer("streak_evaluation");
    try {
      const streak = await prisma.userStreak.findUnique({
        where: { userId },
        select: {
          currentWins: true,
          longestWins: true
        }
      });
      if (!streak) {
        endTimer("streak_evaluation", { result: 0 });
        return 0;
      }
      let result = 0;
      switch (field) {
        case "current_wins":
          result = streak.currentWins;
          break;
        case "longest_wins":
          result = streak.longestWins;
          break;
        default:
          console.warn(`Unknown streak field: ${field}`);
          result = 0;
      }
      endTimer("streak_evaluation", { field, result });
      return result;
    } catch (error) {
      endTimer("streak_evaluation", { success: false, error: String(error) });
      throw error;
    }
  }
  getDescription(criteriaData) {
    const { field } = criteriaData;
    return `Streak: ${field}`;
  }
  validateConfig(criteriaData) {
    const errors = [];
    const validFields = ["current_wins", "longest_wins"];
    if (!criteriaData.field) {
      errors.push("field is required");
    } else if (!validFields.includes(criteriaData.field)) {
      errors.push(`field must be one of: ${validFields.join(", ")}`);
    }
    return { valid: errors.length === 0, errors };
  }
}
class UniqueEvaluator {
  type = "unique";
  async evaluate(userId, criteriaData) {
    const { field } = criteriaData;
    startTimer("unique_evaluation");
    try {
      let result = 0;
      switch (field) {
        case "tip_recipients":
          const stats = await prisma.userStats.findUnique({
            where: { userId },
            select: { uniqueRecipients: true }
          });
          result = stats?.uniqueRecipients || 0;
          break;
        case "tip_tokens":
          const uniqueTokens = await prisma.tip.groupBy({
            by: ["tokenId"],
            where: {
              fromUserId: userId,
              status: "COMPLETED"
            }
          });
          result = uniqueTokens.length;
          break;
        default:
          console.warn(`Unique evaluation not implemented for field: ${field}`);
          result = 0;
      }
      endTimer("unique_evaluation", { field, result });
      return result;
    } catch (error) {
      endTimer("unique_evaluation", { success: false, error: String(error) });
      throw error;
    }
  }
  getDescription(criteriaData) {
    const { field } = criteriaData;
    return `Unique count of ${field}`;
  }
  validateConfig(criteriaData) {
    const errors = [];
    const validFields = ["tip_recipients", "tip_tokens", "referrals"];
    if (!criteriaData.field) {
      errors.push("field is required");
    } else if (!validFields.includes(criteriaData.field)) {
      errors.push(`field must be one of: ${validFields.join(", ")}`);
    }
    return { valid: errors.length === 0, errors };
  }
}
class CustomEvaluator {
  type = "custom";
  async evaluate(userId, criteriaData, eventData) {
    const { function: functionName, params = {} } = criteriaData;
    startTimer("custom_evaluation");
    try {
      let result = 0;
      switch (functionName) {
        case "depositsThisWeek":
          result = await this.calculateDepositsThisWeek(userId, params);
          break;
        case "consecutiveDaysTipping":
          result = await this.calculateConsecutiveDaysTipping(userId, params);
          break;
        case "daysSinceJoined":
          result = await this.calculateDaysSinceJoined(userId, params);
          break;
        case "tipsToUniqueUsersThisMonth":
          result = await this.calculateTipsToUniqueUsersThisMonth(userId, params);
          break;
        default:
          console.warn(`Custom function not implemented: ${functionName}`);
          result = 0;
      }
      endTimer("custom_evaluation", { function: functionName, result });
      return result;
    } catch (error) {
      endTimer("custom_evaluation", { success: false, error: String(error) });
      throw error;
    }
  }
  async calculateDepositsThisWeek(userId, params) {
    const weekStart = /* @__PURE__ */ new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    console.warn("depositsThisWeek calculation requires deposit tracking implementation");
    return 0;
  }
  async calculateConsecutiveDaysTipping(userId, params) {
    const { days: targetDays } = params;
    const tips = await prisma.tip.findMany({
      where: {
        fromUserId: userId,
        status: "COMPLETED"
      },
      select: {
        createdAt: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });
    if (tips.length === 0) return 0;
    const tipDays = /* @__PURE__ */ new Set();
    for (const tip of tips) {
      const dayKey = tip.createdAt.toISOString().split("T")[0];
      tipDays.add(dayKey);
    }
    const sortedDays = Array.from(tipDays).sort().reverse();
    let consecutiveDays = 0;
    let currentDate = /* @__PURE__ */ new Date();
    for (const dayStr of sortedDays) {
      const dayDate = new Date(String(dayStr));
      const daysDiff = Math.floor((currentDate.getTime() - dayDate.getTime()) / (1e3 * 60 * 60 * 24));
      if (daysDiff === consecutiveDays) {
        consecutiveDays++;
        currentDate = dayDate;
      } else {
        break;
      }
    }
    return consecutiveDays;
  }
  async calculateDaysSinceJoined(userId, params) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true }
    });
    if (!user) return 0;
    const daysDiff = Math.floor(
      (Date.now() - user.createdAt.getTime()) / (1e3 * 60 * 60 * 24)
    );
    return daysDiff;
  }
  async calculateTipsToUniqueUsersThisMonth(userId, params) {
    const monthStart = /* @__PURE__ */ new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const uniqueRecipients = await prisma.tip.groupBy({
      by: ["toUserId"],
      where: {
        fromUserId: userId,
        createdAt: { gte: monthStart },
        status: "COMPLETED"
      }
    });
    return uniqueRecipients.length;
  }
  getDescription(criteriaData) {
    const { function: functionName, params = {} } = criteriaData;
    return `Custom: ${functionName}(${JSON.stringify(params)})`;
  }
  validateConfig(criteriaData) {
    const errors = [];
    const validFunctions = [
      "depositsThisWeek",
      "consecutiveDaysTipping",
      "daysSinceJoined",
      "tipsToUniqueUsersThisMonth"
    ];
    if (!criteriaData.function) {
      errors.push("function is required");
    } else if (!validFunctions.includes(criteriaData.function)) {
      errors.push(`function must be one of: ${validFunctions.join(", ")}`);
    }
    return { valid: errors.length === 0, errors };
  }
}
function initializeCriteriaRegistry() {
  CriteriaRegistry.register(new CountEvaluator());
  CriteriaRegistry.register(new SumEvaluator());
  CriteriaRegistry.register(new StreakEvaluator());
  CriteriaRegistry.register(new UniqueEvaluator());
  CriteriaRegistry.register(new CustomEvaluator());
  console.log(`\u{1F527} Criteria registry initialized with ${CriteriaRegistry.getAll().length} evaluators`);
}
async function evaluateAchievementCriteria(userId, criteriaType, criteriaData, eventData) {
  const evaluator = CriteriaRegistry.get(criteriaType);
  if (!evaluator) {
    throw new Error(`Unknown criteria type: ${criteriaType}`);
  }
  const validation = evaluator.validateConfig(criteriaData);
  if (!validation.valid) {
    throw new Error(`Invalid criteria config: ${validation.errors.join(", ")}`);
  }
  return await evaluator.evaluate(userId, criteriaData, eventData);
}
function getCriteriaDescription(criteriaType, criteriaData) {
  const evaluator = CriteriaRegistry.get(criteriaType);
  if (!evaluator) {
    return `Unknown criteria: ${criteriaType}`;
  }
  return evaluator.getDescription(criteriaData);
}
export {
  CriteriaRegistry,
  evaluateAchievementCriteria,
  getCriteriaDescription,
  initializeCriteriaRegistry
};
//# sourceMappingURL=achievement_criteria_engine.js.map
