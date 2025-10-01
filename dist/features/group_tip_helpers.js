import { prisma } from "../services/db.js";
import { decToBigDirect, formatAmount } from "../services/token.js";
import { groupTipEmbed } from "../ui/embeds.js";
import { groupTipClaimRow } from "../ui/components.js";
import { rateLimitedDiscord } from "../services/discord_rate_limiter.js";
async function updateGroupTipMessage(client, groupTipId) {
  console.log(`\u{1F680} ENTERING updateGroupTipMessage for tip ${groupTipId}`);
  try {
    console.log(`\u{1F50D} Fetching tip ${groupTipId} from database...`);
    const tip = await prisma.groupTip.findUnique({
      where: { id: groupTipId },
      include: {
        Creator: true,
        Token: true,
        claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
        contributions: { include: { contributor: true }, orderBy: { createdAt: "asc" } }
      }
    });
    console.log(`\u{1F50D} Database query completed for tip ${groupTipId}:`, {
      found: !!tip,
      status: tip?.status,
      channelId: tip?.channelId,
      messageId: tip?.messageId
    });
    if (!tip || !tip.channelId || !tip.messageId) {
      console.log(`\u274C updateGroupTipMessage: Missing required data for tip ${groupTipId}`);
      return;
    }
    console.log(`\u{1F50D} Processing tip data for tip ${groupTipId}...`);
    const now = /* @__PURE__ */ new Date();
    const expired = !!tip.expiresAt && now >= tip.expiresAt || tip.status === "FINALIZED";
    console.log(`\u{1F50D} Calculated expired=${expired} for tip ${groupTipId}`);
    const claimCount = tip.claims.length;
    const claimedBy = tip.claims.map((c) => c.User?.discordId ? `<@${c.User.discordId}>` : null).filter(Boolean);
    console.log(`\u{1F50D} Claims processed: ${claimCount} claims, ${claimedBy.length} with Discord IDs`);
    const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";
    console.log(`\u{1F50D} Creator display: ${creatorDisplay}`);
    const atomicOriginal = decToBigDirect(tip.totalAmount, tip.Token.decimals);
    console.log(`\u{1F50D} Calculated atomicOriginal: ${atomicOriginal}`);
    const originalAmountStr = formatAmount(atomicOriginal, {
      address: tip.Token.address,
      symbol: tip.Token.symbol,
      decimals: tip.Token.decimals
    });
    const contributionsTotal = Number(tip.contributionsTotal || 0);
    const grandTotal = Number(tip.totalAmount) + contributionsTotal;
    const atomicGrandTotal = decToBigDirect(grandTotal, tip.Token.decimals);
    const totalAmountStr = formatAmount(atomicGrandTotal, {
      address: tip.Token.address,
      symbol: tip.Token.symbol,
      decimals: tip.Token.decimals
    });
    const contributors = await Promise.allSettled(tip.contributions.map(async (contrib) => {
      let displayName = `User-${contrib.contributor.discordId.slice(-4)}`;
      try {
        const userPromise = rateLimitedDiscord.execute(
          "user_fetch",
          () => client.users.fetch(contrib.contributor.discordId)
        );
        const timeoutPromise = new Promise(
          (_, reject) => setTimeout(() => reject(new Error("Discord user fetch timeout")), 2e3)
        );
        const discordUser = await Promise.race([userPromise, timeoutPromise]);
        displayName = `@${discordUser.username}`;
      } catch (error) {
        displayName = `<@${contrib.contributor.discordId}>`;
      }
      return {
        name: displayName,
        amount: formatAmount(decToBigDirect(contrib.amount, tip.Token.decimals), {
          address: tip.Token.address,
          symbol: tip.Token.symbol,
          decimals: tip.Token.decimals
        })
      };
    }));
    const successfulContributors = contributors.filter((result) => result.status === "fulfilled").map((result) => result.value);
    console.log(`\u{1F50D} Formatted amounts:`, {
      original: originalAmountStr,
      contributionsTotal,
      grandTotal,
      totalAmount: totalAmountStr,
      contributorsCount: successfulContributors.length
    });
    let payoutPerUser;
    console.log(`\u{1F50D} About to calculate payoutPerUser, tip.status=${tip.status}, claimCount=${claimCount}`);
    if (tip.status === "FINALIZED" && claimCount > 0) {
      const perUser = atomicGrandTotal / BigInt(claimCount);
      payoutPerUser = formatAmount(perUser, {
        address: tip.Token.address,
        symbol: tip.Token.symbol,
        decimals: tip.Token.decimals
      });
    }
    console.log(`\u{1F50D} About to create embed with data:`, {
      expired,
      isFinalized: tip.status === "FINALIZED",
      payoutPerUser
    });
    const embed = groupTipEmbed({
      creator: creatorDisplay,
      amount: originalAmountStr,
      totalAmount: successfulContributors.length > 0 ? totalAmountStr : void 0,
      // Only show total if there are contributions
      contributors: successfulContributors.length > 0 ? successfulContributors : void 0,
      expiresAt: tip.expiresAt,
      // not optional in your schema
      claimCount,
      claimedBy,
      isExpired: expired,
      // 👈 tell the embed it's expired
      isFinalized: tip.status === "FINALIZED",
      payoutPerUser
      // note: (omit, since GroupTip has no note column)
    });
    console.log(`\u{1F50D} Embed created successfully`);
    if (tip.status === "FINALIZED") {
      console.log(`\u{1F50D} Setting fresh timestamp for finalized tip`);
      embed.setTimestamp(/* @__PURE__ */ new Date());
    }
    const components = [groupTipClaimRow(tip.id, expired || tip.status !== "ACTIVE")];
    console.log(`\u{1F50D} About to fetch channel ${tip.channelId} for tip ${groupTipId}`);
    const channel = await Promise.race([
      rateLimitedDiscord.fetchChannel(client, tip.channelId),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Channel fetch timeout")), 1e4))
    ]).catch((error) => {
      console.error(`\u274C Failed to fetch channel ${tip.channelId}:`, error.message);
      return null;
    });
    if (!channel || typeof channel !== "object" || !("isTextBased" in channel) || typeof channel.isTextBased !== "function" || !channel.isTextBased()) {
      console.log(`\u274C Invalid channel type for tip ${groupTipId}`);
      return;
    }
    console.log(`\u{1F50D} About to fetch message ${tip.messageId} for tip ${groupTipId}`);
    const msg = await Promise.race([
      channel.messages.fetch(tip.messageId),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Message fetch timeout")), 1e4))
    ]).catch((error) => {
      console.error(`\u274C Failed to fetch message ${tip.messageId}:`, error.message);
      return null;
    });
    if (!msg) {
      console.log(`\u274C Message not found for tip ${groupTipId}`);
      return;
    }
    console.log(`\u{1F527} updateGroupTipMessage: Editing message for tip ${groupTipId}`, {
      expired,
      isFinalized: tip.status === "FINALIZED",
      status: tip.status,
      messageId: tip.messageId,
      embedFields: embed.data.fields?.map((f) => ({ name: f.name, value: f.value }))
    });
    try {
      console.log(`\u{1F527} updateGroupTipMessage: Making DIRECT Discord API call for tip ${groupTipId}`);
      const result = await msg.edit({ embeds: [embed], components });
      console.log(`\u2705 updateGroupTipMessage: DIRECT Discord API success:`, {
        messageId: result.id,
        editedTimestamp: result.editedTimestamp,
        embedsLength: result.embeds?.length,
        embedTitle: result.embeds?.[0]?.title
      });
      console.log(`\u2705 updateGroupTipMessage: Successfully edited message for tip ${groupTipId}`);
    } catch (error) {
      console.error(`\u274C updateGroupTipMessage: Failed to edit message for tip ${groupTipId}:`, {
        error: error.message,
        name: error.name,
        code: error.code,
        status: error.status
      });
      throw error;
    }
  } catch (outerError) {
    console.error(`\u{1F4A5} FATAL ERROR in updateGroupTipMessage for tip ${groupTipId}:`, {
      error: outerError.message,
      name: outerError.name,
      stack: outerError.stack
    });
    throw outerError;
  }
}
export {
  updateGroupTipMessage
};
//# sourceMappingURL=group_tip_helpers.js.map
