// src/services/tip_processor.ts - Enhanced tip processing service
import type { Client } from "discord.js";
import { prisma } from "./db.js";
import { getActiveTokens, toAtomicDirect, formatAmount, bigToDecDirect, decToBigDirect } from "./token.js";
import { transferToken, debitToken, creditToken, ensureUser } from "./balances.js";
import { getConfig } from "../config.js";
import { getActiveAd } from "./ads.js";
import { userHasActiveTaxFreeTier } from "./tiers.js";
import { RoleTaxBenefitService } from "./role_tax_benefits.js";
import { groupTipEmbed } from "../ui/embeds.js";
import { groupTipClaimRow } from "../ui/components.js";
import { scheduleGroupTipExpiry } from "../features/group_tip_expiry.js";
import { RefundEngine } from "./refund_engine.js";
import { getDiscordClient } from "./discord_users.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export interface TipData {
  amount: number;
  tipType: string;
  targetUserId?: string;
  note: string;
  tokenId: number;
  duration?: number;
  userId: string;
  guildId: string | null;
  channelId: string | null;
  fromPenguBook?: boolean; // Flag to indicate tip came from PenguBook
}

export interface TipResult {
  success: boolean;
  message: string;
  details?: string;
  publicMessage?: any;
}

export async function processTip(data: TipData, client: Client): Promise<TipResult> {
  try {
    // Validate token
    const tokens = await getActiveTokens();
    const token = tokens.find(t => t.id === data.tokenId);
    if (!token || !token.active) {
      return {
        success: false,
        message: "Invalid token",
        details: "The selected token is not available."
      };
    }

    // Get/create sender user
    const fromUser = await prisma.user.upsert({
      where: { discordId: data.userId },
      update: {},
      create: { discordId: data.userId },
    });

    // Calculate fees with role-based tax benefits
    const cfg = await getConfig();

    // Check for best available tax benefit (tier, role, or referral)
    const bestTaxBenefit = await RoleTaxBenefitService.getBestTaxBenefit(
      fromUser.id,
      data.guildId || '',
      data.userId
    );

    // Apply tax benefit or fallback to existing logic
    let feeBpsNum = token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;

    if (bestTaxBenefit) {
      // Apply percentage reduction (exemptionRate = 0-100% reduction)
      const taxReduction = bestTaxBenefit.exemptionRate / 100;
      feeBpsNum = Math.round(feeBpsNum * (1 - taxReduction));
    } else {
      // Fallback to existing tier check for backward compatibility
      const taxFree = await userHasActiveTaxFreeTier(fromUser.id);
      feeBpsNum = taxFree ? 0 : feeBpsNum;
    }
    const feeBps = BigInt(feeBpsNum);
    const atomic = toAtomicDirect(data.amount, token.decimals);

    // SECURITY: Prevent precision overflow attacks with minimum amount threshold
    if (atomic < BigInt(1000)) {
      return {
        success: false,
        message: "Amount too small",
        details: "Minimum tip amount is 0.000001 tokens to prevent fee bypass attacks."
      };
    }

    // SECURITY: Calculate base fee
    let feeAtomic = (atomic * feeBps) / 10000n;

    // SECURITY: Apply ceiling division first (round up, favor platform)
    const remainder = (atomic * feeBps) % 10000n;
    if (remainder > 0n) {
      feeAtomic = feeAtomic + 1n; // Round up to next atomic unit
    }

    // SECURITY: Force minimum fee only if calculated fee is still 0 (prevent fee bypass)
    if (feeBps > 0n && feeAtomic === 0n) {
      feeAtomic = 1n; // Minimum fee enforcement
    }

    if (data.tipType === "direct") {
      // Handle direct tip
      if (!data.targetUserId) {
        return {
          success: false,
          message: "Missing recipient",
          details: "Target user is required for direct tips."
        };
      }

      // Validate target user
      const targetUser = await client.users.fetch(data.targetUserId).catch(() => null);
      if (!targetUser || targetUser.bot) {
        return {
          success: false,
          message: "Invalid recipient",
          details: "Cannot tip bots or invalid users."
        };
      }

      if (data.targetUserId === data.userId) {
        return {
          success: false,
          message: "Cannot tip yourself",
          details: "Use group tips to share with everyone!"
        };
      }

      // Create/get target user
      const toUser = await prisma.user.upsert({
        where: { discordId: data.targetUserId },
        update: {},
        create: { discordId: data.targetUserId },
      });

      // Process the transfer
      await transferToken(data.userId, data.targetUserId, token.id, atomic, "TIP", {
        guildId: data.guildId,
        feeAtomic,
        note: data.note,
      });

      // Calculate tax savings and transparency data
      const originalFeeBps = token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;
      const originalFee = (atomic * BigInt(originalFeeBps)) / 10000n;
      const taxSavedAtomic = originalFee - feeAtomic;
      const totalDeducted = atomic + feeAtomic;

      // Calculate exemption rate applied (keep as percentage, not BPS)
      const exemptionRateBps = bestTaxBenefit?.exemptionRate
        ? Math.round(bestTaxBenefit.exemptionRate) // Store as percentage (0-100)
        : 0;

      // Record tip (using current schema)
      const createdTip = await prisma.tip.create({
        data: {
          fromUserId: fromUser.id,
          toUserId: toUser.id,
          tokenId: token.id,
          amountAtomic: atomic.toString(), // Store atomic units, not converted amounts
          feeAtomic: feeAtomic.toString(), // Store atomic units, not converted amounts
          taxAtomic: feeAtomic.toString(), // Store tax amount for refunds
          note: data.note,
          status: "COMPLETED",
          // Analytics tracking
          roleBenefitUsed: bestTaxBenefit?.label || null,
          taxSavedAtomic: taxSavedAtomic.toString(),
          guildId: data.guildId,
          // Tax transparency tracking (NEW)
          taxRateAppliedBps: Number(feeBps),
          exemptionRateBps: exemptionRateBps,
          totalDeductedAtomic: totalDeducted.toString(),
        },
      });

      // Create PenguBook message if this tip came from PenguBook
      if (data.fromPenguBook) {
        try {
          await prisma.penguBookMessage.create({
            data: {
              fromUserId: fromUser.id,
              toUserId: toUser.id,
              tipId: createdTip.id,
              message: data.note || `Received ${formatAmount(atomic, token)} tip via PenguBook!`
            }
          });
          console.log(`📬 PenguBook message created for tip ${createdTip.id}: ${data.userId} → ${data.targetUserId}`);
        } catch (messageError) {
          console.error("Failed to create PenguBook message:", messageError);
          // Don't fail the tip for message creation errors
        }
      }

      // Update referral progress if user was referred
      try {
        const { updateReferralProgress } = await import("./referrals.js");
        await updateReferralProgress(data.userId, Number(bigToDecDirect(atomic, token.decimals)));
      } catch (referralError) {
        console.error("Failed to update referral progress:", referralError);
        // Don't fail the tip for referral tracking errors
      }

      // Record transaction
      await prisma.transaction.create({
        data: {
          type: "TIP",
          userId: fromUser.id,
          otherUserId: toUser.id,
          tokenId: token.id,
          amount: bigToDecDirect(atomic, token.decimals),
          fee: bigToDecDirect(feeAtomic, token.decimals),
          guildId: data.guildId,
          metadata: JSON.stringify({ kind: "DIRECT_TIP" }),
        },
      });

      // Build transparent tip message with full tax breakdown
      let publicLine = `💸 <@${data.userId}> tipped ${formatAmount(atomic, token)} to <@${data.targetUserId}>`;

      // Always show the sender's perspective with transparency
      if (feeAtomic > 0n) {
        publicLine += ` (+ ${formatAmount(feeAtomic, token)} tax = ${formatAmount(totalDeducted, token)} total deducted)`;
      } else if (bestTaxBenefit && bestTaxBenefit.exemptionRate > 0) {
        publicLine += ` (tax-free via **${bestTaxBenefit.label}**)`;
      }

      // Add ENHANCED role benefit notification with social proof
      if (bestTaxBenefit && bestTaxBenefit.exemptionRate > 0 && taxSavedAtomic > 0n) {
        const benefitEmoji = bestTaxBenefit.source.startsWith('tier:') ? '⭐' : '🎭';
        const benefitMessage = await formatBenefitNotification(
          bestTaxBenefit,
          'tax',
          formatAmount(taxSavedAtomic, token),
          token.symbol,
          data.guildId
        );
        publicLine += `\n${benefitEmoji} ${benefitMessage}`;
      }

      // Add note if provided
      if (data.note) {
        publicLine += `\n📝 ${data.note}`;
      }

      // Check for tip achievements (async, don't block response)
      (async () => {
        try {
          const { checkTipAchievements, checkEngagementAchievements } = await import("./streaks.js");
          const { queueAchievementNotifications } = await import("./notifications.js");

          // Get user's total tip count
          const tipCount = await prisma.tip.count({
            where: { fromUserId: fromUser.id, status: 'COMPLETED' }
          });

          const tipAmount = Number(bigToDecDirect(atomic, token.decimals));

          const [tipAchievements, engagementAchievements] = await Promise.all([
            checkTipAchievements(fromUser.id, tipCount, tipAmount),
            checkEngagementAchievements(fromUser.id)
          ]);

          const allAchievements = [...tipAchievements, ...engagementAchievements];
          if (allAchievements.length > 0) {
            queueAchievementNotifications(data.userId, allAchievements, "tip");
          }
        } catch (error) {
          console.error("Error checking tip achievements:", error);
        }
      })();

      // Create tier purchase button for FOMO conversion if tier benefits were shown
      const tierButton = await createTierPurchaseButton(bestTaxBenefit, data.userId);

      return {
        success: true,
        message: "Direct tip sent successfully!",
        details: `Sent ${formatAmount(atomic, token)} to ${targetUser.displayName || targetUser.username}`,
        publicMessage: {
          content: publicLine,
          components: tierButton ? [tierButton] : undefined,
          allowedMentions: { users: [data.userId, data.targetUserId] },
        }
      };

    } else if (data.tipType === "group") {
      // Handle group tip
      if (!data.duration || data.duration < 1 || data.duration > 60) {
        return {
          success: false,
          message: "Invalid duration",
          details: "Duration must be between 1-60 minutes."
        };
      }

      // Validate channel BEFORE any operations
      if (!data.channelId) {
        return {
          success: false,
          message: "Cannot post group tip",
          details: "Channel not available for posting group tip."
        };
      }

      const channel = await client.channels.fetch(data.channelId).catch(() => null);
      if (!channel?.isTextBased() || !("send" in channel)) {
        return {
          success: false,
          message: "Cannot post group tip",
          details: "Cannot post in this channel type."
        };
      }

      // CRITICAL: Check balance BEFORE any state changes
      const fromUser = await ensureUser(data.userId);
      const currentBalance = await prisma.userBalance.findUnique({
        where: { userId_tokenId: { userId: fromUser.id, tokenId: token.id } }
      });

      const balanceAtomic = currentBalance ? decToBigDirect(currentBalance.amount, token.decimals) : 0n;
      if (balanceAtomic < atomic + feeAtomic) {
        return {
          success: false,
          message: "Insufficient balance",
          details: `You don't have enough ${data.amount} tokens + fees for this group tip.`
        };
      }

      const expiresAt = new Date(Date.now() + data.duration * 60 * 1000);

      // Use atomic transaction for group tip creation
      const result = await prisma.$transaction(async (tx) => {
        // Import the transaction-safe version
        const { debitTokenTx } = await import("./balances.js");

        // Charge user for group tip (after confirming balance)
        await debitTokenTx(tx, data.userId, token.id, atomic + feeAtomic, "TIP", { guildId: data.guildId });

        // Create the group tip (using current schema)
        const groupTip = await tx.groupTip.create({
          data: {
            creatorId: fromUser.id,
            tokenId: token.id,
            totalAmount: data.amount.toString(),
            taxAtomic: feeAtomic.toString(), // Store tax amount for refunds
            duration: (data.duration || 5) * 60,
            status: "ACTIVE",
            expiresAt,
            guildId: data.guildId,
          },
        });

        // Record fee transaction if applicable
        if (feeAtomic > 0n) {
          await tx.transaction.create({
            data: {
              type: "TIP",
              userId: fromUser.id,
              tokenId: token.id,
              amount: bigToDecDirect(atomic, token.decimals),
              fee: bigToDecDirect(feeAtomic, token.decimals),
              guildId: data.guildId,
              metadata: JSON.stringify({ groupTipId: groupTip.id, kind: "GROUP_TIP_CREATE" }),
            },
          });
        }

        return groupTip;
      });

      // Create embed with ads
      const ad = await getActiveAd();
      const embed = groupTipEmbed({
        creator: `<@${data.userId}>`,
        amount: formatAmount(atomic, token),
        expiresAt: result.expiresAt,
        claimCount: 0,
        claimedBy: [],
        note: data.note,
        ad: ad ?? undefined,
      });

      try {
        const msg = await (channel as any).send({
          embeds: [embed],
          components: [groupTipClaimRow(result.id, false)],
        });

        // Update group tip with message info
        await prisma.groupTip.update({
          where: { id: result.id },
          data: { 
            messageId: msg.id, 
            channelId: msg.channelId
          },
        });

        // Schedule expiry
        await scheduleGroupTipExpiry(client, result.id);

        const totalLine = `${formatAmount(atomic, token)} + fee ${formatAmount(feeAtomic, token)} = ${formatAmount(atomic + feeAtomic, token)}`;

        // Add role benefit notification for group tip creator
        let successMessage = "Group tip created successfully!";
        let detailsMessage = `Created ${data.duration}-minute group tip for ${formatAmount(atomic, token)}\nYou were charged ${totalLine}`;

        if (bestTaxBenefit && bestTaxBenefit.exemptionRate > 0) {
          const originalFee = (atomic * BigInt(token.tipFeeBps ?? cfg?.tipFeeBps ?? 100)) / 10000n;
          const savedAmount = originalFee - feeAtomic;

          if (savedAmount > 0n) {
            const benefitEmoji = bestTaxBenefit.source.startsWith('tier:') ? '⭐' : '🎭';
            const benefitMessage = await formatBenefitNotification(
              bestTaxBenefit,
              'tax',
              formatAmount(savedAmount, token),
              token.symbol,
              data.guildId
            );
            detailsMessage += `\n${benefitEmoji} ${benefitMessage}`;
          }
        }

        return {
          success: true,
          message: successMessage,
          details: detailsMessage
        };

      } catch (error: any) {
        console.error("Failed to post group tip message:", error);
        
        // If posting fails, refund the user using centralized engine
        try {
          const refundResult = await RefundEngine.refundContribution(result.id);
          if (!refundResult.success) {
            console.error("Failed to refund group tip:", refundResult.message);
          }
          
          // Mark group tip as failed (use string since schema expects string)
          await prisma.groupTip.update({
            where: { id: result.id },
            data: { status: "FAILED" }
          });
          
        } catch (refundError: any) {
          console.error("Failed to refund group tip:", refundError);
        }

        return {
          success: false,
          message: "Group tip posting failed",
          details: "Could not post group tip message. Your balance has been refunded."
        };
      }

    } else {
      return {
        success: false,
        message: "Invalid tip type",
        details: "Tip type must be 'direct' or 'group'."
      };
    }

  } catch (error: any) {
    console.error("Tip processing error:", error);
    
    // Handle common errors with user-friendly messages
    if (/insufficient|fund/i.test(error?.message || "")) {
      return {
        success: false,
        message: "Insufficient balance",
        details: `You don't have enough ${data.amount} tokens + fees for this tip.`
      };
    }

    return {
      success: false,
      message: "Tip processing failed",
      details: error?.message || String(error)
    };
  }
}

/**
 * Enhanced benefit notification formatter with social proof
 * Shows which specific role or tier granted the benefit
 */
async function formatBenefitNotification(
  benefit: { source: string; label: string; exemptionRate: number },
  benefitType: 'tax' | 'rake',
  savedAmount: string,
  tokenSymbol: string,
  guildId: string | null
): Promise<string> {
  try {
    // Parse benefit source to determine type and get real name
    if (benefit.source.startsWith('role:')) {
      const roleId = benefit.source.substring(5);

      // Try to get Discord role name for enhanced social proof
      if (guildId) {
        try {
          const discord = getDiscordClient();
          if (discord) {
            const guild = await discord.guilds.fetch(guildId);
            const role = await guild?.roles.fetch(roleId);
            if (role && role.name) {
              // Enhanced role notification with actual role name
              const benefitAction = benefitType === 'tax' ? 'tax-free tipping' : 'reduced house fees';
              const cleanRoleName = role.name.trim();
              if (cleanRoleName.length > 0 && cleanRoleName !== roleId) {
                return `Your **${cleanRoleName}** role granted ${benefitAction}! Saved ${savedAmount} ${tokenSymbol}`;
              }
            }
          }
        } catch (error) {
          // Log only meaningful errors, not rate limits or temporary issues
          if (!String(error).includes('rate limit') && !String(error).includes('timeout')) {
            console.warn('Discord API unavailable for role name lookup:', String(error));
          }
        }
      }

      // Fallback to label if Discord lookup fails
      const benefitAction = benefitType === 'tax' ? 'tax exemption' : 'rake reduction';
      return `Your **${benefit.label}** granted ${benefitAction}! Saved ${savedAmount} ${tokenSymbol}`;

    } else if (benefit.source.startsWith('tier:')) {
      // Tier notification
      const benefitAction = benefitType === 'tax' ? 'tax-free tipping' : 'reduced gaming fees';
      return `Your **${benefit.label}** perks granted ${benefitAction}! Saved ${savedAmount} ${tokenSymbol}`;

    } else {
      // Generic fallback
      const benefitAction = benefitType === 'tax' ? 'saved you tax' : 'reduced your fees';
      return `Your **${benefit.label}** ${benefitAction}! Saved ${savedAmount} ${tokenSymbol}`;
    }
  } catch (error) {
    console.error('Error formatting benefit notification:', error);
    // Simple fallback
    return `Your **${benefit.label}** saved you ${savedAmount} ${tokenSymbol}!`;
  }
}

/**
 * Create tier purchase FOMO button when tier benefits are displayed publicly
 * This creates social proof and conversion funnel for tier sales
 */
async function createTierPurchaseButton(
  benefit: { source: string; label: string; exemptionRate: number } | null,
  userDiscordId: string
): Promise<ActionRowBuilder<ButtonBuilder> | null> {
  try {
    // Only show button for tier-based benefits (not role-based)
    if (!benefit || !benefit.source.startsWith('tier:')) {
      return null;
    }

    // Check if the user already has an active tier (don't show button to existing members)
    const user = await prisma.user.findUnique({
      where: { discordId: userDiscordId },
      include: {
        tierMemberships: {
          where: {
            status: 'ACTIVE',
            expiresAt: { gt: new Date() }
          },
          include: { tier: true }
        }
      }
    });

    // Don't show button to users who already have active tier memberships
    if (user && user.tierMemberships.length > 0) {
      return null;
    }

    // Get available tiers for purchase button
    const availableTiers = await prisma.tier.findMany({
      where: { active: true },
      include: {
        prices: {
          include: { token: true }
        }
      },
      orderBy: { priceAmount: 'asc' }, // Show cheapest tier first
      take: 1 // Just show one tier option to keep it simple
    });

    if (availableTiers.length === 0) {
      return null;
    }

    const tier = availableTiers[0];
    const price = tier.prices[0]; // Get first price option

    if (!price) return null;

    // Create FOMO button with attractive messaging
    const savingsPercent = Math.round((benefit.exemptionRate || 0));
    const tierButton = new ButtonBuilder()
      .setCustomId(`pip:tier_purchase:${tier.id}`)
      .setLabel(`💎 Get ${tier.name} - Save ${savingsPercent}% on fees`)
      .setStyle(ButtonStyle.Success)
      .setEmoji("⭐");

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(tierButton);

    return row;

  } catch (error) {
    console.error('Error creating tier purchase button:', error);
    return null;
  }
}