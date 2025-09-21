// src/ui/embeds.ts
import { EmbedBuilder } from "discord.js";
import type { PipMove } from "../services/matches.js";
import { fmtDec } from "../services/token.js";
import { getUserLevel, formatLevelDisplay } from "../services/penguin_levels.js";

export async function profileEmbed(data: {
  user?: { username: string; displayName?: string | null; avatarURL?: (options?: any) => string | null };
  discordId?: string;
  agwAddress?: string | null;
  balanceText?: string;
  balanceAtomic?: any; // Legacy support
  wins: number;
  losses: number;
  ties: number;
  membershipText?: string;
  tippingStats?: {
    sentText: string;
    receivedText: string;
    sentCount: number;
    receivedCount: number;
  };
  groupTipActivity?: {
    created: number;
    claimed: number;
  };
  recentActivity?: string;
  unreadMessageCount?: number;
  streakText?: string;
  achievements?: any[];
  createdAt?: Date;
  hasActiveMembership?: boolean;
  // Enhanced profile features
  socialScore?: any;
  socialScoreText?: string;
  socialRank?: number;
  dailyStreakText?: string;
  levelDetails?: any;
  xpProgressText?: string;
  levelBenefitsText?: string;
  contributionStats?: any;
  contributionText?: string;
}) {
  // Handle balance display - support both new and legacy formats
  let balanceDisplay = "0 tokens";
  if (data.balanceText) {
    balanceDisplay = data.balanceText;
  } else if (data.balanceAtomic) {
    balanceDisplay = typeof data.balanceAtomic === 'string' 
      ? data.balanceAtomic 
      : fmtDec(data.balanceAtomic);
  }

  // Get user level information
  let levelInfo = null;
  if (data.discordId) {
    try {
      levelInfo = await getUserLevel(data.discordId);
    } catch (error) {
      console.warn("Could not fetch user level:", error);
    }
  }

  // Enhanced penguin-themed profile with level and visual hierarchy
  const embed = new EmbedBuilder()
    .setTitle(levelInfo ? `${levelInfo.currentLevel.emoji} ${data.user?.username || "Penguin"} - ${levelInfo.currentLevel.title}` : "🐧 Penguin Colony Profile 🐧")
    .setColor(data.hasActiveMembership ? 0xFFD700 : 0x67e8f9) // Gold for premium, Ice blue for regular penguins
    .setTimestamp();

  // Set user avatar as thumbnail if available
  if (data.user?.avatarURL) {
    const avatarUrl = data.user.avatarURL({ size: 128 });
    if (avatarUrl) embed.setThumbnail(avatarUrl);
  }

  // Enhanced penguin-themed basic info section with level
  const basicFields = [
    { name: "🐟 Fish Balance", value: balanceDisplay, inline: true },
    { name: "⚔️ Battle Record", value: `${data.wins}W • ${data.losses}L • ${data.ties}T`, inline: true },
    { name: "🏠 Ice Cave Address", value: data.agwAddress ? `\`${data.agwAddress.slice(0, 10)}...\`` : "🚫 No cave linked", inline: true }
  ];

  // Add level information if available
  if (levelInfo) {
    basicFields.push({
      name: "🎖️ Colony Rank",
      value: formatLevelDisplay(levelInfo),
      inline: false
    });
  }

  // Add XP progress details
  if (data.xpProgressText) {
    basicFields.push({
      name: "⭐ XP Progress",
      value: data.xpProgressText,
      inline: true
    });
  }

  // Add social score
  if (data.socialScoreText) {
    basicFields.push({
      name: "🌟 Social Score",
      value: data.socialScoreText,
      inline: true
    });
  }

  embed.addFields(...basicFields);

  // Account info
  if (data.createdAt) {
    const accountAge = `<t:${Math.floor(data.createdAt.getTime() / 1000)}:R>`;
    embed.addFields({ name: "📅 Member Since", value: accountAge, inline: true });
  }

  // Membership status
  if (data.membershipText) {
    const membershipEmoji = data.hasActiveMembership ? "⭐" : "🔓";
    embed.addFields({ 
      name: `${membershipEmoji} Membership Status`, 
      value: data.membershipText, 
      inline: false 
    });
  }

  // Mobile-optimized tipping statistics (more compact)
  if (data.tippingStats) {
    const { sentText, receivedText, sentCount, receivedCount } = data.tippingStats;

    embed.addFields(
      {
        name: "💸 Sent",
        value: `${sentText}\n(${sentCount} tips)`,
        inline: true
      },
      {
        name: "💝 Received",
        value: `${receivedText}\n(${receivedCount} tips)`,
        inline: true
      },
      {
        name: "📊 Total",
        value: `${sentCount + receivedCount} tips`,
        inline: true
      }
    );
  }

  // Group tip activity
  if (data.groupTipActivity) {
    embed.addFields({
      name: "🎉 Group Tips",
      value: `Created: ${data.groupTipActivity.created}\nClaimed: ${data.groupTipActivity.claimed}`,
      inline: true
    });
  }

  // Recent activity
  if (data.recentActivity) {
    embed.addFields({
      name: "📊 Recent Activity",
      value: data.recentActivity,
      inline: false
    });
  }

  // Show win streak if exists
  if (data.streakText) {
    embed.addFields({
      name: "🎯 Win Streak",
      value: data.streakText,
      inline: true
    });
  }

  // Show daily activity streak
  if (data.dailyStreakText) {
    embed.addFields({
      name: "📅 Daily Activity",
      value: data.dailyStreakText,
      inline: true
    });
  }

  // Show group tip contributions
  if (data.contributionText) {
    embed.addFields({
      name: "🤝 Group Tip Contributions",
      value: data.contributionText,
      inline: true
    });
  }

  // Show level benefits
  if (data.levelBenefitsText) {
    embed.addFields({
      name: "🎁 Current Level Benefits",
      value: data.levelBenefitsText,
      inline: false
    });
  }

  // Show recent achievements (max 3)
  if (data.achievements && data.achievements.length > 0) {
    embed.addFields({
      name: "🏆 Recent Achievements",
      value: String(data.achievements), // achievements will be pre-formatted in profile service
      inline: true
    });
  }

  // Mobile-optimized message notifications
  if (data.unreadMessageCount && data.unreadMessageCount > 0) {
    const messageText = data.unreadMessageCount === 1
      ? "📨 **1** new message"
      : `📨 **${data.unreadMessageCount}** new messages`;

    embed.addFields({
      name: "💬 Inbox",
      value: messageText,
      inline: true
    });
  }

  return embed;
}

/** Enhanced public offer embed with better visual hierarchy */
export function matchOfferEmbed(challengerTag: string, wagerText: string, ad?: { text: string; url?: string }) {
  const e = new EmbedBuilder()
    .setTitle("<a:BoxingPengu:1415471596717477949> Penguin Colony Challenge!")
    .setDescription(
      `🐧 **${challengerTag}** is looking for a worthy opponent!\n\n` +
      `🎯 **Challenge Type:** Penguin-Ice-Pebble\n` +
      `💰 **Stakes:** ${wagerText}\n\n` +
      `⚡ **Ready to battle?** Choose your weapon below!`
    )
    .setColor(0x67e8f9); // Ice blue

  if (ad) {
    e.addFields({
      name: "Sponsored",
      value: ad.url ? `[${ad.text}](${ad.url})` : ad.text,
    });
  }

  return e;
}

/** Enhanced flashy result embed */
export function matchResultEmbed(opts: {
  challengerTag: string;
  joinerTag: string;
  challengerMove: string;
  joinerMove: string;
  resultLine: string;
  payoutText?: string;
  rakeText?: string;
  ad?: { text: string; url?: string };
  challengerStats?: { wins: number; losses: number; ties: number };
  joinerStats?: { wins: number; losses: number; ties: number };
  potText?: string;
}) {
  // Determine if it's a win, loss, or tie
  const isWin = opts.resultLine.includes("wins");
  const isTie = opts.resultLine.includes("Tie");
  
  // Get move emojis
  const challengerEmoji = getMoveEmoji(opts.challengerMove);
  const joinerEmoji = getMoveEmoji(opts.joinerMove);
  
  // Create flashy title based on outcome
  let title = "🎮 Match Complete!";
  let color = 0x5865F2; // Default blue
  let description = "";
  
  if (isTie) {
    title = "🤝🐧 Epic Penguin Standoff!";
    color = 0xFFD700; // Gold
    description = `${challengerEmoji} **VS** ${joinerEmoji}\n\n🔄 **Perfect Penguin Synchronization!**\nBoth penguins chose the same strategy!\n\n💰 All fish returned to their owners`;
  } else if (isWin) {
    const winner = opts.resultLine.includes(opts.challengerTag) ? "challenger" : "joiner";
    const winnerTag = winner === "challenger" ? opts.challengerTag : opts.joinerTag;
    const winnerEmoji = winner === "challenger" ? challengerEmoji : joinerEmoji;
    const loserEmoji = winner === "challenger" ? joinerEmoji : challengerEmoji;
    
    title = "<a:BoxingPengu:1415471596717477949> Penguin Victory!";
    color = 0x00FF00; // Green
    description = `${challengerEmoji} **VS** ${joinerEmoji}\n\n🎉 **${winnerTag} TRIUMPHS!**\n\n🏆 ${winnerEmoji} conquers ${loserEmoji} in penguin combat!`;
  }
  
  const e = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
    
  // Player details with stats
  const challengerValue = formatPlayerDetails(opts.challengerTag, opts.challengerMove, opts.challengerStats);
  const joinerValue = formatPlayerDetails(opts.joinerTag, opts.joinerMove, opts.joinerStats);
  
  e.addFields(
    { name: "🥊🐧 Challenger", value: challengerValue, inline: true },
    { name: "⚔️🐧 Opponent", value: joinerValue, inline: true },
    { name: "💥 Battle Outcome", value: `${challengerEmoji} **VS** ${joinerEmoji}`, inline: true }
  );
  
  // Financial details with better formatting
  if (opts.payoutText || opts.rakeText || opts.potText) {
    const financialDetails = [];
    if (opts.potText) financialDetails.push(`🐟 **Total Fish Pool:** ${opts.potText}`);
    if (opts.payoutText) financialDetails.push(`🎁 **Victor's Bounty:** ${opts.payoutText}`);
    if (opts.rakeText) financialDetails.push(`🏛️ **Colony Tax:** ${opts.rakeText}`);
    
    e.addFields({
      name: "💸 Fish Economics",
      value: financialDetails.join("\n"),
      inline: false
    });
  }

  // add sponsor/ad if passed
  if (opts.ad) {
    e.addFields({
      name: "📢 Sponsored",
      value: opts.ad.url ? `[${opts.ad.text}](${opts.ad.url})` : opts.ad.text,
      inline: false,
    });
  }

  return e;
}

// Helper functions for enhanced match display
function getMoveEmoji(move: string): string {
  const moveClean = move.toLowerCase().replace(/[^a-z]/g, '');
  if (moveClean.includes('penguin')) return '🐧';
  if (moveClean.includes('ice')) return '🧊';
  if (moveClean.includes('pebble')) return '🪨';
  return '❓'; // fallback
}

function formatPlayerDetails(tag: string, move: string, stats?: { wins: number; losses: number; ties: number }): string {
  const moveEmoji = getMoveEmoji(move);
  const moveName = move.replace(/[^a-zA-Z]/g, ''); // Clean move name
  
  let details = `${tag}\n${moveEmoji} **${moveName}**`;
  
  if (stats) {
    const total = stats.wins + stats.losses + stats.ties;
    const winRate = total > 0 ? ((stats.wins / total) * 100).toFixed(1) : '0.0';
    details += `\n📊 **${stats.wins}W-${stats.losses}L-${stats.ties}T** (${winRate}% WR)`;
  }
  
  return details;
}


export function groupTipEmbed(data: {
  creator: string;
  amount: string;
  expiresAt: Date;
  claimCount: number;
  claimedBy: string[];
  note?: string;
  isExpired?: boolean;
  ad?: { text: string; url?: string };
  contributors?: Array<{ name: string; amount: string }>; // New: track who added to the tip
  totalAmount?: string; // New: total amount including contributions
  isFinalized?: boolean; // New: shows if tip was finalized
  payoutPerUser?: string; // New: amount each user received
}) {
  let description = `🐧 **${data.creator}** is sharing fish with the colony!`;

  // Show total amount if there are contributions
  if (data.totalAmount && data.contributors && data.contributors.length > 0) {
    description += `\n\n🐟 **Total Pool:** ${data.totalAmount}`;
    description += `\n💝 **Original:** ${data.amount} (by ${data.creator})`;
  } else {
    description += `\n\n🐟 **Amount:** ${data.amount}`;
  }

  if (data.note) description += `\n📝 **Message:** ${data.note}`;

  const timestamp = Math.floor(data.expiresAt.getTime() / 1000);

  const e = new EmbedBuilder()
    .setTitle("🎉🐧 Colony Fish Sharing!")
    .setDescription(description)
    .setColor(0x38d9a9) // Teal
    .addFields(
      { name: "🐧 Colony Members", value: `${data.claimCount} penguins`, inline: true },
      {
        name: data.isExpired ? "⏰ Status" : "⏰ Timer",
        value: data.isExpired
          ? (data.isFinalized
              ? `✅ Fish distributed!${data.payoutPerUser ? `\n💰 Each penguin got: ${data.payoutPerUser}` : ''}`
              : "🚫 Fish sharing ended")
          : `⏳ Ends <t:${timestamp}:R>`,
        inline: true,
      },
      {
        name: "🎣 Fish Claimed By",
        value: data.claimedBy.length
          ? data.claimedBy.slice(0, 10).join(", ") + (data.claimedBy.length > 10 ? "..." : "")
          : "🐧 No one yet - be the first!",
        inline: false,
      }
    );

  // Add contributors section if there are any
  if (data.contributors && data.contributors.length > 0) {
    const contributorsList = data.contributors
      .slice(0, 5) // Show max 5 contributors
      .map(c => `• ${c.name}: ${c.amount}`)
      .join("\n");

    const moreContributors = data.contributors.length > 5 ? `\n*+${data.contributors.length - 5} more contributors*` : "";

    e.addFields({
      name: "🤝 Colony Contributors",
      value: contributorsList + moreContributors,
      inline: false
    });
  }

  e.setTimestamp(data.expiresAt);

  // Sponsored content section
  if (data.ad) {
    e.addFields({
      name: "📢 Sponsored",
      value: data.ad.url ? `[${data.ad.text}](${data.ad.url})` : data.ad.text,
      inline: false,
    });
  }

  if (data.isExpired) e.setColor(0x999999); // Gray for expired
  return e;
}