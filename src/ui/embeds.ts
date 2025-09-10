// src/ui/embeds.ts
import { EmbedBuilder } from "discord.js";
import type { PipMove } from "../services/matches.js";
import { fmtDec } from "../services/token.js";

export function profileEmbed(u: {
  agwAddress?: string | null;
  balanceAtomic: any; // Now expects formatted string like "50 PENGU, 100 USDC" or Prisma.Decimal for legacy
  wins: number; losses: number; ties: number;
}) {
  // Handle both new multi-token format (string) and legacy format (Decimal)
  const balanceDisplay = typeof u.balanceAtomic === 'string' 
    ? u.balanceAtomic 
    : fmtDec(u.balanceAtomic);

  return new EmbedBuilder()
    .setTitle("Penguin Ice Pebble Profile")
    .addFields(
      { name: "Wallet", value: u.agwAddress ?? "Not linked", inline: false },
      { name: "Balance", value: balanceDisplay, inline: true },
      { name: "Record", value: `${u.wins}W ${u.losses}L ${u.ties}T`, inline: true },
    );
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