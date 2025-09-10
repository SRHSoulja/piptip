// src/ui/embeds.ts
import { EmbedBuilder } from "discord.js";
import type { PipMove } from "../services/matches.js";
import { fmtDec } from "../services/token.js";

export function profileEmbed(data: {
  user?: { username: string; displayName?: string | null; avatarURL?: (options?: any) => string | null };
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
  createdAt?: Date;
  hasActiveMembership?: boolean;
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

  const embed = new EmbedBuilder()
    .setTitle("🐧🧊🪨 PIPTip Profile")
    .setColor(data.hasActiveMembership ? 0xFFD700 : 0x5865F2) // Gold for premium, Discord blue for regular
    .setTimestamp();

  // Set user avatar as thumbnail if available
  if (data.user?.avatarURL) {
    const avatarUrl = data.user.avatarURL({ size: 128 });
    if (avatarUrl) embed.setThumbnail(avatarUrl);
  }

  // Basic info section
  embed.addFields(
    { name: "💳 Wallet", value: data.agwAddress ?? "Not linked", inline: false },
    { name: "💰 Balance", value: balanceDisplay, inline: true },
    { name: "🎮 Game Record", value: `${data.wins}W ${data.losses}L ${data.ties}T`, inline: true }
  );

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

  // Tipping statistics
  if (data.tippingStats) {
    const { sentText, receivedText, sentCount, receivedCount } = data.tippingStats;
    
    embed.addFields(
      { 
        name: "💸 Tips Sent", 
        value: sentText, 
        inline: true 
      },
      { 
        name: "💝 Tips Received", 
        value: receivedText, 
        inline: true 
      },
      { 
        name: "📊 Total Activity", 
        value: `${sentCount + receivedCount} total tips\n${sentCount} sent • ${receivedCount} received`, 
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

  return embed;
}

/** Public offer embed */
export function matchOfferEmbed(challengerTag: string, wagerText: string, ad?: { text: string; url?: string }) {
  const e = new EmbedBuilder()
    .setTitle("🐧🧊🪨 Penguin Ice Pebble — Challenge!")
    .setDescription(
      `${challengerTag} has started a match.\n**Wager:** ${wagerText}\nClick a button to join.`
    );

  if (ad) {
    e.addFields({
      name: "Sponsored",
      value: ad.url ? `[${ad.text}](${ad.url})` : ad.text,
    });
  }

  return e;
}

/** Result embed */
export function matchResultEmbed(opts: {
  challengerTag: string;
  joinerTag: string;
  challengerMove: string;
  joinerMove: string;
  resultLine: string;
  payoutText?: string;
  rakeText?: string;
  ad?: { text: string; url?: string };  // NEW
}) {
  const e = new EmbedBuilder()
    .setTitle("Match Result")
    .addFields(
      { name: "Challenger", value: `${opts.challengerTag} — ${opts.challengerMove}`, inline: true },
      { name: "Joiner", value: `${opts.joinerTag} — ${opts.joinerMove}`, inline: true },
      { name: "Outcome", value: opts.resultLine, inline: false },
    );

  if (opts.payoutText) e.addFields({ name: "Payout", value: opts.payoutText, inline: true });
  if (opts.rakeText)   e.addFields({ name: "House Rake", value: opts.rakeText, inline: true });

  // add sponsor/ad if passed
  if (opts.ad) {
    e.addFields({
      name: "Sponsored",
      value: opts.ad.url ? `[${opts.ad.text}](${opts.ad.url})` : opts.ad.text,
      inline: false,
    });
  }

  return e;
}

/** labels */
export function label(move: PipMove) {
  return move === "penguin" ? "🐧 Penguin"
       : move === "ice"     ? "🧊 Ice"
       : "🪨 Pebble";
}

export function groupTipEmbed(data: {
  creator: string;
  amount: string;
  expiresAt: Date;
  claimCount: number;
  claimedBy: string[];
  note?: string;
  isExpired?: boolean;
  ad?: { text: string; url?: string }; // ADD THIS LINE
}) {
  let description = `${data.creator} is sharing ${data.amount}!`;
  if (data.note) description += `\n📝 ${data.note}`;

  const timestamp = Math.floor(data.expiresAt.getTime() / 1000);

  const e = new EmbedBuilder()
    .setTitle("🎉 Group Tip")
    .setDescription(description)
    .addFields(
      { name: "Claimants", value: `${data.claimCount} people`, inline: true },
      {
        name: data.isExpired ? "Expired" : "Expires",
        value: data.isExpired ? "This tip has expired" : `<t:${timestamp}:R>`,
        inline: true,
      },
      {
        name: "Who Claimed",
        value: data.claimedBy.length
          ? data.claimedBy.slice(0, 10).join(", ") + (data.claimedBy.length > 10 ? "..." : "")
          : "None yet",
        inline: false,
      }
    )
    .setTimestamp(data.expiresAt);

  // ADD THIS SECTION:
  if (data.ad) {
    e.addFields({
      name: "Sponsored",
      value: data.ad.url ? `[${data.ad.text}](${data.ad.url})` : data.ad.text,
      inline: false,
    });
  }

  if (data.isExpired) e.setColor(0x999999);
  return e;
}