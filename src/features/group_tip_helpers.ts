// src/features/group_tip_helpers.ts
import type { Client, TextBasedChannel } from "discord.js";
import { prisma } from "../services/db.js";
import { decToBigDirect, formatAmount } from "../services/token.js";
import { groupTipEmbed } from "../ui/embeds.js";
import { groupTipClaimRow } from "../ui/components.js";
import { rateLimitedDiscord } from "../services/discord_rate_limiter.js";

export async function updateGroupTipMessage(client: Client, groupTipId: number) {
  const tip = await prisma.groupTip.findUnique({
    where: { id: groupTipId },
    include: {
      Creator: true,
      Token: true,
      claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
      contributions: { include: { contributor: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!tip || !tip.channelId || !tip.messageId) return;

  const now = new Date();
  const expired = (!!tip.expiresAt && now >= tip.expiresAt) || tip.status === 'FINALIZED';

  const claimCount = tip.claims.length;
  const claimedBy = tip.claims
    .map(c => (c.User?.discordId ? `<@${c.User.discordId}>` : null))
    .filter(Boolean) as string[];

  const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";

  const atomicTotal = decToBigDirect(tip.totalAmount, tip.Token.decimals);
  const amountStr = formatAmount(atomicTotal, {
    address: tip.Token.address,
    symbol: tip.Token.symbol,
    decimals: tip.Token.decimals,
  } as any);

  // Calculate payout per user if finalized
  let payoutPerUser: string | undefined;
  if (tip.status === 'FINALIZED' && claimCount > 0) {
    const totalPayout = decToBigDirect(tip.totalAmount, tip.Token.decimals);
    const perUser = totalPayout / BigInt(claimCount);
    payoutPerUser = formatAmount(perUser, {
      address: tip.Token.address,
      symbol: tip.Token.symbol,
      decimals: tip.Token.decimals,
    } as any);
  }

  const embed = groupTipEmbed({
    creator: creatorDisplay,
    amount: amountStr,
    expiresAt: tip.expiresAt,   // not optional in your schema
    claimCount,
    claimedBy,
    isExpired: expired,         // 👈 tell the embed it's expired
    isFinalized: tip.status === 'FINALIZED',
    payoutPerUser,
    // note: (omit, since GroupTip has no note column)
  });

  // Force Discord cache refresh by setting a new timestamp for finalized tips
  if (tip.status === 'FINALIZED') {
    embed.setTimestamp(new Date());
  }

  const components = [groupTipClaimRow(tip.id, expired || tip.status !== "ACTIVE")];

  const channel = await rateLimitedDiscord.fetchChannel(client, tip.channelId).catch(() => null);
  if (!channel || typeof channel !== 'object' || !('isTextBased' in channel) || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) return;

  const msg = await (channel as TextBasedChannel).messages.fetch(tip.messageId).catch(() => null);
  if (!msg) return;

  // Use rate limiter for message editing to prevent Discord API issues
  console.log(`🔧 updateGroupTipMessage: Editing message for tip ${groupTipId}`, {
    expired,
    isFinalized: tip.status === 'FINALIZED',
    status: tip.status,
    messageId: tip.messageId,
    embedFields: embed.data.fields?.map(f => ({ name: f.name, value: f.value }))
  });

  try {
    await rateLimitedDiscord.editMessage(msg, { embeds: [embed], components });
    console.log(`✅ updateGroupTipMessage: Successfully edited message for tip ${groupTipId}`);
  } catch (error: any) {
    console.error(`❌ updateGroupTipMessage: Failed to edit message for tip ${groupTipId}:`, {
      error: error.message,
      name: error.name,
      code: error.code,
      status: error.status
    });
    throw error;
  }
}
