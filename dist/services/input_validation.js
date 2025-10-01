import { CriteriaRegistry } from "./achievement_criteria_engine.js";
function validateAchievementData(data) {
  const errors = [];
  const {
    name,
    description,
    criteriaType,
    criteriaData,
    threshold,
    iconEmoji,
    badgeColor,
    category,
    rarity
  } = data;
  if (!name || typeof name !== "string") {
    errors.push("Name is required and must be a string");
  } else if (name.length > 100) {
    errors.push("Name must be 100 characters or less");
  } else if (name.length < 3) {
    errors.push("Name must be at least 3 characters");
  }
  if (!description || typeof description !== "string") {
    errors.push("Description is required and must be a string");
  } else if (description.length > 500) {
    errors.push("Description must be 500 characters or less");
  } else if (description.length < 10) {
    errors.push("Description must be at least 10 characters");
  }
  if (threshold === void 0 || threshold === null) {
    errors.push("Threshold is required");
  } else {
    const numThreshold = Number(threshold);
    if (isNaN(numThreshold) || numThreshold < 1 || numThreshold > 1e6) {
      errors.push("Threshold must be a number between 1 and 1,000,000");
    }
  }
  if (!criteriaType || typeof criteriaType !== "string") {
    errors.push("Criteria type is required");
  } else {
    const evaluator = CriteriaRegistry.get(criteriaType);
    if (!evaluator) {
      errors.push(`Invalid criteria type: ${criteriaType}`);
    } else if (criteriaData) {
      const dataSize = JSON.stringify(criteriaData).length;
      if (dataSize > 5e3) {
        errors.push("Criteria data too large (max 5KB)");
      }
      const criteriaValidation = evaluator.validateConfig(criteriaData);
      if (!criteriaValidation.valid) {
        errors.push(...criteriaValidation.errors.map((err) => `Criteria: ${err}`));
      }
    }
  }
  const validCategories = ["streaks", "tips", "deposits", "referrals", "veteran", "special", "community"];
  if (category && !validCategories.includes(category)) {
    errors.push(`Category must be one of: ${validCategories.join(", ")}`);
  }
  const validRarities = ["common", "uncommon", "rare", "epic", "legendary"];
  if (rarity && !validRarities.includes(rarity)) {
    errors.push(`Rarity must be one of: ${validRarities.join(", ")}`);
  }
  if (iconEmoji && typeof iconEmoji === "string") {
    const emojiRegex = /^[\u{1F600}-\u{1F64F}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{1F1E0}-\u{1F1FF}]+$/u;
    if (!emojiRegex.test(iconEmoji)) {
      errors.push("Icon emoji must be a valid Unicode emoji");
    }
  }
  if (badgeColor && typeof badgeColor === "string") {
    const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (!hexColorRegex.test(badgeColor)) {
      errors.push("Badge color must be a valid hex color (e.g., #FF0000)");
    }
  }
  return { valid: errors.length === 0, errors };
}
function validateBulkOperation(data) {
  const errors = [];
  const { operation, achievementIds, data: opData } = data;
  const validOperations = ["enable", "disable", "update-category", "update-rarity", "update-threshold"];
  if (!operation || !validOperations.includes(operation)) {
    errors.push(`Operation must be one of: ${validOperations.join(", ")}`);
  }
  if (!achievementIds || !Array.isArray(achievementIds)) {
    errors.push("Achievement IDs must be an array");
  } else {
    if (achievementIds.length === 0) {
      errors.push("At least one achievement ID is required");
    } else if (achievementIds.length > 100) {
      errors.push("Cannot operate on more than 100 achievements at once");
    }
    for (const id of achievementIds) {
      if (!Number.isInteger(id) || id <= 0) {
        errors.push(`Invalid achievement ID: ${id}`);
        break;
      }
    }
  }
  if (opData) {
    switch (operation) {
      case "update-category":
        const validCategories = ["streaks", "tips", "deposits", "referrals", "veteran", "special", "community"];
        if (!opData.category || !validCategories.includes(opData.category)) {
          errors.push(`Category must be one of: ${validCategories.join(", ")}`);
        }
        break;
      case "update-rarity":
        const validRarities = ["common", "uncommon", "rare", "epic", "legendary"];
        if (!opData.rarity || !validRarities.includes(opData.rarity)) {
          errors.push(`Rarity must be one of: ${validRarities.join(", ")}`);
        }
        break;
      case "update-threshold":
        const threshold = Number(opData.threshold);
        if (isNaN(threshold) || threshold < 1 || threshold > 1e6) {
          errors.push("Threshold must be a number between 1 and 1,000,000");
        }
        break;
    }
  }
  return { valid: errors.length === 0, errors };
}
function validateManualOperation(data) {
  const errors = [];
  const { operation, userDiscordId, achievementId, reason } = data;
  const validOperations = ["grant", "revoke"];
  if (!operation || !validOperations.includes(operation)) {
    errors.push(`Operation must be one of: ${validOperations.join(", ")}`);
  }
  if (!userDiscordId || typeof userDiscordId !== "string") {
    errors.push("User Discord ID is required");
  } else if (!/^\d{17,20}$/.test(userDiscordId)) {
    errors.push("Invalid Discord ID format (must be 17-20 digits)");
  }
  if (!Number.isInteger(achievementId) || achievementId <= 0) {
    errors.push("Invalid achievement ID");
  }
  if (!reason || typeof reason !== "string") {
    errors.push("Reason is required for manual operations");
  } else if (reason.length > 200) {
    errors.push("Reason must be 200 characters or less");
  }
  return { valid: errors.length === 0, errors };
}
function sanitizeString(input) {
  if (typeof input !== "string") return "";
  return input.trim().replace(/[<>\"'&]/g, "").substring(0, 1e3);
}
function sanitizeNumber(input, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const num = Number(input);
  if (isNaN(num)) return min;
  return Math.max(min, Math.min(max, Math.floor(num)));
}
function sanitizeDiscordId(input) {
  if (typeof input !== "string") return null;
  const cleaned = input.trim();
  if (!/^\d{17,20}$/.test(cleaned)) return null;
  return cleaned;
}
function createRateLimitConfig() {
  return {
    windowMs: 15 * 60 * 1e3,
    // 15 minutes
    max: 100,
    // limit each IP to 100 requests per windowMs
    message: {
      error: "Too many admin requests, please try again later",
      retryAfter: "15 minutes"
    },
    standardHeaders: true,
    legacyHeaders: false
  };
}
export {
  createRateLimitConfig,
  sanitizeDiscordId,
  sanitizeNumber,
  sanitizeString,
  validateAchievementData,
  validateBulkOperation,
  validateManualOperation
};
//# sourceMappingURL=input_validation.js.map
