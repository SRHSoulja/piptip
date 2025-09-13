// src/services/tip_processor.ts - Enhanced tip processing service
import type { Client } from "discord.js";
import { prisma } from "./db.js";
import { getActiveTokens, toAtomicDirect, formatAmount, bigToDecDirect, decToBigDirect } from "./token.js";
import { transferToken, debitToken, creditToken } from "./balances.js";
import { getConfig } from "../config.js";
import { getActiveAd } from "./ads.js";
import { userHasActiveTaxFreeTier } from "./tiers.js";
import { groupTipEmbed } from "../ui/embeds.js";
import { groupTipClaimRow } from "../ui/components.js";
import { scheduleGroupTipExpiry } from "../features/group_tip_expiry.js";
import { RefundEngine } from "./refund_engine.js";

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

    // Calculate fees
    const cfg = await getConfig();
    const taxFree = await userHasActiveTaxFreeTier(fromUser.id);
    const feeBpsNum = taxFree ? 0 : (token.tipFeeBps ?? cfg?.tipFeeBps ?? 100);
    const feeBps = BigInt(feeBpsNum);
    const atomic = toAtomicDirect(data.amount, token.decimals);
    const feeAtomic = (atomic * feeBps) / 10000n;

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

      const publicLine =
        `💸 <@${data.userId}> tipped ${formatAmount(atomic, token)} to <@${data.targetUserId}>` +
        (feeAtomic > 0n ? ` (fee ${formatAmount(feeAtomic, token)} paid by sender)` : "") +
        (data.note ? `\\n📝 ${data.note}` : "");

      return {
        success: true,
        message: "Direct tip sent successfully!",
        details: `Sent ${formatAmount(atomic, token)} to ${targetUser.displayName || targetUser.username}`,
        publicMessage: {
          content: publicLine,
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

      // Validate channel BEFORE charging user
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

      // Charge user for group tip
      await debitToken(data.userId, token.id, atomic + feeAtomic, "TIP", { guildId: data.guildId });

      const expiresAt = new Date(Date.now() + data.duration * 60 * 1000);
      
      // Create the group tip (using current schema)
      const result = await prisma.groupTip.create({
        data: {
          creatorId: fromUser.id,
          tokenId: token.id,
          totalAmount: data.amount.toString(),
          taxAtomic: feeAtomic.toString(), // Store tax amount for refunds
          duration: data.duration * 60,
          status: "ACTIVE",
          expiresAt,
          guildId: data.guildId,
        },
      });

      // Record fee transaction if applicable
      if (feeAtomic > 0n) {
        await prisma.transaction.create({
          data: {
            type: "TIP",
            userId: fromUser.id,
            tokenId: token.id,
            amount: bigToDecDirect(atomic, token.decimals),
            fee: bigToDecDirect(feeAtomic, token.decimals),
            guildId: data.guildId,
            metadata: JSON.stringify({ groupTipId: result.id, kind: "GROUP_TIP_CREATE" }),
          },
        });
      }

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
        
        return {
          success: true,
          message: "Group tip created successfully!",
          details: `Created ${data.duration}-minute group tip for ${formatAmount(atomic, token)}\\nYou were charged ${totalLine}`
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