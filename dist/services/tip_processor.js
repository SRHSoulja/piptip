import { prisma } from "./db.js";
import { getActiveTokens, toAtomicDirect, formatAmount, formatAmountWithUSD, bigToDecDirect, decToBigDirect } from "./token.js";
import { transferToken, ensureUser } from "./balances.js";
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
async function processTip(data, client) {
  try {
    const tokens = await getActiveTokens();
    const token = tokens.find((t) => t.id === data.tokenId);
    if (!token || !token.active) {
      return {
        success: false,
        message: "Invalid token",
        details: "The selected token is not available."
      };
    }
    const fromUser = await prisma.user.upsert({
      where: { discordId: data.userId },
      update: {},
      create: { discordId: data.userId }
    });
    const cfg = await getConfig();
    const bestTaxBenefit = await RoleTaxBenefitService.getBestTaxBenefit(
      fromUser.id,
      data.guildId || "",
      data.userId
    );
    let feeBpsNum = token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;
    if (bestTaxBenefit) {
      const taxReduction = bestTaxBenefit.exemptionRate / 100;
      feeBpsNum = Math.round(feeBpsNum * (1 - taxReduction));
    } else {
      const taxFree = await userHasActiveTaxFreeTier(fromUser.id);
      feeBpsNum = taxFree ? 0 : feeBpsNum;
    }
    const feeBps = BigInt(feeBpsNum);
    const atomic = toAtomicDirect(data.amount, token.decimals);
    if (atomic < BigInt(1e3)) {
      return {
        success: false,
        message: "Amount too small",
        details: "Minimum tip amount is 0.000001 tokens to prevent fee bypass attacks."
      };
    }
    let feeAtomic = atomic * feeBps / 10000n;
    const remainder = atomic * feeBps % 10000n;
    if (remainder > 0n) {
      feeAtomic = feeAtomic + 1n;
    }
    if (feeBps > 0n && feeAtomic === 0n) {
      feeAtomic = 1n;
    }
    if (data.tipType === "direct") {
      if (!data.targetUserId) {
        return {
          success: false,
          message: "Missing recipient",
          details: "Target user is required for direct tips."
        };
      }
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
      const toUser = await prisma.user.upsert({
        where: { discordId: data.targetUserId },
        update: {},
        create: { discordId: data.targetUserId }
      });
      const fromUser2 = await ensureUser(data.userId);
      const totalNeeded = atomic + feeAtomic;
      let result;
      try {
        result = await prisma.$transaction(async (tx) => {
          const currentBalance = await tx.userBalance.findUnique({
            where: { userId_tokenId: { userId: fromUser2.id, tokenId: token.id } }
          });
          const balanceAtomic = currentBalance ? decToBigDirect(currentBalance.amount, token.decimals) : 0n;
          if (balanceAtomic < totalNeeded) {
            throw new Error(`Insufficient balance: You need ${formatAmount(totalNeeded, token)} but only have ${formatAmount(balanceAtomic, token)}.`);
          }
          return { success: true };
        });
      } catch (error) {
        if (error?.message?.includes("Insufficient balance")) {
          return {
            success: false,
            message: "Insufficient balance",
            details: error.message.replace("Insufficient balance: ", "")
          };
        }
        throw error;
      }
      await transferToken(data.userId, data.targetUserId, token.id, atomic, "TIP", {
        guildId: data.guildId,
        feeAtomic,
        note: data.note
      });
      const originalFeeBps = token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;
      const originalFee = atomic * BigInt(originalFeeBps) / 10000n;
      const taxSavedAtomic = originalFee - feeAtomic;
      const totalDeducted = atomic + feeAtomic;
      const exemptionRateBps = bestTaxBenefit?.exemptionRate ? Math.round(bestTaxBenefit.exemptionRate) : 0;
      const createdTip = await prisma.tip.create({
        data: {
          fromUserId: fromUser2.id,
          toUserId: toUser.id,
          tokenId: token.id,
          amountAtomic: atomic.toString(),
          // Store atomic units, not converted amounts
          feeAtomic: feeAtomic.toString(),
          // Store atomic units, not converted amounts
          taxAtomic: feeAtomic.toString(),
          // Store tax amount for refunds
          note: data.note,
          status: "COMPLETED",
          // Analytics tracking
          roleBenefitUsed: bestTaxBenefit?.label || null,
          taxSavedAtomic: taxSavedAtomic.toString(),
          guildId: data.guildId,
          // Tax transparency tracking (NEW)
          taxRateAppliedBps: Number(feeBps),
          exemptionRateBps,
          totalDeductedAtomic: totalDeducted.toString()
        }
      });
      if (data.fromPenguBook) {
        try {
          await prisma.penguBookMessage.create({
            data: {
              fromUserId: fromUser2.id,
              toUserId: toUser.id,
              tipId: createdTip.id,
              message: data.note || `Received ${formatAmount(atomic, token)} tip via PenguBook!`
            }
          });
          console.log(`\u{1F4EC} PenguBook message created for tip ${createdTip.id}: ${data.userId} \u2192 ${data.targetUserId}`);
        } catch (messageError) {
          console.error("Failed to create PenguBook message:", messageError);
        }
      }
      try {
        const { updateReferralProgress } = await import("./referrals.js");
        await updateReferralProgress(data.userId, Number(bigToDecDirect(atomic, token.decimals)));
      } catch (referralError) {
        console.error("Failed to update referral progress:", referralError);
      }
      await prisma.transaction.create({
        data: {
          type: "TIP",
          userId: fromUser2.id,
          otherUserId: toUser.id,
          tokenId: token.id,
          amount: bigToDecDirect(atomic, token.decimals),
          fee: bigToDecDirect(feeAtomic, token.decimals),
          guildId: data.guildId,
          metadata: JSON.stringify({ kind: "DIRECT_TIP" })
        }
      });
      const tipAmountWithUSD = await formatAmountWithUSD(atomic, token, { compact: true });
      let publicLine = `\u{1F4B8} <@${data.userId}> tipped ${tipAmountWithUSD} to <@${data.targetUserId}>`;
      if (feeAtomic > 0n) {
        publicLine += ` (+ ${formatAmount(feeAtomic, token)} tax = ${formatAmount(totalDeducted, token)} total deducted)`;
      } else if (bestTaxBenefit && bestTaxBenefit.exemptionRate > 0) {
        publicLine += ` (tax-free via **${bestTaxBenefit.label}**)`;
      }
      if (bestTaxBenefit && bestTaxBenefit.exemptionRate > 0 && taxSavedAtomic > 0n) {
        const benefitEmoji = bestTaxBenefit.source.startsWith("tier:") ? "\u2B50" : "\u{1F3AD}";
        const benefitMessage = await formatBenefitNotification(
          bestTaxBenefit,
          "tax",
          formatAmount(taxSavedAtomic, token),
          token.symbol,
          data.guildId
        );
        publicLine += `
${benefitEmoji} ${benefitMessage}`;
      }
      if (data.note) {
        publicLine += `
\u{1F4DD} ${data.note}`;
      }
      (async () => {
        try {
          const { checkTipAchievements, checkEngagementAchievements } = await import("./streaks.js");
          const { queueAchievementNotifications } = await import("./notifications.js");
          const tipCount = await prisma.tip.count({
            where: { fromUserId: fromUser2.id, status: "COMPLETED" }
          });
          const tipAmount = Number(bigToDecDirect(atomic, token.decimals));
          const [tipAchievements, engagementAchievements] = await Promise.all([
            checkTipAchievements(fromUser2.id, tipCount, tipAmount),
            checkEngagementAchievements(fromUser2.id)
          ]);
          const allAchievements = [...tipAchievements, ...engagementAchievements];
          if (allAchievements.length > 0) {
            queueAchievementNotifications(data.userId, allAchievements, "tip");
          }
        } catch (error) {
          console.error("Error checking tip achievements:", error);
        }
      })();
      const tierButton = await createTierPurchaseButton(bestTaxBenefit, data.userId);
      try {
        await prisma.activityFeedItem.create({
          data: {
            userId: fromUser2.id,
            type: "tip",
            data: {
              amount: formatAmount(atomic, token),
              token: token.symbol,
              targetUserId: targetUser.id,
              targetUserHandle: targetUser.displayName || targetUser.username,
              fromPenguBook: data.fromPenguBook || false
            },
            visibility: "public"
          }
        });
      } catch (error) {
        console.error("Failed to create activity feed item for tip:", error);
      }
      const formattedAmountWithUSD = await formatAmountWithUSD(atomic, token, { compact: true });
      return {
        success: true,
        message: "Direct tip sent successfully!",
        details: `Sent ${formattedAmountWithUSD} to ${targetUser.displayName || targetUser.username}`,
        publicMessage: {
          content: publicLine,
          components: tierButton ? [tierButton] : void 0,
          allowedMentions: { users: [data.userId, data.targetUserId] }
        }
      };
    } else if (data.tipType === "group") {
      if (!data.duration || data.duration < 1 || data.duration > 1440) {
        return {
          success: false,
          message: "Invalid duration",
          details: "Duration must be between 1 minute and 24 hours (1440 minutes)."
        };
      }
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
      const fromUser2 = await ensureUser(data.userId);
      const expiresAt = new Date(Date.now() + data.duration * 60 * 1e3);
      let result;
      try {
        result = await prisma.$transaction(async (tx) => {
          const { debitTokenTx } = await import("./balances.js");
          const currentBalance = await tx.userBalance.findUnique({
            where: { userId_tokenId: { userId: fromUser2.id, tokenId: token.id } }
          });
          const balanceAtomic = currentBalance ? decToBigDirect(currentBalance.amount, token.decimals) : 0n;
          if (balanceAtomic < atomic + feeAtomic) {
            throw new Error(`Insufficient balance: You don't have enough ${data.amount} tokens + fees for this group tip.`);
          }
          await debitTokenTx(tx, data.userId, token.id, atomic + feeAtomic, "TIP", { guildId: data.guildId });
          const groupTip = await tx.groupTip.create({
            data: {
              creatorId: fromUser2.id,
              tokenId: token.id,
              totalAmount: data.amount.toString(),
              taxAtomic: feeAtomic.toString(),
              // Store tax amount for refunds
              duration: (data.duration || 5) * 60,
              status: "ACTIVE",
              expiresAt,
              guildId: data.guildId
            }
          });
          if (feeAtomic > 0n) {
            await tx.transaction.create({
              data: {
                type: "TIP",
                userId: fromUser2.id,
                tokenId: token.id,
                amount: bigToDecDirect(atomic, token.decimals),
                fee: bigToDecDirect(feeAtomic, token.decimals),
                guildId: data.guildId,
                metadata: JSON.stringify({ groupTipId: groupTip.id, kind: "GROUP_TIP_CREATE" })
              }
            });
          }
          return groupTip;
        });
      } catch (error) {
        if (error?.message?.includes("Insufficient balance")) {
          return {
            success: false,
            message: "Insufficient balance",
            details: error.message.replace("Insufficient balance: ", "")
          };
        }
        throw error;
      }
      const ad = await getActiveAd();
      const groupAmountWithUSD = await formatAmountWithUSD(atomic, token, { compact: true });
      const embed = groupTipEmbed({
        creator: `<@${data.userId}>`,
        amount: groupAmountWithUSD,
        expiresAt: result.expiresAt,
        claimCount: 0,
        claimedBy: [],
        note: data.note,
        ad: ad ?? void 0
      });
      try {
        const msg = await channel.send({
          embeds: [embed],
          components: [groupTipClaimRow(result.id, false)]
        });
        await prisma.groupTip.update({
          where: { id: result.id },
          data: {
            messageId: msg.id,
            channelId: msg.channelId
          }
        });
        console.log(`\u{1F3AF} ATTEMPTING TO SCHEDULE TIMER for group tip ${result.id}...`);
        console.log(`   \u{1F4CA} Tip details: expires=${result.expiresAt.toISOString()}, status=${result.status}`);
        console.log(`   \u{1F916} Client available: ${!!client}, clientReady: ${client?.isReady()}`);
        try {
          await scheduleGroupTipExpiry(client, result.id);
          console.log(`\u2705 TIMER SCHEDULING COMPLETED for group tip ${result.id}`);
        } catch (scheduleError) {
          console.error(`\u274C TIMER SCHEDULING FAILED for group tip ${result.id}:`, scheduleError.message);
          console.error(`   \u{1F4CB} Stack trace:`, scheduleError.stack);
        }
        try {
          const { redisTimers } = await import("../services/redis_timers.js");
          const redisSuccess = await redisTimers.scheduleGroupTipExpiry(result.id, result.expiresAt);
          if (redisSuccess) {
            console.log(`\u26A1 REDIS TIMER SCHEDULED for group tip ${result.id} (expires: ${result.expiresAt.toISOString()})`);
          } else {
            console.log(`\u26A0\uFE0F Redis timer unavailable for tip ${result.id}, using fallback timers`);
          }
        } catch (redisError) {
          console.error(`\u274C REDIS TIMER FAILED for group tip ${result.id}:`, redisError.message);
        }
        const formattedAmountWithUSD = await formatAmountWithUSD(atomic, token, { compact: true });
        const formattedFeeWithUSD = await formatAmountWithUSD(feeAtomic, token, { compact: true });
        const formattedTotalWithUSD = await formatAmountWithUSD(atomic + feeAtomic, token, { compact: true });
        const totalLine = `${formattedAmountWithUSD} + fee ${formattedFeeWithUSD} = ${formattedTotalWithUSD}`;
        let successMessage = "Group tip created successfully!";
        let detailsMessage = `Created ${data.duration}-minute group tip for ${formattedAmountWithUSD}
You were charged ${totalLine}`;
        if (bestTaxBenefit && bestTaxBenefit.exemptionRate > 0) {
          const originalFee = atomic * BigInt(token.tipFeeBps ?? cfg?.tipFeeBps ?? 100) / 10000n;
          const savedAmount = originalFee - feeAtomic;
          if (savedAmount > 0n) {
            const benefitEmoji = bestTaxBenefit.source.startsWith("tier:") ? "\u2B50" : "\u{1F3AD}";
            const benefitMessage = await formatBenefitNotification(
              bestTaxBenefit,
              "tax",
              formatAmount(savedAmount, token),
              token.symbol,
              data.guildId
            );
            detailsMessage += `
${benefitEmoji} ${benefitMessage}`;
          }
        }
        return {
          success: true,
          message: successMessage,
          details: detailsMessage
        };
      } catch (error) {
        console.error("Failed to post group tip message:", error);
        try {
          const refundResult = await RefundEngine.refundContribution(result.id);
          if (!refundResult.success) {
            console.error("Failed to refund group tip:", refundResult.message);
          }
          await prisma.groupTip.update({
            where: { id: result.id },
            data: { status: "FAILED" }
          });
        } catch (refundError) {
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
  } catch (error) {
    console.error("Tip processing error:", error);
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
async function formatBenefitNotification(benefit, benefitType, savedAmount, tokenSymbol, guildId) {
  try {
    if (benefit.source.startsWith("role:")) {
      const roleId = benefit.source.substring(5);
      if (guildId) {
        try {
          const discord = getDiscordClient();
          if (discord) {
            const guild = await discord.guilds.fetch(guildId);
            const role = await guild?.roles.fetch(roleId);
            if (role && role.name) {
              const benefitAction2 = benefitType === "tax" ? "tax-free tipping" : "reduced house fees";
              const cleanRoleName = role.name.trim();
              if (cleanRoleName.length > 0 && cleanRoleName !== roleId) {
                return `Your **${cleanRoleName}** role granted ${benefitAction2}! Saved ${savedAmount} ${tokenSymbol}`;
              }
            }
          }
        } catch (error) {
          if (!String(error).includes("rate limit") && !String(error).includes("timeout")) {
            console.warn("Discord API unavailable for role name lookup:", String(error));
          }
        }
      }
      const benefitAction = benefitType === "tax" ? "tax exemption" : "rake reduction";
      return `Your **${benefit.label}** granted ${benefitAction}! Saved ${savedAmount} ${tokenSymbol}`;
    } else if (benefit.source.startsWith("tier:")) {
      const benefitAction = benefitType === "tax" ? "tax-free tipping" : "reduced gaming fees";
      return `Your **${benefit.label}** perks granted ${benefitAction}! Saved ${savedAmount} ${tokenSymbol}`;
    } else {
      const benefitAction = benefitType === "tax" ? "saved you tax" : "reduced your fees";
      return `Your **${benefit.label}** ${benefitAction}! Saved ${savedAmount} ${tokenSymbol}`;
    }
  } catch (error) {
    console.error("Error formatting benefit notification:", error);
    return `Your **${benefit.label}** saved you ${savedAmount} ${tokenSymbol}!`;
  }
}
async function createTierPurchaseButton(benefit, userDiscordId) {
  try {
    if (!benefit || !benefit.source.startsWith("tier:")) {
      return null;
    }
    const user = await prisma.user.findUnique({
      where: { discordId: userDiscordId },
      include: {
        tierMemberships: {
          where: {
            status: "ACTIVE",
            expiresAt: { gt: /* @__PURE__ */ new Date() }
          },
          include: { tier: true }
        }
      }
    });
    if (user && user.tierMemberships.length > 0) {
      return null;
    }
    const availableTiers = await prisma.tier.findMany({
      where: { active: true },
      include: {
        prices: {
          include: { token: true }
        }
      },
      orderBy: { priceAmount: "asc" },
      // Show cheapest tier first
      take: 1
      // Just show one tier option to keep it simple
    });
    if (availableTiers.length === 0) {
      return null;
    }
    const tier = availableTiers[0];
    const price = tier.prices[0];
    if (!price) return null;
    const savingsPercent = Math.round(benefit.exemptionRate || 0);
    const tierButton = new ButtonBuilder().setCustomId(`pip:tier_purchase:${tier.id}`).setLabel(`\u{1F48E} Get ${tier.name} - Save ${savingsPercent}% on fees`).setStyle(ButtonStyle.Success).setEmoji("\u2B50");
    const row = new ActionRowBuilder().addComponents(tierButton);
    return row;
  } catch (error) {
    console.error("Error creating tier purchase button:", error);
    return null;
  }
}
export {
  processTip
};
//# sourceMappingURL=tip_processor.js.map
