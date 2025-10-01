// src/services/group_tip_contributions.ts - Secure group tip contribution system
import { prisma } from "./db.js";
import { userHasActiveTaxFreeTier } from "./tiers.js";
import { formatDecimal, decToBigDirect, formatAmount, toAtomicDirect, bigToDecDirect } from "./token.js";
import { PENGUIN_ERRORS, createPenguinSuccess } from "../utils/penguin_messages.js";
import { getConfig } from "../config.js";
import { RoleTaxBenefitService } from "./role_tax_benefits.js";
import { logCompleteTransaction } from "./tx_logger.js";
// Rate limiting: Track recent contribution attempts
const recentContributions = new Map();
const CONTRIBUTION_COOLDOWN = 5000; // 5 seconds between contributions per user
// Validation constants
const MIN_CONTRIBUTION = 1; // Minimum 1 atomic unit
const MAX_CONTRIBUTION_RATIO = 10; // Can't contribute more than 10x the original amount
// Main function to add contribution to group tip
export async function addGroupTipContribution(groupTipId, contributorDiscordId, contributionAmount) {
    // 1. RATE LIMITING
    const rateLimitKey = `${contributorDiscordId}:${groupTipId}`;
    const lastContribution = recentContributions.get(rateLimitKey) || 0;
    const now = Date.now();
    if (now - lastContribution < CONTRIBUTION_COOLDOWN) {
        const remainingMs = CONTRIBUTION_COOLDOWN - (now - lastContribution);
        return {
            success: false,
            message: PENGUIN_ERRORS.rateLimited(Math.ceil(remainingMs / 1000)),
            error: "Rate limited"
        };
    }
    // 2. INPUT VALIDATION
    if (!Number.isInteger(contributionAmount) || contributionAmount < MIN_CONTRIBUTION) {
        return {
            success: false,
            message: PENGUIN_ERRORS.invalidContributionAmount(),
            error: "Invalid amount"
        };
    }
    try {
        // 3. ATOMIC TRANSACTION with comprehensive validation
        const result = await prisma.$transaction(async (tx) => {
            // Get group tip with lock
            const groupTip = await tx.groupTip.findUnique({
                where: { id: groupTipId },
                include: {
                    Creator: true,
                    Token: true,
                    contributions: true // Include existing contributions
                }
            });
            if (!groupTip) {
                throw new Error("Group tip not found");
            }
            // 4. BUSINESS LOGIC VALIDATION
            // Check if group tip is still active
            if (groupTip.status !== "ACTIVE") {
                throw new Error("This group tip is no longer active");
            }
            // Check if expired
            const now = new Date();
            if (groupTip.expiresAt.getTime() < now.getTime()) {
                throw new Error("This group tip has expired");
            }
            // Prevent creator from contributing to their own tip
            if (groupTip.Creator && groupTip.Creator.discordId === contributorDiscordId) {
                throw new Error("You cannot contribute to your own group tip");
            }
            // 5. CONTRIBUTION LIMITS
            const originalAmountAtomic = decToBigDirect(Number(groupTip.totalAmount), groupTip.Token.decimals);
            const maxContributionAtomic = originalAmountAtomic * BigInt(MAX_CONTRIBUTION_RATIO);
            if (BigInt(contributionAmount) > maxContributionAtomic) {
                throw new Error(`Maximum contribution is ${formatAmount(maxContributionAtomic, groupTip.Token)}`);
            }
            // 6. USER SETUP
            const contributor = await tx.user.upsert({
                where: { discordId: contributorDiscordId },
                update: {},
                create: { discordId: contributorDiscordId }
            });
            // 7. CHECK FOR EXISTING CONTRIBUTION (prevent duplicates)
            const existingContribution = await tx.groupTipContribution.findUnique({
                where: {
                    groupTipId_contributorId: {
                        groupTipId: groupTipId,
                        contributorId: contributor.id
                    }
                }
            });
            if (existingContribution) {
                throw new Error("You have already contributed to this group tip");
            }
            // 7b. CHECK IF USER HAS CLAIMED (claimers can't contribute)
            const existingClaim = await tx.groupTipClaim.findUnique({
                where: {
                    groupTipId_userId: {
                        groupTipId: groupTipId,
                        userId: contributor.id
                    }
                }
            });
            if (existingClaim) {
                throw new Error("You cannot add fish to this group tip because you've already claimed from it! Choose one: give or receive, but not both! 🐧");
            }
            // 8. TAX CALCULATION (same logic as regular tips)
            const cfg = await getConfig();
            const atomic = toAtomicDirect(contributionAmount, groupTip.Token.decimals);
            // Check for role-based tax benefits first
            const bestTaxBenefit = await RoleTaxBenefitService.getBestTaxBenefit(contributor.id, groupTip.guildId || '', contributorDiscordId);
            // Apply tax benefit or fallback to existing logic
            let feeBpsNum = groupTip.Token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;
            if (bestTaxBenefit) {
                // Apply percentage reduction (exemptionRate = 0-100% reduction)
                const taxReduction = bestTaxBenefit.exemptionRate / 100;
                feeBpsNum = Math.round(feeBpsNum * (1 - taxReduction));
            }
            else {
                // Fallback to existing tier check for backward compatibility
                const taxFree = await userHasActiveTaxFreeTier(contributor.id);
                feeBpsNum = taxFree ? 0 : feeBpsNum;
            }
            const feeBps = BigInt(feeBpsNum);
            const feeAtomic = (atomic * feeBps) / 10000n;
            const taxAmount = Number(bigToDecDirect(feeAtomic, groupTip.Token.decimals));
            const totalCost = contributionAmount + taxAmount;
            // 9. BALANCE VALIDATION
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
            // 10. FINANCIAL TRANSACTION
            // Calculate atomic amounts for transaction logging
            const contributionAtomic = toAtomicDirect(contributionAmount, groupTip.Token.decimals);
            const feeAtomicBigint = toAtomicDirect(taxAmount, groupTip.Token.decimals);
            const totalCostAtomic = contributionAtomic + feeAtomicBigint;
            // Generate idempotency key
            const idempotencyKey = `group_contribution_${groupTipId}_${contributor.id}_${Date.now()}`;
            // Log transaction with BalanceDelta
            await logCompleteTransaction(tx, {
                operation: 'GROUP_TIP_CONTRIBUTION',
                userId: contributor.id,
                guildId: groupTip.guildId || undefined,
                balanceChanges: [
                    {
                        tokenId: groupTip.tokenId,
                        userId: contributor.id,
                        amountDelta: -totalCostAtomic, // Debit contributor (amount + fee)
                        reason: 'group_tip_contribution'
                    },
                    {
                        tokenId: groupTip.tokenId,
                        userId: undefined, // Fee to house
                        amountDelta: feeAtomicBigint,
                        reason: 'group_tip_fee'
                    }
                ],
                metadata: {
                    groupTipId,
                    contributionAmount,
                    taxAmount,
                    creatorId: groupTip.creatorId
                },
                idempotencyKey,
                source: 'BOT'
            });
            // Deduct total cost from user balance
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
            // Record the contribution
            const contribution = await tx.groupTipContribution.create({
                data: {
                    groupTipId: groupTipId,
                    contributorId: contributor.id,
                    amount: contributionAmount,
                    taxPaid: taxAmount,
                    status: 'COMPLETED'
                }
            });
            // Update group tip totals
            const updatedGroupTip = await tx.groupTip.update({
                where: { id: groupTipId },
                data: {
                    contributionsTotal: { increment: contributionAmount },
                    contributorsCount: { increment: 1 }
                }
            });
            // Calculate new total including contributions
            const newTotalAmount = Number(groupTip.totalAmount) + Number(updatedGroupTip.contributionsTotal);
            return {
                contribution,
                newTotalAmount,
                taxPaid: taxAmount,
                tokenSymbol: groupTip.Token.symbol,
                groupTip: updatedGroupTip
            };
        });
        // 12. UPDATE RATE LIMITING
        recentContributions.set(rateLimitKey, now);
        // 13. SUCCESS RESPONSE
        const newTotalFormatted = formatDecimal(result.newTotalAmount, result.tokenSymbol);
        const contributionFormatted = formatDecimal(contributionAmount, result.tokenSymbol);
        const taxPaidFormatted = result.taxPaid > 0 ? formatDecimal(result.taxPaid, result.tokenSymbol) : null;
        let successMessage = createPenguinSuccess("Contribution Added! 🐟➕", `You've added ${contributionFormatted} to the group tip! The total pool is now ${newTotalFormatted}. Thank you for making the colony feast bigger! 🎉`, { personality: 'excited', emoji: '🐧' });
        if (taxPaidFormatted) {
            successMessage += `\n\n💰 Tax paid: ${taxPaidFormatted}`;
        }
        // Note: XP/social points are awarded only during finalization to prevent gaming
        // (contributors get rewards only if the tip is successfully claimed)
        return {
            success: true,
            message: successMessage,
            newTotal: newTotalFormatted,
            taxPaid: taxPaidFormatted || undefined
        };
    }
    catch (error) {
        console.error("Group tip contribution error:", error);
        return {
            success: false,
            message: PENGUIN_ERRORS.contributionFailed(error.message),
            error: error.message
        };
    }
}
// Get contributors for a group tip
export async function getGroupTipContributors(groupTipId) {
    try {
        const contributions = await prisma.groupTipContribution.findMany({
            where: {
                groupTipId,
                status: 'COMPLETED'
            },
            include: {
                contributor: true
            },
            orderBy: { createdAt: 'asc' }
        });
        // Note: We can't get Discord usernames without the client
        // This would need to be enriched at the display layer
        return contributions.map(contrib => ({
            name: `User-${contrib.contributor.discordId.slice(-4)}`, // Placeholder
            amount: contrib.amount.toString(),
            taxPaid: contrib.taxPaid.toString()
        }));
    }
    catch (error) {
        console.error("Error getting group tip contributors:", error);
        return [];
    }
}
// Calculate total group tip amount including contributions
export async function getGroupTipTotal(groupTipId) {
    try {
        const groupTip = await prisma.groupTip.findUnique({
            where: { id: groupTipId },
            include: { Token: true }
        });
        if (!groupTip)
            return null;
        const originalAmount = Number(groupTip.totalAmount);
        const contributionsTotal = Number(groupTip.contributionsTotal || 0);
        const grandTotal = originalAmount + contributionsTotal;
        return {
            originalAmount: formatDecimal(originalAmount, groupTip.Token.symbol),
            contributionsTotal: formatDecimal(contributionsTotal, groupTip.Token.symbol),
            grandTotal: formatDecimal(grandTotal, groupTip.Token.symbol),
            contributorsCount: groupTip.contributorsCount || 0
        };
    }
    catch (error) {
        console.error("Error calculating group tip total:", error);
        return null;
    }
}
