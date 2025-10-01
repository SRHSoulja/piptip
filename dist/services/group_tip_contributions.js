import { prisma } from "./db.js";
import { userHasActiveTaxFreeTier } from "./tiers.js";
import { formatDecimal, decToBigDirect, formatAmount, toAtomicDirect, bigToDecDirect } from "./token.js";
import { PENGUIN_ERRORS, createPenguinSuccess } from "../utils/penguin_messages.js";
import { getConfig } from "../config.js";
import { RoleTaxBenefitService } from "./role_tax_benefits.js";
import { logCompleteTransaction } from "./tx_logger.js";
const recentContributions = /* @__PURE__ */ new Map();
const CONTRIBUTION_COOLDOWN = 5e3;
const MIN_CONTRIBUTION = 1;
const MAX_CONTRIBUTION_RATIO = 10;
async function addGroupTipContribution(groupTipId, contributorDiscordId, contributionAmount) {
  const rateLimitKey = `${contributorDiscordId}:${groupTipId}`;
  const lastContribution = recentContributions.get(rateLimitKey) || 0;
  const now = Date.now();
  if (now - lastContribution < CONTRIBUTION_COOLDOWN) {
    const remainingMs = CONTRIBUTION_COOLDOWN - (now - lastContribution);
    return {
      success: false,
      message: PENGUIN_ERRORS.rateLimited(Math.ceil(remainingMs / 1e3)),
      error: "Rate limited"
    };
  }
  if (!Number.isInteger(contributionAmount) || contributionAmount < MIN_CONTRIBUTION) {
    return {
      success: false,
      message: PENGUIN_ERRORS.invalidContributionAmount(),
      error: "Invalid amount"
    };
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const groupTip = await tx.groupTip.findUnique({
        where: { id: groupTipId },
        include: {
          Creator: true,
          Token: true,
          contributions: true
          // Include existing contributions
        }
      });
      if (!groupTip) {
        throw new Error("Group tip not found");
      }
      if (groupTip.status !== "ACTIVE") {
        throw new Error("This group tip is no longer active");
      }
      const now2 = /* @__PURE__ */ new Date();
      if (groupTip.expiresAt.getTime() < now2.getTime()) {
        throw new Error("This group tip has expired");
      }
      if (groupTip.Creator && groupTip.Creator.discordId === contributorDiscordId) {
        throw new Error("You cannot contribute to your own group tip");
      }
      const originalAmountAtomic = decToBigDirect(Number(groupTip.totalAmount), groupTip.Token.decimals);
      const maxContributionAtomic = originalAmountAtomic * BigInt(MAX_CONTRIBUTION_RATIO);
      if (BigInt(contributionAmount) > maxContributionAtomic) {
        throw new Error(`Maximum contribution is ${formatAmount(maxContributionAtomic, groupTip.Token)}`);
      }
      const contributor = await tx.user.upsert({
        where: { discordId: contributorDiscordId },
        update: {},
        create: { discordId: contributorDiscordId }
      });
      const existingContribution = await tx.groupTipContribution.findUnique({
        where: {
          groupTipId_contributorId: {
            groupTipId,
            contributorId: contributor.id
          }
        }
      });
      if (existingContribution) {
        throw new Error("You have already contributed to this group tip");
      }
      const existingClaim = await tx.groupTipClaim.findUnique({
        where: {
          groupTipId_userId: {
            groupTipId,
            userId: contributor.id
          }
        }
      });
      if (existingClaim) {
        throw new Error("You cannot add fish to this group tip because you've already claimed from it! Choose one: give or receive, but not both! \u{1F427}");
      }
      const cfg = await getConfig();
      const atomic = toAtomicDirect(contributionAmount, groupTip.Token.decimals);
      const bestTaxBenefit = await RoleTaxBenefitService.getBestTaxBenefit(
        contributor.id,
        groupTip.guildId || "",
        contributorDiscordId
      );
      let feeBpsNum = groupTip.Token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;
      if (bestTaxBenefit) {
        const taxReduction = bestTaxBenefit.exemptionRate / 100;
        feeBpsNum = Math.round(feeBpsNum * (1 - taxReduction));
      } else {
        const taxFree = await userHasActiveTaxFreeTier(contributor.id);
        feeBpsNum = taxFree ? 0 : feeBpsNum;
      }
      const feeBps = BigInt(feeBpsNum);
      const feeAtomic = atomic * feeBps / 10000n;
      const taxAmount = Number(bigToDecDirect(feeAtomic, groupTip.Token.decimals));
      const totalCost = contributionAmount + taxAmount;
      const userBalance = await tx.userBalance.findUnique({
        where: {
          userId_tokenId: {
            userId: contributor.id,
            tokenId: groupTip.tokenId
          }
        }
      });
      const currentBalance = Number(userBalance?.amount || 0);
      if (currentBalance < totalCost) {
        const needed = formatDecimal(totalCost, groupTip.Token.symbol);
        const available = formatDecimal(currentBalance, groupTip.Token.symbol);
        throw new Error(`Insufficient balance. You need ${needed} but have ${available} (including tax)`);
      }
      const contributionAtomic = toAtomicDirect(contributionAmount, groupTip.Token.decimals);
      const feeAtomicBigint = toAtomicDirect(taxAmount, groupTip.Token.decimals);
      const totalCostAtomic = contributionAtomic + feeAtomicBigint;
      const idempotencyKey = `group_contribution_${groupTipId}_${contributor.id}_${Date.now()}`;
      await logCompleteTransaction(tx, {
        operation: "GROUP_TIP_CONTRIBUTION",
        userId: contributor.id,
        guildId: groupTip.guildId || void 0,
        balanceChanges: [
          {
            tokenId: groupTip.tokenId,
            userId: contributor.id,
            amountDelta: -totalCostAtomic,
            // Debit contributor (amount + fee)
            reason: "group_tip_contribution"
          },
          {
            tokenId: groupTip.tokenId,
            userId: void 0,
            // Fee to house
            amountDelta: feeAtomicBigint,
            reason: "group_tip_fee"
          }
        ],
        metadata: {
          groupTipId,
          contributionAmount,
          taxAmount,
          creatorId: groupTip.creatorId
        },
        idempotencyKey,
        source: "BOT"
      });
      await tx.userBalance.update({
        where: {
          userId_tokenId: {
            userId: contributor.id,
            tokenId: groupTip.tokenId
          }
        },
        data: {
          amount: { decrement: totalCost }
        }
      });
      const contribution = await tx.groupTipContribution.create({
        data: {
          groupTipId,
          contributorId: contributor.id,
          amount: contributionAmount,
          taxPaid: taxAmount,
          status: "COMPLETED"
        }
      });
      const updatedGroupTip = await tx.groupTip.update({
        where: { id: groupTipId },
        data: {
          contributionsTotal: { increment: contributionAmount },
          contributorsCount: { increment: 1 }
        }
      });
      const newTotalAmount = Number(groupTip.totalAmount) + Number(updatedGroupTip.contributionsTotal);
      return {
        contribution,
        newTotalAmount,
        taxPaid: taxAmount,
        tokenSymbol: groupTip.Token.symbol,
        groupTip: updatedGroupTip
      };
    });
    recentContributions.set(rateLimitKey, now);
    const newTotalFormatted = formatDecimal(result.newTotalAmount, result.tokenSymbol);
    const contributionFormatted = formatDecimal(contributionAmount, result.tokenSymbol);
    const taxPaidFormatted = result.taxPaid > 0 ? formatDecimal(result.taxPaid, result.tokenSymbol) : null;
    let successMessage = createPenguinSuccess(
      "Contribution Added! \u{1F41F}\u2795",
      `You've added ${contributionFormatted} to the group tip! The total pool is now ${newTotalFormatted}. Thank you for making the colony feast bigger! \u{1F389}`,
      { personality: "excited", emoji: "\u{1F427}" }
    );
    if (taxPaidFormatted) {
      successMessage += `

\u{1F4B0} Tax paid: ${taxPaidFormatted}`;
    }
    return {
      success: true,
      message: successMessage,
      newTotal: newTotalFormatted,
      taxPaid: taxPaidFormatted || void 0
    };
  } catch (error) {
    console.error("Group tip contribution error:", error);
    return {
      success: false,
      message: PENGUIN_ERRORS.contributionFailed(error.message),
      error: error.message
    };
  }
}
async function getGroupTipContributors(groupTipId) {
  try {
    const contributions = await prisma.groupTipContribution.findMany({
      where: {
        groupTipId,
        status: "COMPLETED"
      },
      include: {
        contributor: true
      },
      orderBy: { createdAt: "asc" }
    });
    return contributions.map((contrib) => ({
      name: `User-${contrib.contributor.discordId.slice(-4)}`,
      // Placeholder
      amount: contrib.amount.toString(),
      taxPaid: contrib.taxPaid.toString()
    }));
  } catch (error) {
    console.error("Error getting group tip contributors:", error);
    return [];
  }
}
async function getGroupTipTotal(groupTipId) {
  try {
    const groupTip = await prisma.groupTip.findUnique({
      where: { id: groupTipId },
      include: { Token: true }
    });
    if (!groupTip) return null;
    const originalAmount = Number(groupTip.totalAmount);
    const contributionsTotal = Number(groupTip.contributionsTotal || 0);
    const grandTotal = originalAmount + contributionsTotal;
    return {
      originalAmount: formatDecimal(originalAmount, groupTip.Token.symbol),
      contributionsTotal: formatDecimal(contributionsTotal, groupTip.Token.symbol),
      grandTotal: formatDecimal(grandTotal, groupTip.Token.symbol),
      contributorsCount: groupTip.contributorsCount || 0
    };
  } catch (error) {
    console.error("Error calculating group tip total:", error);
    return null;
  }
}
export {
  addGroupTipContribution,
  getGroupTipContributors,
  getGroupTipTotal
};
//# sourceMappingURL=group_tip_contributions.js.map
