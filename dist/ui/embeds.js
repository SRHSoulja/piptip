import { EmbedBuilder } from "discord.js";
import { fmtDec } from "../services/token.js";
import { getUserLevel, formatLevelDisplay } from "../services/penguin_levels.js";
async function profileEmbed(data) {
  let balanceDisplay = "0 tokens";
  if (data.balanceText) {
    balanceDisplay = data.balanceText;
  } else if (data.balanceAtomic) {
    balanceDisplay = typeof data.balanceAtomic === "string" ? data.balanceAtomic : fmtDec(data.balanceAtomic);
  }
  let levelInfo = null;
  if (data.discordId) {
    try {
      levelInfo = await getUserLevel(data.discordId);
    } catch (error) {
      console.warn("Could not fetch user level:", error);
    }
  }
  const embed = new EmbedBuilder().setTitle(levelInfo ? `${levelInfo.currentLevel.emoji} ${data.user?.username || "Penguin"} - ${levelInfo.currentLevel.title}` : "\u{1F427} Penguin Colony Profile \u{1F427}").setColor(data.hasActiveMembership ? 16766720 : 6809849).setTimestamp();
  if (data.user?.avatarURL) {
    const avatarUrl = data.user.avatarURL({ size: 128 });
    if (avatarUrl) embed.setThumbnail(avatarUrl);
  }
  const basicFields = [
    { name: "\u{1F41F} Fish Balance", value: balanceDisplay, inline: true },
    { name: "\u2694\uFE0F Battle Record", value: `${data.wins}W \u2022 ${data.losses}L \u2022 ${data.ties}T`, inline: true },
    { name: "\u{1F3E0} Ice Cave Address", value: data.agwAddress ? `\`${data.agwAddress.slice(0, 10)}...\`` : "\u{1F6AB} No cave linked", inline: true }
  ];
  if (levelInfo) {
    basicFields.push({
      name: "\u{1F396}\uFE0F Colony Rank",
      value: formatLevelDisplay(levelInfo),
      inline: false
    });
  }
  if (data.xpProgressText) {
    basicFields.push({
      name: "\u2B50 XP Progress",
      value: data.xpProgressText,
      inline: true
    });
  }
  if (data.socialScoreText) {
    basicFields.push({
      name: "\u{1F31F} Social Score",
      value: data.socialScoreText,
      inline: true
    });
  }
  embed.addFields(...basicFields);
  if (data.createdAt) {
    const accountAge = `<t:${Math.floor(data.createdAt.getTime() / 1e3)}:R>`;
    embed.addFields({ name: "\u{1F4C5} Member Since", value: accountAge, inline: true });
  }
  if (data.membershipText) {
    const membershipEmoji = data.hasActiveMembership ? "\u2B50" : "\u{1F513}";
    embed.addFields({
      name: `${membershipEmoji} Membership Status`,
      value: data.membershipText,
      inline: false
    });
  }
  if (data.tippingStats) {
    const { sentText, receivedText, sentCount, receivedCount } = data.tippingStats;
    embed.addFields(
      {
        name: "\u{1F4B8} Sent",
        value: `${sentText}
(${sentCount} tips)`,
        inline: true
      },
      {
        name: "\u{1F49D} Received",
        value: `${receivedText}
(${receivedCount} tips)`,
        inline: true
      },
      {
        name: "\u{1F4CA} Total",
        value: `${sentCount + receivedCount} tips`,
        inline: true
      }
    );
  }
  if (data.groupTipActivity) {
    embed.addFields({
      name: "\u{1F389} Group Tips",
      value: `Created: ${data.groupTipActivity.created}
Claimed: ${data.groupTipActivity.claimed}`,
      inline: true
    });
  }
  if (data.recentActivity) {
    embed.addFields({
      name: "\u{1F4CA} Recent Activity",
      value: data.recentActivity,
      inline: false
    });
  }
  if (data.streakText) {
    embed.addFields({
      name: "\u{1F3AF} Win Streak",
      value: data.streakText,
      inline: true
    });
  }
  if (data.dailyStreakText) {
    embed.addFields({
      name: "\u{1F4C5} Daily Activity",
      value: data.dailyStreakText,
      inline: true
    });
  }
  if (data.contributionText) {
    embed.addFields({
      name: "\u{1F91D} Group Tip Contributions",
      value: data.contributionText,
      inline: true
    });
  }
  if (data.levelBenefitsText) {
    embed.addFields({
      name: "\u{1F381} Current Level Benefits",
      value: data.levelBenefitsText,
      inline: false
    });
  }
  if (data.achievements && data.achievements.length > 0) {
    embed.addFields({
      name: "\u{1F3C6} Recent Achievements",
      value: String(data.achievements),
      // achievements will be pre-formatted in profile service
      inline: true
    });
  }
  if (data.unreadMessageCount && data.unreadMessageCount > 0) {
    const messageText = data.unreadMessageCount === 1 ? "\u{1F4E8} **1** new message" : `\u{1F4E8} **${data.unreadMessageCount}** new messages`;
    embed.addFields({
      name: "\u{1F4AC} Inbox",
      value: messageText,
      inline: true
    });
  }
  return embed;
}
function matchOfferEmbed(challengerTag, wagerText, ad) {
  const e = new EmbedBuilder().setTitle("<a:BoxingPengu:1415471596717477949> Penguin Colony Challenge!").setDescription(
    `\u{1F427} **${challengerTag}** is looking for a worthy opponent!

\u{1F3AF} **Challenge Type:** Penguin-Ice-Pebble
\u{1F4B0} **Stakes:** ${wagerText}

\u26A1 **Ready to battle?** Choose your weapon below!`
  ).setColor(6809849);
  if (ad) {
    e.addFields({
      name: "Sponsored",
      value: ad.url ? `[${ad.text}](${ad.url})` : ad.text
    });
  }
  return e;
}
function matchResultEmbed(opts) {
  const isWin = opts.resultLine.includes("wins");
  const isTie = opts.resultLine.includes("Tie");
  const challengerEmoji = getMoveEmoji(opts.challengerMove);
  const joinerEmoji = getMoveEmoji(opts.joinerMove);
  let title = "\u{1F3AE} Match Complete!";
  let color = 5793266;
  let description = "";
  if (isTie) {
    title = "\u{1F91D}\u{1F427} Epic Penguin Standoff!";
    color = 16766720;
    description = `${challengerEmoji} **VS** ${joinerEmoji}

\u{1F504} **Perfect Penguin Synchronization!**
Both penguins chose the same strategy!

\u{1F4B0} All fish returned to their owners`;
  } else if (isWin) {
    const winner = opts.resultLine.includes(opts.challengerTag) ? "challenger" : "joiner";
    const winnerTag = winner === "challenger" ? opts.challengerTag : opts.joinerTag;
    const winnerEmoji = winner === "challenger" ? challengerEmoji : joinerEmoji;
    const loserEmoji = winner === "challenger" ? joinerEmoji : challengerEmoji;
    title = "<a:BoxingPengu:1415471596717477949> Penguin Victory!";
    color = 65280;
    description = `${challengerEmoji} **VS** ${joinerEmoji}

\u{1F389} **${winnerTag} TRIUMPHS!**

\u{1F3C6} ${winnerEmoji} conquers ${loserEmoji} in penguin combat!`;
  }
  const e = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
  const challengerValue = formatPlayerDetails(opts.challengerTag, opts.challengerMove, opts.challengerStats);
  const joinerValue = formatPlayerDetails(opts.joinerTag, opts.joinerMove, opts.joinerStats);
  e.addFields(
    { name: "\u{1F94A}\u{1F427} Challenger", value: challengerValue, inline: true },
    { name: "\u2694\uFE0F\u{1F427} Opponent", value: joinerValue, inline: true },
    { name: "\u{1F4A5} Battle Outcome", value: `${challengerEmoji} **VS** ${joinerEmoji}`, inline: true }
  );
  if (opts.payoutText || opts.rakeText || opts.potText) {
    const financialDetails = [];
    if (opts.potText) financialDetails.push(`\u{1F41F} **Total Fish Pool:** ${opts.potText}`);
    if (opts.payoutText) financialDetails.push(`\u{1F381} **Victor's Bounty:** ${opts.payoutText}`);
    if (opts.rakeText) financialDetails.push(`\u{1F3DB}\uFE0F **Colony Tax:** ${opts.rakeText}`);
    e.addFields({
      name: "\u{1F4B8} Fish Economics",
      value: financialDetails.join("\n"),
      inline: false
    });
  }
  if (opts.ad) {
    e.addFields({
      name: "\u{1F4E2} Sponsored",
      value: opts.ad.url ? `[${opts.ad.text}](${opts.ad.url})` : opts.ad.text,
      inline: false
    });
  }
  return e;
}
function getMoveEmoji(move) {
  const moveClean = move.toLowerCase().replace(/[^a-z]/g, "");
  if (moveClean.includes("penguin")) return "\u{1F427}";
  if (moveClean.includes("ice")) return "\u{1F9CA}";
  if (moveClean.includes("pebble")) return "\u{1FAA8}";
  return "\u2753";
}
function formatPlayerDetails(tag, move, stats) {
  const moveEmoji = getMoveEmoji(move);
  const moveName = move.replace(/[^a-zA-Z]/g, "");
  let details = `${tag}
${moveEmoji} **${moveName}**`;
  if (stats) {
    const total = stats.wins + stats.losses + stats.ties;
    const winRate = total > 0 ? (stats.wins / total * 100).toFixed(1) : "0.0";
    details += `
\u{1F4CA} **${stats.wins}W-${stats.losses}L-${stats.ties}T** (${winRate}% WR)`;
  }
  return details;
}
function groupTipEmbed(data) {
  let description = `\u{1F427} **${data.creator}** is sharing fish with the colony!`;
  if (data.totalAmount && data.contributors && data.contributors.length > 0) {
    description += `

\u{1F41F} **Total Pool:** ${data.totalAmount}`;
    description += `
\u{1F49D} **Original:** ${data.amount} (by ${data.creator})`;
  } else {
    description += `

\u{1F41F} **Amount:** ${data.amount}`;
  }
  if (data.note) description += `
\u{1F4DD} **Message:** ${data.note}`;
  const timestamp = Math.floor(data.expiresAt.getTime() / 1e3);
  const e = new EmbedBuilder().setTitle(data.isFinalized ? "\u{1F389}\u2705 Colony Fish Distributed!" : "\u{1F389}\u{1F427} Colony Fish Sharing!").setDescription(description).setColor(data.isFinalized ? 65280 : 3725737).addFields(
    { name: "\u{1F427} Colony Members", value: `${data.claimCount} penguins`, inline: true },
    {
      name: data.isExpired ? "\u23F0 Status" : "\u23F0 Timer",
      value: data.isExpired ? data.isFinalized ? `\u2705 Fish distributed!${data.payoutPerUser ? `
\u{1F4B0} Each penguin got: ${data.payoutPerUser}` : ""}` : "\u{1F6AB} Fish sharing ended" : `\u23F3 Ends <t:${timestamp}:R>`,
      inline: true
    },
    {
      name: "\u{1F3A3} Fish Claimed By",
      value: data.claimedBy.length ? data.claimedBy.slice(0, 10).join(", ") + (data.claimedBy.length > 10 ? "..." : "") : "\u{1F427} No one yet - be the first!",
      inline: false
    }
  );
  if (data.contributors && data.contributors.length > 0) {
    const contributorsList = data.contributors.slice(0, 5).map((c) => `\u2022 ${c.name}: ${c.amount}`).join("\n");
    const moreContributors = data.contributors.length > 5 ? `
*+${data.contributors.length - 5} more contributors*` : "";
    e.addFields({
      name: "\u{1F91D} Colony Contributors",
      value: contributorsList + moreContributors,
      inline: false
    });
  }
  e.setTimestamp(data.expiresAt);
  if (data.ad) {
    e.addFields({
      name: "\u{1F4E2} Sponsored",
      value: data.ad.url ? `[${data.ad.text}](${data.ad.url})` : data.ad.text,
      inline: false
    });
  }
  if (data.isExpired) e.setColor(10066329);
  return e;
}
export {
  groupTipEmbed,
  matchOfferEmbed,
  matchResultEmbed,
  profileEmbed
};
//# sourceMappingURL=embeds.js.map
