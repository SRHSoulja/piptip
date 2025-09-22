// src/features/group_tip_helpers.ts
import type { Client, TextBasedChannel } from "discord.js";
import { prisma } from "../services/db.js";
import { decToBigDirect, formatAmount } from "../services/token.js";
import { groupTipEmbed } from "../ui/embeds.js";
import { groupTipClaimRow } from "../ui/components.js";
import { rateLimitedDiscord } from "../services/discord_rate_limiter.js";

export async function updateGroupTipMessage(client: Client, groupTipId: number) {
  console.log(`🚀 ENTERING updateGroupTipMessage for tip ${groupTipId}`);

  try {
    console.log(`🔍 Fetching tip ${groupTipId} from database...`);
    const tip = await prisma.groupTip.findUnique({
    where: { id: groupTipId },
    include: {
      Creator: true,
      Token: true,
      claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
      contributions: { include: { contributor: true }, orderBy: { createdAt: "asc" } },
    },
  });

  console.log(`🔍 Database query completed for tip ${groupTipId}:`, {
    found: !!tip,
    status: tip?.status,
    channelId: tip?.channelId,
    messageId: tip?.messageId
  });

  if (!tip || !tip.channelId || !tip.messageId) {
    console.log(`❌ updateGroupTipMessage: Missing required data for tip ${groupTipId}`);
    return;
  }

  console.log(`🔍 Processing tip data for tip ${groupTipId}...`);

  const now = new Date();
  const expired = (!!tip.expiresAt && now >= tip.expiresAt) || tip.status === 'FINALIZED';

  console.log(`🔍 Calculated expired=${expired} for tip ${groupTipId}`);

  const claimCount = tip.claims.length;
  const claimedBy = tip.claims
    .map(c => (c.User?.discordId ? `<@${c.User.discordId}>` : null))
    .filter(Boolean) as string[];

  console.log(`🔍 Claims processed: ${claimCount} claims, ${claimedBy.length} with Discord IDs`);

  const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";

  console.log(`🔍 Creator display: ${creatorDisplay}`);

  // Calculate original amount
  const atomicOriginal = decToBigDirect(tip.totalAmount, tip.Token.decimals);
  console.log(`🔍 Calculated atomicOriginal: ${atomicOriginal}`);

  const originalAmountStr = formatAmount(atomicOriginal, {
    address: tip.Token.address,
    symbol: tip.Token.symbol,
    decimals: tip.Token.decimals,
  } as any);

  // Calculate total amount including contributions
  const contributionsTotal = Number(tip.contributionsTotal || 0);
  const grandTotal = Number(tip.totalAmount) + contributionsTotal;
  const atomicGrandTotal = decToBigDirect(grandTotal, tip.Token.decimals);

  const totalAmountStr = formatAmount(atomicGrandTotal, {
    address: tip.Token.address,
    symbol: tip.Token.symbol,
    decimals: tip.Token.decimals,
  } as any);

  // Format contributors data with Discord usernames - optimized for many contributors
  const contributors = await Promise.allSettled(tip.contributions.map(async contrib => {
    let displayName = `User-${contrib.contributor.discordId.slice(-4)}`;

    try {
      // Use rate-limited Discord fetching with timeout for viral scalability
      const userPromise = rateLimitedDiscord.execute('user_fetch', () =>
        client.users.fetch(contrib.contributor.discordId)
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Discord user fetch timeout')), 2000)
      );

      const discordUser = await Promise.race([userPromise, timeoutPromise]) as any;
      displayName = `@${discordUser.username}`;
    } catch (error) {
      // Fallback to Discord ID display - don't log in production to reduce noise
      displayName = `<@${contrib.contributor.discordId}>`;
    }

    return {
      name: displayName,
      amount: formatAmount(decToBigDirect(contrib.amount, tip.Token.decimals), {
        address: tip.Token.address,
        symbol: tip.Token.symbol,
        decimals: tip.Token.decimals,
      } as any)
    };
  }));

  // Filter successful results and handle failures gracefully
  const successfulContributors = contributors
    .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
    .map(result => result.value);

  console.log(`🔍 Formatted amounts:`, {
    original: originalAmountStr,
    contributionsTotal,
    grandTotal,
    totalAmount: totalAmountStr,
    contributorsCount: successfulContributors.length
  });

  // Calculate payout per user if finalized
  let payoutPerUser: string | undefined;
  console.log(`🔍 About to calculate payoutPerUser, tip.status=${tip.status}, claimCount=${claimCount}`);
  if (tip.status === 'FINALIZED' && claimCount > 0) {
    // Use grand total (original + contributions) for payout calculation
    const perUser = atomicGrandTotal / BigInt(claimCount);
    payoutPerUser = formatAmount(perUser, {
      address: tip.Token.address,
      symbol: tip.Token.symbol,
      decimals: tip.Token.decimals,
    } as any);
  }

  console.log(`🔍 About to create embed with data:`, {
    expired,
    isFinalized: tip.status === 'FINALIZED',
    payoutPerUser
  });

  const embed = groupTipEmbed({
    creator: creatorDisplay,
    amount: originalAmountStr,
    totalAmount: successfulContributors.length > 0 ? totalAmountStr : undefined, // Only show total if there are contributions
    contributors: successfulContributors.length > 0 ? successfulContributors : undefined,
    expiresAt: tip.expiresAt,   // not optional in your schema
    claimCount,
    claimedBy,
    isExpired: expired,         // 👈 tell the embed it's expired
    isFinalized: tip.status === 'FINALIZED',
    payoutPerUser,
    // note: (omit, since GroupTip has no note column)
  });

  console.log(`🔍 Embed created successfully`);

  // Force Discord cache refresh by setting a new timestamp for finalized tips
  if (tip.status === 'FINALIZED') {
    console.log(`🔍 Setting fresh timestamp for finalized tip`);
    embed.setTimestamp(new Date());
  }

  const components = [groupTipClaimRow(tip.id, expired || tip.status !== "ACTIVE")];

  console.log(`🔍 About to fetch channel ${tip.channelId} for tip ${groupTipId}`);
  const channel = await Promise.race([
    rateLimitedDiscord.fetchChannel(client, tip.channelId),
    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Channel fetch timeout')), 10000))
  ]).catch((error) => {
    console.error(`❌ Failed to fetch channel ${tip.channelId}:`, error.message);
    return null;
  });

  if (!channel || typeof channel !== 'object' || !('isTextBased' in channel) || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    console.log(`❌ Invalid channel type for tip ${groupTipId}`);
    return;
  }

  console.log(`🔍 About to fetch message ${tip.messageId} for tip ${groupTipId}`);
  const msg = await Promise.race([
    (channel as TextBasedChannel).messages.fetch(tip.messageId),
    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Message fetch timeout')), 10000))
  ]).catch((error) => {
    console.error(`❌ Failed to fetch message ${tip.messageId}:`, error.message);
    return null;
  });

  if (!msg) {
    console.log(`❌ Message not found for tip ${groupTipId}`);
    return;
  }

  // Use rate limiter for message editing to prevent Discord API issues
  console.log(`🔧 updateGroupTipMessage: Editing message for tip ${groupTipId}`, {
    expired,
    isFinalized: tip.status === 'FINALIZED',
    status: tip.status,
    messageId: tip.messageId,
    embedFields: embed.data.fields?.map(f => ({ name: f.name, value: f.value }))
  });

  try {
    console.log(`🔧 updateGroupTipMessage: Making DIRECT Discord API call for tip ${groupTipId}`);
    const result = await msg.edit({ embeds: [embed], components });
    console.log(`✅ updateGroupTipMessage: DIRECT Discord API success:`, {
      messageId: result.id,
      editedTimestamp: result.editedTimestamp,
      embedsLength: result.embeds?.length,
      embedTitle: result.embeds?.[0]?.title
    });
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
  } catch (outerError: any) {
    console.error(`💥 FATAL ERROR in updateGroupTipMessage for tip ${groupTipId}:`, {
      error: outerError.message,
      name: outerError.name,
      stack: outerError.stack
    });
    throw outerError;
  }
}
