// src/interactions/pip_buttons.ts
import type { ButtonInteraction } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../services/db.js";
import { PipMove, judge, label } from "../services/matches.js";
import { publicJoinRow, cancelRow } from "../ui/components.js";
import { matchOfferEmbed, matchResultEmbed } from "../ui/embeds.js";
import { decToBigDirect, bigToDecDirect, formatAmount, formatDecimal } from "../services/token.js";
import { debitTokenTx, creditTokenTx } from "../services/balances.js";
import { getConfig } from "../config.js";
import { getActiveAd } from "../services/ads.js";

// payout helper uses dynamic house fee (bps) from AppConfig
function rpsPayout(wagerAtomic: bigint, houseFeeBps: bigint) {
  const pot = 2n * wagerAtomic;
  const rake = (pot * houseFeeBps) / 10000n;
  const payout = pot - rake;
  return { pot, rake, payout };
}

/** Challenger locks their secret move and posts the public match. */
async function handlePick(i: ButtonInteraction, matchId: number, move: PipMove) {
  // Acknowledge immediately to avoid 3s timeout
  await i.deferUpdate().catch(() => {});

  const m = await prisma.match.findUnique({
    where: { id: matchId },
    include: { Challenger: true, Token: true }
  });
  if (!m) return i.followUp({ content: "Match not found.", ephemeral: true });
  if (m.Challenger.discordId !== i.user.id) {
    return i.followUp({ content: "Not your match.", ephemeral: true });
  }
  if (m.status !== "DRAFT") {
    return i.followUp({ content: "Already offered.", ephemeral: true });
  }

  const offerDeadline = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  const updated = await prisma.match.update({
    where: { id: m.id },
    data: { status: "OFFERED", challengerMove: move, offerDeadline }
  });

  const ch = await i.client.channels.fetch(i.channelId!);
  if (!ch?.isTextBased() || !("send" in ch)) {
    return i.followUp({ content: "Cannot post match in this channel.", ephemeral: true });
  }

  const wagerAtomic = decToBigDirect(updated.wagerAtomic, m.Token.decimals);
  const wagerTxt = formatAmount(wagerAtomic, m.Token);
  const ad = await getActiveAd();

  const msg = await (ch as any).send({
    embeds: [
      matchOfferEmbed(
        `<@${m.Challenger.discordId}>`,
        wagerTxt,
        ad ?? undefined
      )
    ],
    components: [publicJoinRow(updated.id), cancelRow(updated.id)]
  });

  await prisma.match.update({
    where: { id: updated.id },
    data: { messageId: msg.id, channelId: msg.channelId }
  });

  // Edit the original ephemeral message shown to the challenger
  await i.editReply({
    content: "Move locked. Your public match is posted.",
    components: []
  }).catch(() => {});
}

/** Opponent joins with their move; match resolves immediately. */
async function handleJoin(i: ButtonInteraction, matchId: number, move: PipMove) {
  // Ack fast
  await i.deferReply({ ephemeral: true }).catch(() => {});
  const cfg = await getConfig();
  const houseFeeBps = BigInt(cfg.houseFeeBps ?? 200);

  try {
    const settled = await prisma.$transaction(async (tx) => {
      const m = await tx.match.findUnique({
        where: { id: matchId },
        include: { Challenger: true, Token: true }
      });
      if (!m) throw new Error("Match not found");
      if (m.status !== "OFFERED") throw new Error("Not available");
      if (m.Challenger.discordId === i.user.id) {
        throw new Error("You cannot join your own match");
      }
      if (m.offerDeadline && m.offerDeadline.getTime() < Date.now()) {
        await tx.match.update({ where: { id: m.id }, data: { status: "EXPIRED" }});
        throw new Error("Match expired");
      }

      // lock to prevent double-joins
      await tx.match.update({ where: { id: m.id }, data: { status: "LOCKED" }});

      // ensure joiner row
      const joiner = await tx.user.upsert({
        where: { discordId: i.user.id },
        update: {},
        create: { discordId: i.user.id }
      });

      const wager = decToBigDirect(m.wagerAtomic, m.Token.decimals);

      // Debit joiner's balance INSIDE THIS TX (no nested transactions)
      await debitTokenTx(tx, i.user.id, m.Token.id, wager, "MATCH_WAGER", {
        guildId: i.guildId ?? null
      });

      // resolve outcome
      const outcome = judge(m.challengerMove as PipMove, move);
      let result: "TIE" | "WIN_CHALLENGER" | "WIN_JOINER" = "TIE";
      let rakeBig = 0n;
      let winnerUserId: number | null = null;

      if (outcome === 0) {
        // tie → refund both, increment ties
        await creditTokenTx(tx, i.user.id, m.Token.id, wager, "MATCH_PAYOUT", {
          guildId: i.guildId ?? null
        });
        await creditTokenTx(tx, m.Challenger.discordId, m.Token.id, wager, "MATCH_PAYOUT", {
          guildId: i.guildId ?? null
        });

        await tx.user.update({
          where: { id: joiner.id },
          data: { ties: { increment: 1 } }
        });
        await tx.user.update({
          where: { id: m.Challenger.id },
          data: { ties: { increment: 1 } }
        });
      } else {
        const { rake, payout } = rpsPayout(wager, houseFeeBps);
        rakeBig = rake;

        if (outcome === 1) {
          // challenger wins
          result = "WIN_CHALLENGER";
          winnerUserId = m.Challenger.id;

          await creditTokenTx(tx, m.Challenger.discordId, m.Token.id, payout, "MATCH_PAYOUT", {
            guildId: i.guildId ?? null
          });

          await tx.user.update({
            where: { id: m.Challenger.id },
            data: { wins: { increment: 1 } }
          });
          await tx.user.update({
            where: { id: joiner.id },
            data: { losses: { increment: 1 } }
          });
        } else {
          // joiner wins
          result = "WIN_JOINER";
          winnerUserId = joiner.id;

          await creditTokenTx(tx, i.user.id, m.Token.id, payout, "MATCH_PAYOUT", {
            guildId: i.guildId ?? null
          });

          await tx.user.update({
            where: { id: joiner.id },
            data: { wins: { increment: 1 } }
          });
          await tx.user.update({
            where: { id: m.Challenger.id },
            data: { losses: { increment: 1 } }
          });
        }

        // 🔹 Log the house rake as a Transaction inside the SAME DB tx
        if (rakeBig > 0n) {
          await tx.transaction.create({
            data: {
              type: "MATCH_RAKE",
              userId: null,
              otherUserId: null,
              guildId: i.guildId ?? null,
              tokenId: m.Token.id,
              amount: bigToDecDirect(rakeBig, m.Token.decimals), // Decimal string
              fee: "0",
              txHash: null,
              metadata: "house rake"
            }
          });
        }
      }

      // finalize match row
const final = await tx.match.update({
  where: { id: m.id },
  data: {
    status: "SETTLED",
    joinerId: joiner.id, // keep joiner even on ties
    joinerMove: move,
    result,
    rakeAtomic: bigToDecDirect(rakeBig, m.Token.decimals),
    winnerUserId
  },
  include: { Challenger: true, Joiner: true, Token: true }
});


      return final;
    }, { timeout: 15000, maxWait: 15000 });

    // Update the public match message (AFTER COMMIT)
    try {
      const ch2 = await i.client.channels.fetch(settled.channelId!);
      if (ch2?.isTextBased() && "messages" in ch2 && settled.messageId) {
        const challengerTag = `<@${settled.Challenger.discordId}>`;
        const joinerTag = settled.Joiner ? `<@${settled.Joiner.discordId}>` : "Opponent";

        const potBig = 2n * decToBigDirect(settled.wagerAtomic, settled.Token.decimals);
        const rakeBig = decToBigDirect(settled.rakeAtomic, settled.Token.decimals);
        const payoutBig = potBig - rakeBig;

        const outcomeLine =
          settled.result === "TIE" ? "Tie. Both refunded." :
          settled.result === "WIN_CHALLENGER" ? `${challengerTag} wins` :
          `${joinerTag} wins`;

        const ad = await getActiveAd();

        await (ch2 as any).messages.edit(settled.messageId, {
          embeds: [matchResultEmbed({
            challengerTag,
            joinerTag,
            challengerMove: label(settled.challengerMove as PipMove),
            joinerMove: label(settled.joinerMove as PipMove),
            resultLine: outcomeLine,
            payoutText: settled.result === "TIE" ? undefined : formatAmount(payoutBig, settled.Token),
            rakeText: settled.result === "TIE" ? undefined : formatAmount(rakeBig, settled.Token),
            potText: formatAmount(potBig, settled.Token),
            challengerStats: {
              wins: settled.Challenger.wins,
              losses: settled.Challenger.losses, 
              ties: settled.Challenger.ties
            },
            joinerStats: settled.Joiner ? {
              wins: settled.Joiner.wins,
              losses: settled.Joiner.losses,
              ties: settled.Joiner.ties
            } : undefined,
            ad: ad ?? undefined,
          })],
          components: []
        });
      }
    } catch {
      // ignore edit failures
    }

    await i.editReply({ content: "Match resolved." }).catch(() => {});
  } catch (err: any) {
    await i.editReply({ content: `Failed to join: ${err?.message || String(err)}` }).catch(() => {});
  }
}

/** Challenger cancels their offered match (refund). */
async function handleCancel(i: ButtonInteraction, matchId: number) {
  // Ack fast
  await i.deferReply({ ephemeral: true }).catch(() => {});

  try {
    const result = await prisma.$transaction(async (tx) => {
      const m = await tx.match.findUnique({
        where: { id: matchId },
        include: { Challenger: true, Token: true }
      });
      if (!m) throw new Error("Match not found");
      if (m.status !== "OFFERED") throw new Error("Cannot cancel now");
      if (m.Challenger.discordId !== i.user.id) throw new Error("Only the challenger can cancel");

      const wager = decToBigDirect(m.wagerAtomic, m.Token.decimals);

      // refund challenger using tx-aware credit
      await creditTokenTx(tx, m.Challenger.discordId, m.Token.id, wager, "MATCH_PAYOUT", {
        guildId: i.guildId ?? null
      });

      const updated = await tx.match.update({
        where: { id: m.id },
        data: { status: "CANCELED" }
      });

      return { updated, channelId: m.channelId, messageId: m.messageId };
    }, { timeout: 15000, maxWait: 15000 });

    // Update posted message after commit
    try {
      if (result.channelId && result.messageId) {
        const ch = await i.client.channels.fetch(result.channelId);
        if (ch?.isTextBased() && "messages" in ch) {
          await (ch as any).messages.edit(result.messageId, {
            content: "Match canceled and refunded.",
            embeds: [],
            components: []
          });
        }
      }
    } catch {}

    await i.editReply({ content: "Canceled." }).catch(() => {});
  } catch (err: any) {
    await i.editReply({ content: `Failed to cancel: ${err?.message || String(err)}` }).catch(() => {});
  }
}

/** Handle tier purchase button */
async function handleBuyTier(i: ButtonInteraction, tierId: number) {
  await i.deferReply({ ephemeral: true }).catch(() => {});

  try {
    // Get the specific tier with pricing
    const tier = await prisma.tier.findUnique({
      where: { id: tierId, active: true },
      include: { 
        prices: { 
          include: { token: true } 
        } 
      }
    });

    if (!tier) {
      return i.editReply({ content: "This membership tier is no longer available." });
    }

    if (tier.prices.length === 0) {
      return i.editReply({ content: "No pricing configured for this tier. Please contact an administrator." });
    }

    // Create payment method selection buttons
    const paymentButtons = tier.prices.map(price => {
      return new ButtonBuilder()
        .setCustomId(`pip:confirm_purchase:${tier.id}:${price.tokenId}`)
        .setLabel(`Pay with ${formatDecimal(price.amount, price.token.symbol)}`)
        .setStyle(ButtonStyle.Primary)
        .setEmoji("💰");
    });

    const paymentRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(paymentButtons.slice(0, 5)); // Max 5 buttons per row

    const benefits = tier.tipTaxFree ? "🎉 Tax-free tipping" : "Standard benefits";
    
    await i.editReply({
      content: `**💳 Purchase ${tier.name}**\n\n` +
               `⏱️ **Duration:** ${tier.durationDays} days\n` +
               `✨ **Benefits:** ${benefits}\n` +
               (tier.description ? `📝 **Description:** ${tier.description}\n` : '') +
               `\n**Choose your payment method:**`,
      components: [paymentRow]
    });

  } catch (err: any) {
    console.error("Buy tier error:", err);
    await i.editReply({ 
      content: `Error processing purchase: ${err?.message || String(err)}` 
    }).catch(() => {});
  }
}

/** Handle purchase confirmation */
async function handleConfirmPurchase(i: ButtonInteraction, tierId: number, tokenId: number) {
  await i.deferReply({ ephemeral: true }).catch(() => {});

  try {
    await prisma.$transaction(async (tx) => {
      // Get user
      const user = await tx.user.upsert({
        where: { discordId: i.user.id },
        update: {},
        create: { discordId: i.user.id }
      });

      // Get tier and pricing
      const tierPrice = await tx.tierPrice.findUnique({
        where: { 
          tierId_tokenId: { tierId, tokenId }
        },
        include: { 
          tier: true, 
          token: true 
        }
      });

      if (!tierPrice || !tierPrice.tier.active) {
        throw new Error("Membership tier or pricing not available.");
      }

      // Check user balance
      const userBalance = await tx.userBalance.findUnique({
        where: { 
          userId_tokenId: { userId: user.id, tokenId } 
        }
      });

      const currentBalance = Number(userBalance?.amount || 0);
      const requiredAmount = Number(tierPrice.amount);

      if (currentBalance < requiredAmount) {
        throw new Error(`Insufficient balance. You have ${formatDecimal(currentBalance, tierPrice.token.symbol)}, but need ${formatDecimal(requiredAmount, tierPrice.token.symbol)}.`);
      }

      // Check for existing active membership of the same tier
      const existingMembership = await tx.tierMembership.findFirst({
        where: {
          userId: user.id,
          tierId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() }
        }
      });

      if (existingMembership) {
        throw new Error(`You already have an active ${tierPrice.tier.name} membership.`);
      }

      // Deduct payment from user balance
      await tx.userBalance.update({
        where: { userId_tokenId: { userId: user.id, tokenId } },
        data: { 
          amount: { 
            decrement: tierPrice.amount 
          }
        }
      });

      // Create membership
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + tierPrice.tier.durationDays);

      await tx.tierMembership.create({
        data: {
          userId: user.id,
          tierId,
          expiresAt,
          status: 'ACTIVE'
        }
      });

      // Log transaction
      await tx.transaction.create({
        data: {
          type: 'MEMBERSHIP_PURCHASE',
          userId: user.id,
          tokenId,
          amount: tierPrice.amount,
          fee: '0',
          metadata: `${tierPrice.tier.name} membership`
        }
      });
    });

    // Check if this was an extension (user already had this tier)
    const existingMembership = await prisma.tierMembership.findFirst({
      where: {
        userId: (await prisma.user.findUnique({ where: { discordId: i.user.id } }))?.id,
        tierId,
        status: 'ACTIVE'
      },
      include: { tier: true }
    });

    const isExtension = existingMembership ? true : false;
    const successMessage = isExtension 
      ? `🎉 **Membership Extended Successfully!**\n\nYour membership has been extended. Check your profile to see your updated expiry date.`
      : `🎉 **Membership Purchased Successfully!**\n\nYou now have access to premium features. Check your profile to see your new membership status.`;

    await i.editReply({
      content: successMessage
    });

  } catch (err: any) {
    console.error("Confirm purchase error:", err);
    await i.editReply({
      content: `❌ Purchase failed: ${err?.message || String(err)}`
    }).catch(() => {});
  }
}

/** Handle membership purchase button */
async function handlePurchaseMembership(i: ButtonInteraction) {
  await i.deferReply({ ephemeral: true }).catch(() => {});

  try {
    // Get available tiers
    const activeTiers = await prisma.tier.findMany({
      where: { active: true },
      include: { 
        prices: { 
          include: { token: true } 
        } 
      },
      orderBy: { priceAmount: 'asc' }
    });

    if (activeTiers.length === 0) {
      return i.editReply({ content: "No membership tiers are currently available." });
    }

    // Check if user has any active memberships to customize messaging
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
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

    const hasActiveMemberships = user?.tierMemberships && user.tierMemberships.length > 0;

    // Create tier selection embed
    const tiersList = activeTiers.map((tier, index) => {
      const prices = tier.prices.map(p => 
        `${formatDecimal(p.amount, p.token.symbol)}`
      ).join(" or ");
      
      const benefits = tier.tipTaxFree ? "🎉 Tax-free tipping" : "Standard benefits";
      
      return `**${index + 1}. ${tier.name}** (${tier.durationDays} days)\n` +
             `💰 Cost: ${prices}\n` +
             `✨ Benefits: ${benefits}` +
             (tier.description ? `\n📝 ${tier.description}` : "");
    }).join("\n\n");

    // Create tier selection buttons for actual purchase
    const tierButtons = activeTiers.slice(0, 5).map((tier, index) => {
      const buttonLabel = hasActiveMemberships ? `Extend ${tier.name}` : `Buy ${tier.name}`;
      return new ButtonBuilder()
        .setCustomId(`pip:buy_tier:${tier.id}`)
        .setLabel(buttonLabel)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("💳");
    });

    const actionRows = [];
    
    // Split buttons into rows (max 5 per row)
    for (let i = 0; i < tierButtons.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(tierButtons.slice(i, i + 5));
      actionRows.push(row);
    }
    const actionText = hasActiveMemberships ? 
      `Click a button below to extend your membership:` : 
      `Click a button below to purchase a membership:`;
    
    const titleText = hasActiveMemberships ? 
      `**🌟 Extend Your Membership**\n\n${tiersList}\n\n${actionText}` :
      `**🌟 Available Membership Tiers**\n\n${tiersList}\n\n${actionText}`;

    await i.editReply({
      content: titleText,
      components: actionRows
    });

  } catch (err: any) {
    console.error("Purchase membership error:", err);
    await i.editReply({ 
      content: `Error loading membership options: ${err?.message || String(err)}` 
    }).catch(() => {});
  }
}

/** Router for pip button customIds: pip:<action>:<matchId>:<move?> */
export async function handlePipButton(i: ButtonInteraction) {
  const parts = i.customId.split(":");
  const [ns, action] = parts;
  if (ns !== "pip") return;

  // Handle membership purchase (no match ID needed)
  if (action === "purchase_membership") {
    return handlePurchaseMembership(i);
  }

  // Handle tier purchase selection
  if (action === "buy_tier") {
    const tierId = Number(parts[2]);
    if (!Number.isFinite(tierId)) {
      return i.reply({ content: "Invalid tier ID.", flags: 64 });
    }
    return handleBuyTier(i, tierId);
  }

  // Handle purchase confirmation
  if (action === "confirm_purchase") {
    const tierId = Number(parts[2]);
    const tokenId = Number(parts[3]);
    if (!Number.isFinite(tierId) || !Number.isFinite(tokenId)) {
      return i.reply({ content: "Invalid purchase parameters.", flags: 64 });
    }
    return handleConfirmPurchase(i, tierId, tokenId);
  }

  // Handle match-related actions (require match ID)
  const [, , id, move] = parts;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
    return i.reply({ content: "Bad match id.", flags: 64 });
  }

  if (action === "pick") return handlePick(i, matchId, move as PipMove);
  if (action === "join") return handleJoin(i, matchId, move as PipMove);
  if (action === "cancel") return handleCancel(i, matchId);

  return i.reply({ content: "Unknown action.", flags: 64 });
}
