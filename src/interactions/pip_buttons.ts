// src/interactions/pip_buttons.ts
import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { prisma } from "../services/db.js";
import { PipMove, judge, label } from "../services/matches.js";
import { publicJoinRow, cancelRow } from "../ui/components.js";
import { matchOfferEmbed, matchResultEmbed } from "../ui/embeds.js";
import { decToBigDirect, bigToDecDirect, formatAmount, formatDecimal, toAtomicDirect } from "../services/token.js";
import { debitTokenTx, creditTokenTx } from "../services/balances.js";
import { getConfig } from "../config.js";
import { getActiveAd } from "../services/ads.js";
import { EmbedBuilder } from "discord.js";

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
  if (!m) return i.followUp({ content: "Match not found.", flags: 64 });
  if (!m.Challenger) {
    return i.followUp({ content: "Match challenger not found.", flags: 64 });
  }
  if (m.Challenger.discordId !== i.user.id) {
    return i.followUp({ content: "Not your match.", flags: 64 });
  }
  if (m.status !== "DRAFT") {
    return i.followUp({ content: "Already offered.", flags: 64 });
  }

  const offerDeadline = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  const updated = await prisma.match.update({
    where: { id: m.id },
    data: { status: "OFFERED", challengerMove: move, offerDeadline }
  });

  const ch = await i.client.channels.fetch(i.channelId!);
  if (!ch?.isTextBased() || !("send" in ch)) {
    return i.followUp({ content: "Cannot post match in this channel.", flags: 64 });
  }

  const wagerAtomic = decToBigDirect(updated.wagerAtomic, m.Token.decimals);
  const wagerTxt = formatAmount(wagerAtomic, m.Token);
  const ad = await getActiveAd();

  const msg = await (ch as any).send({
    embeds: [
      matchOfferEmbed(
        `<@${m.Challenger?.discordId || 'Unknown'}>`,
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
      if (!m.Challenger) {
        throw new Error("Match challenger not found");
      }
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
        if (!m.Challenger) {
          throw new Error("Match challenger not found");
        }
        await creditTokenTx(tx, m.Challenger.discordId, m.Token.id, wager, "MATCH_PAYOUT", {
          guildId: i.guildId ?? null
        });

        await tx.user.update({
          where: { id: joiner.id },
          data: { ties: { increment: 1 } }
        });
        if (!m.Challenger) {
          throw new Error("Match challenger not found");
        }
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
          if (!m.Challenger) {
            throw new Error("Match challenger not found");
          }
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
          if (!m.Challenger) {
            throw new Error("Match challenger not found");
          }
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
              amount: rakeBig.toString(), // Store atomic units, not converted amounts
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
    rakeAtomic: rakeBig.toString(), // Store atomic units, not converted amounts
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
        const challengerTag = settled.Challenger ? `<@${settled.Challenger.discordId}>` : "Unknown Challenger";
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
            challengerStats: settled.Challenger ? {
              wins: settled.Challenger.wins,
              losses: settled.Challenger.losses, 
              ties: settled.Challenger.ties
            } : { wins: 0, losses: 0, ties: 0 },
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
      if (!m.Challenger) throw new Error("Match challenger not found");
      if (m.Challenger.discordId !== i.user.id) throw new Error("Only the challenger can cancel");

      const wager = decToBigDirect(m.wagerAtomic, m.Token.decimals);

      // refund challenger using tx-aware credit
      if (!m.Challenger) throw new Error("Match challenger not found");
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
export async function handlePipButton(i: ButtonInteraction | ModalSubmitInteraction) {
  const parts = i.customId.split(":");
  const [ns, action] = parts;
  if (ns !== "pip") return;

  // Handle membership purchase (no match ID needed)
  if (action === "purchase_membership") {
    return handlePurchaseMembership(i);
  }

  // Handle profile refresh
  if (action === "refresh_profile") {
    return handleRefreshProfile(i);
  }

  // Handle profile dismiss
  if (action === "dismiss_profile") {
    return handleDismissProfile(i);
  }

  // Handle new guided action buttons
  if (action === "show_deposit_instructions") {
    return handleShowDepositInstructions(i);
  }

  if (action === "view_profile") {
    return handleViewProfile(i);
  }

  if (action === "show_help") {
    return handleShowHelp(i);
  }

  if (action === "prompt_link_wallet") {
    return handlePromptLinkWallet(i);
  }

  // Handle deposit token selection
  if (action === "deposit_token") {
    return handleDepositToken(i, parts);
  }

  if (action === "cancel_deposit") {
    return handleCancelDeposit(i);
  }

  // Handle withdraw token selection
  if (action === "withdraw_token") {
    return handleWithdrawToken(i, parts);
  }

  if (action === "cancel_withdraw") {
    return handleCancelWithdraw(i);
  }

  // Handle withdraw amount selection
  if (action === "withdraw_amount") {
    return handleWithdrawAmount(i, parts);
  }

  if (action === "withdraw_custom") {
    return handleWithdrawCustom(i, parts);
  }

  if (action === "back_to_withdraw") {
    return handleBackToWithdraw(i);
  }

  // Handle withdraw confirmation
  if (action === "confirm_withdraw") {
    return handleConfirmWithdraw(i, parts);
  }

  // Handle modal submissions
  if (action === "withdraw_custom_modal") {
    return handleWithdrawCustomModal(i as ModalSubmitInteraction, parts);
  }

  // Handle stats actions
  if (action === "export_csv") {
    return handleExportCSV(i);
  }

  if (action === "refresh_stats") {
    return handleRefreshStats(i);
  }

  if (action === "dismiss_stats") {
    return handleDismissStats(i);
  }

  // Handle tip token selection
  if (action === "select_token") {
    return handleSelectToken(i, parts);
  }

  // Handle tip cancellation
  if (action === "cancel_tip") {
    return handleCancelTip(i);
  }

  // Handle group tip duration selection
  if (action === "select_duration") {
    return handleSelectDuration(i, parts);
  }

  // Handle tip confirmation
  if (action === "confirm_tip") {
    return handleConfirmTip(i, parts);
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

/** Handle profile refresh button */
async function handleRefreshProfile(i: ButtonInteraction) {
  await i.deferUpdate().catch(() => {});
  
  try {
    // Import the shared profile service
    const { generateProfileData, createProfileButtons, createProfileEmbed, activeProfileRequests, trackProfileRequest, releaseProfileRequest } = await import("../services/profile.js");
    
    const userId = i.user.id;
    
    // Check if user already has a profile request processing
    if (activeProfileRequests.has(userId)) {
      return await i.editReply({
        content: "⏳ Profile refresh already in progress! Please wait.",
        embeds: [],
        components: []
      });
    }
    
    // Add user to active requests with timeout
    trackProfileRequest(userId);
    
    // Generate fresh profile data
    const profileData = await generateProfileData(userId, i.user);
    const profileButtons = createProfileButtons(profileData.activeMemberships);
    const embed = createProfileEmbed(profileData);
    
    // Update with fresh profile
    await i.editReply({
      content: null,
      embeds: [embed],
      components: [profileButtons]
    });
    
  } catch (error: any) {
    console.error("Profile refresh error:", error);
    await i.editReply({
      content: `❌ **Failed to refresh profile**\n${error?.message || String(error)}\n\n*Please try using the /profile command instead.*`,
      embeds: [],
      components: []
    }).catch(() => {});
  } finally {
    // Always remove user from active requests
    const { releaseProfileRequest: release } = await import("../services/profile.js");
    release(i.user.id);
  }
}

/** Handle tip token selection */
async function handleSelectToken(i: ButtonInteraction, parts: string[]) {
  await i.deferUpdate().catch(() => {});
  
  try {
    // Parse button data: pip:select_token:amount:tipType:target:note:tokenId
    const [, , amount, tipType, target, encodedNote, tokenId] = parts;
    const note = decodeURIComponent(encodedNote);
    
    if (tipType === "direct") {
      // Direct tip - go straight to confirmation
      return showTipConfirmation(i, {
        amount: Number(amount),
        tipType: "direct",
        targetUserId: target,
        note,
        tokenId: Number(tokenId)
      });
    } else {
      // Group tip - show duration selection first
      return showDurationSelection(i, {
        amount: Number(amount),
        note,
        tokenId: Number(tokenId)
      });
    }
  } catch (error: any) {
    console.error("Token selection error:", error);
    await i.editReply({
      content: `❌ **Failed to process token selection**\n${error?.message || String(error)}`,
      embeds: [],
      components: []
    });
  }
}

/** Handle tip cancellation */
async function handleCancelTip(i: ButtonInteraction) {
  await i.deferUpdate().catch(() => {});
  
  await i.editReply({
    content: "❌ **Tip cancelled**\n*Use `/pip_tip` to start a new tip.*",
    embeds: [],
    components: []
  });
}

/** Handle group tip duration selection */
async function handleSelectDuration(i: ButtonInteraction, parts: string[]) {
  await i.deferUpdate().catch(() => {});
  
  try {
    // Parse: pip:select_duration:amount:note:tokenId:duration
    const [, , amount, encodedNote, tokenId, duration] = parts;
    const note = decodeURIComponent(encodedNote);
    
    return showTipConfirmation(i, {
      amount: Number(amount),
      tipType: "group", 
      note,
      tokenId: Number(tokenId),
      duration: Number(duration)
    });
  } catch (error: any) {
    console.error("Duration selection error:", error);
    await i.editReply({
      content: `❌ **Failed to process duration selection**\n${error?.message || String(error)}`,
      embeds: [],
      components: []
    });
  }
}

/** Handle final tip confirmation */
async function handleConfirmTip(i: ButtonInteraction, parts: string[]) {
  await i.deferUpdate().catch(() => {});
  
  try {
    // Parse: pip:confirm_tip:amount:tipType:target:note:tokenId:duration?
    const [, , amount, tipType, target, encodedNote, tokenId, duration] = parts;
    const note = decodeURIComponent(encodedNote);
    
    // Import the original tip logic
    const { processTip } = await import("../services/tip_processor.js");
    
    const tipData = {
      amount: Number(amount),
      tipType,
      targetUserId: target !== "group" ? target : undefined,
      note,
      tokenId: Number(tokenId),
      duration: duration ? Number(duration) : undefined,
      userId: i.user.id,
      guildId: i.guildId,
      channelId: i.channelId
    };
    
    const result = await processTip(tipData, i.client);
    
    await i.editReply({
      content: `✅ **${result.message}**\n${result.details || ""}`,
      embeds: [],
      components: []
    });
    
    // Post public message if successful
    if (result.success && result.publicMessage && i.channel?.isTextBased() && "send" in i.channel) {
      await (i.channel as any).send(result.publicMessage).catch(() => {});
    }
    
  } catch (error: any) {
    console.error("Tip confirmation error:", error);
    await i.editReply({
      content: `❌ **Tip failed**\n${error?.message || String(error)}\n\n*You can try again with a new tip command.*`,
      embeds: [],
      components: []
    });
  }
}

/** Handle profile dismiss button */
async function handleDismissProfile(i: ButtonInteraction) {
  await i.deferUpdate().catch(() => {});
  
  try {
    await i.editReply({
      content: "👋 **Profile dismissed**\n*Use the `/profile` command to view your profile again.*",
      embeds: [],
      components: []
    });
  } catch (error: any) {
    console.error("Profile dismiss error:", error);
    // If edit fails, try to reply with a simple message
    await i.followUp({
      content: "Profile dismissed.",
      flags: 64
    }).catch(() => {});
  }
}

// ========== Enhanced Tip Interface Helpers ==========

/** Show duration selection for group tips */
async function showDurationSelection(i: ButtonInteraction, data: { amount: number; note: string; tokenId: number }) {
  const { getActiveTokens } = await import("../services/token.js");
  const tokens = await getActiveTokens();
  const token = tokens.find(t => t.id === data.tokenId);
  
  if (!token) {
    return i.editReply({
      content: "❌ **Token not found**\nThe selected token is no longer available.",
      embeds: [],
      components: []
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("⏰ Choose Group Tip Duration")
    .setDescription(
      `**Amount:** ${data.amount} ${token.symbol}\n` +
      `**Type:** Group Tip\n` +
      (data.note ? `**Note:** ${data.note}\n` : "") +
      `\n🎉 **Select how long people can claim this tip:**`
    )
    .setColor(0xFFD700)
    .setFooter({ text: "Everyone in the channel can claim until it expires" })
    .setTimestamp();

  const durationButtons = [
    { label: "5 min", value: 5, emoji: "⚡" },
    { label: "10 min", value: 10, emoji: "🔥" },
    { label: "15 min", value: 15, emoji: "⏰" },
    { label: "30 min", value: 30, emoji: "🕕" },
    { label: "60 min", value: 60, emoji: "🕐" }
  ].map(d => 
    new ButtonBuilder()
      .setCustomId(`pip:select_duration:${data.amount}:${encodeURIComponent(data.note)}:${data.tokenId}:${d.value}`)
      .setLabel(d.label)
      .setStyle(ButtonStyle.Primary)
      .setEmoji(d.emoji)
  );

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(durationButtons);
  
  const cancelRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("pip:cancel_tip")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❌")
    );

  await i.editReply({
    embeds: [embed],
    components: [actionRow, cancelRow]
  });
}

/** Show final confirmation screen */
async function showTipConfirmation(i: ButtonInteraction, data: {
  amount: number;
  tipType: string;
  targetUserId?: string;
  note: string;
  tokenId: number;
  duration?: number;
}) {
  const { getActiveTokens } = await import("../services/token.js");
  const { userHasActiveTaxFreeTier } = await import("../services/tiers.js");
  const { getConfig } = await import("../config.js");
  
  const tokens = await getActiveTokens();
  const token = tokens.find(t => t.id === data.tokenId);
  
  if (!token) {
    return i.editReply({
      content: "❌ **Token not found**\nThe selected token is no longer available.",
      embeds: [],
      components: []
    });
  }

  // Calculate fees
  const cfg = await getConfig();
  const fromUser = await prisma.user.findUnique({ where: { discordId: i.user.id } });
  const taxFree = fromUser ? await userHasActiveTaxFreeTier(fromUser.id) : false;
  const feeBpsNum = taxFree ? 0 : (token.tipFeeBps ?? cfg?.tipFeeBps ?? 100);
  const feePercent = feeBpsNum / 100;
  const feeAmount = data.amount * feePercent / 100;
  const totalCost = data.amount + feeAmount;

  const tipEmoji = data.tipType === "direct" ? "💸" : "🎉";
  const embed = new EmbedBuilder()
    .setTitle(`${tipEmoji} Confirm Your Tip`)
    .setDescription(
      `**Type:** ${data.tipType === "direct" ? "Direct Tip" : "Group Tip"}\n` +
      `**Amount:** ${data.amount} ${token.symbol}\n` +
      `**Fee:** ${feeAmount.toFixed(8)} ${token.symbol} ${taxFree ? "(Tax-free tier)" : `(${feePercent}%)`}\n` +
      `**Total Cost:** ${totalCost.toFixed(8)} ${token.symbol}\n` +
      (data.tipType === "direct" && data.targetUserId ? `**Recipient:** <@${data.targetUserId}>\n` : "") +
      (data.tipType === "group" && data.duration ? `**Duration:** ${data.duration} minutes\n` : "") +
      (data.note ? `**Note:** ${data.note}\n` : "") +
      `\n${data.tipType === "direct" ? "💰 Send tip directly to user" : "🎉 Create group tip for everyone"}`
    )
    .setColor(data.tipType === "direct" ? 0x00FF00 : 0xFFD700)
    .setFooter({ text: "Click confirm to process the tip" })
    .setTimestamp();

  const confirmButton = new ButtonBuilder()
    .setCustomId(`pip:confirm_tip:${data.amount}:${data.tipType}:${data.targetUserId || "group"}:${encodeURIComponent(data.note)}:${data.tokenId}:${data.duration || ""}`)
    .setLabel(`Confirm ${data.tipType === "direct" ? "Direct" : "Group"} Tip`)
    .setStyle(ButtonStyle.Success)
    .setEmoji("✅");

  const cancelButton = new ButtonBuilder()
    .setCustomId("pip:cancel_tip")
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("❌");

  const actionRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(confirmButton, cancelButton);

  await i.editReply({
    embeds: [embed],
    components: [actionRow]
  });
}

/** Handle show deposit instructions button */
async function handleShowDepositInstructions(i: ButtonInteraction) {
  await i.deferReply({ ephemeral: true }).catch(() => {});
  
  try {
    // Check if user has linked wallet
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
      select: { agwAddress: true }
    });

    if (!user?.agwAddress) {
      return i.editReply({
        content: [
          "❌ **Wallet Not Linked**",
          "",
          "You need to link your wallet before getting deposit instructions.",
          "",
          "**Get an Abstract wallet:** https://abs.xyz",
          "**Then link it:** `/pip_link address:0x...`"
        ].join("\n")
      });
    }

    // Import and get available tokens
    const { getActiveTokens } = await import("../services/token.js");
    const tokens = await getActiveTokens();
    
    if (tokens.length === 0) {
      return i.editReply({
        content: "❌ No active tokens available for deposit."
      });
    }

    // Create token selection buttons
    const tokenButtons: ButtonBuilder[] = [];
    const maxButtons = Math.min(tokens.length, 15); // Discord limit
    
    for (let idx = 0; idx < maxButtons; idx++) {
      const token = tokens[idx];
      tokenButtons.push(
        new ButtonBuilder()
          .setCustomId(`pip:deposit_token:${token.id}`)
          .setLabel(`${token.symbol}`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji("💰")
      );
    }

    // Organize buttons into rows (max 5 per row)
    const actionRows = [];
    for (let i = 0; i < tokenButtons.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(tokenButtons.slice(i, i + 5));
      actionRows.push(row);
    }

    // Add cancel button
    const cancelRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("pip:cancel_deposit")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("❌")
      );
    actionRows.push(cancelRow);

    await i.editReply({
      content: [
        "💰 **Select Token for Deposit Instructions**",
        "",
        `🔗 **Your Linked Wallet:** \`${user.agwAddress}\``,
        "",
        "Choose which token you want to deposit:",
        "",
        "💡 *Instructions will show treasury address and minimum amounts*"
      ].join("\n"),
      components: actionRows
    });

  } catch (error: any) {
    console.error("Show deposit instructions error:", error);
    await i.editReply({
      content: `❌ **Error showing deposit instructions**\n${error?.message || String(error)}`
    });
  }
}

/** Handle view profile button */
async function handleViewProfile(i: ButtonInteraction) {
  await i.deferReply({ ephemeral: true }).catch(() => {});
  
  try {
    // Import profile functionality
    const { generateProfileData, createProfileButtons, createProfileEmbed } = await import("../services/profile.js");
    
    const profileData = await generateProfileData(i.user.id, i.user);
    const hasLinkedWallet = !!profileData.user.agwAddress;
    const profileButtons = createProfileButtons(profileData.activeMemberships, hasLinkedWallet);
    const embed = createProfileEmbed(profileData);

    await i.editReply({
      embeds: [embed],
      components: profileButtons
    });

  } catch (error: any) {
    console.error("View profile error:", error);
    await i.editReply({
      content: `❌ **Error loading profile**\n${error?.message || String(error)}`
    });
  }
}

/** Handle show help button */
async function handleShowHelp(i: ButtonInteraction) {
  await i.deferReply({ ephemeral: true }).catch(() => {});
  
  try {
    // Import and use the help command
    const pipHelp = (await import("../commands/pip_help.js")).default;
    await pipHelp(i as any);

  } catch (error: any) {
    console.error("Show help error:", error);
    await i.editReply({
      content: `❌ **Error showing help**\n${error?.message || String(error)}`
    });
  }
}

/** Handle prompt link wallet button */
async function handlePromptLinkWallet(i: ButtonInteraction) {
  await i.deferReply({ ephemeral: true }).catch(() => {});
  
  try {
    await i.editReply({
      content: [
        "🔗 **Link Your Abstract Wallet**",
        "",
        "To link your wallet, use the following command:",
        "`/pip_link address:0x...`",
        "",
        "**Don't have an Abstract wallet yet?**",
        "🌐 Get one free at **abs.xyz**",
        "",
        "**Your wallet address should:**",
        "• Start with `0x`",
        "• Be 42 characters long",
        "• Be from the Abstract blockchain",
        "",
        "💡 *Once linked, you can deposit and withdraw tokens!*"
      ].join("\n")
    });

  } catch (error: any) {
    console.error("Prompt link wallet error:", error);
    await i.editReply({
      content: `❌ **Error**\n${error?.message || String(error)}`
    });
  }
}

/** Handle deposit token selection */
async function handleDepositToken(i: ButtonInteraction, parts: string[]) {
  await i.deferUpdate().catch(() => {});
  
  try {
    const tokenId = parseInt(parts[2]);
    
    // Get token and user details
    const [token, user] = await Promise.all([
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: { agwAddress: true }
      })
    ]);

    if (!token) {
      return i.editReply({
        content: "❌ **Token not found**\nThe selected token is no longer available.",
        components: []
      });
    }

    if (!user?.agwAddress) {
      return i.editReply({
        content: "❌ **Wallet not linked**\nPlease link your wallet first.",
        components: []
      });
    }

    const { TREASURY_AGW_ADDRESS } = await import("../config.js");
    
    // Create back button
    const backButton = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("pip:show_deposit_instructions")
          .setLabel("⬅️ Back to Token Selection")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("pip:view_profile")
          .setLabel("👤 View Profile")
          .setStyle(ButtonStyle.Secondary)
      );

    await i.editReply({
      content: [
        `✅ **Deposit Instructions for ${token.symbol}**`,
        "",
        `Send **${token.symbol}** tokens from your linked wallet to the Treasury.`,
        "Your balance will be credited automatically after blockchain confirmation.",
        "",
        `**Treasury Address:** \`${TREASURY_AGW_ADDRESS}\``,
        `**Token Contract:** \`${token.address}\``,
        `**Your Linked Wallet:** \`${user.agwAddress}\``,
        "",
        `⚠️ **Minimum deposit:** ${token.minDeposit} ${token.symbol} (deposits below this are ignored)`,
        "",
        "💡 *Only send from your linked wallet address shown above!*"
      ].join("\n"),
      components: [backButton]
    });

  } catch (error: any) {
    console.error("Deposit token selection error:", error);
    await i.editReply({
      content: `❌ **Error**\n${error?.message || String(error)}`,
      components: []
    });
  }
}

/** Handle cancel deposit */
async function handleCancelDeposit(i: ButtonInteraction) {
  await i.deferUpdate().catch(() => {});
  
  try {
    await i.editReply({
      content: "❌ **Deposit cancelled**\n*Use `/pip_deposit` or the Add Funds button to try again.*",
      components: []
    });
  } catch (error: any) {
    console.error("Cancel deposit error:", error);
  }
}

/** Handle withdraw token selection */
async function handleWithdrawToken(i: ButtonInteraction, parts: string[]) {
  await i.deferUpdate().catch(() => {});
  
  try {
    const tokenId = parseInt(parts[2]);
    
    // Get token and user details
    const [token, user, holding] = await Promise.all([
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: { id: true, agwAddress: true }
      }),
      prisma.userBalance.findUnique({
        where: { userId_tokenId: { userId: (await prisma.user.findUniqueOrThrow({ where: { discordId: i.user.id } })).id, tokenId } },
        include: { Token: true }
      })
    ]);

    if (!token || !user || !holding) {
      return i.editReply({
        content: "❌ **Error**\nToken or balance not found.",
        components: []
      });
    }

    if (!user.agwAddress) {
      return i.editReply({
        content: "❌ **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
        components: []
      });
    }

    const balance = formatDecimal(holding.amount, token.symbol);
    const maxAmount = Number(holding.amount);

    // Get withdrawal limits and config
    const config = await prisma.appConfig.findFirst();
    const minWithdraw = Number(token.minWithdraw);
    const maxPerTxHuman = token.withdrawMaxPerTx != null 
      ? Number(token.withdrawMaxPerTx) 
      : Number(config?.withdrawMaxPerTx ?? 0);

    // Calculate effective maximum (considering limits and balance)
    const effectiveMax = maxPerTxHuman > 0 
      ? Math.min(maxAmount, maxPerTxHuman)
      : maxAmount;

    // Check if withdrawal is even possible
    if (maxAmount < minWithdraw) {
      const errorButtonRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId("pip:back_to_withdraw")
            .setLabel("⬅️ Back to Holdings")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("pip:show_deposit_instructions")
            .setLabel("💰 Add Funds")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("pip:cancel_withdraw")
            .setLabel("❌ Cancel")
            .setStyle(ButtonStyle.Secondary)
        );

      return i.editReply({
        content: [
          "❌ **Insufficient Balance for Withdrawal**",
          "",
          `**Your Balance:** ${balance} ${token.symbol}`,
          `**Minimum Withdrawal:** ${minWithdraw} ${token.symbol}`,
          "",
          "You need more tokens before you can withdraw.",
          "",
          "**To get more tokens:**",
          "• Use `/pip_deposit` to add funds",
          "• Receive tips from other users",
          "• Win games with `/pip_game`"
        ].join("\n"),
        components: [errorButtonRow]
      });
    }

    if (effectiveMax < minWithdraw) {
      const limitErrorButtonRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId("pip:back_to_withdraw")
            .setLabel("⬅️ Back to Holdings")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("pip:show_help")
            .setLabel("📚 Get Help")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("pip:cancel_withdraw")
            .setLabel("❌ Cancel")
            .setStyle(ButtonStyle.Secondary)
        );

      return i.editReply({
        content: [
          "❌ **Cannot Withdraw Due to Limits**",
          "",
          `**Your Balance:** ${balance} ${token.symbol}`,
          `**Minimum Withdrawal:** ${minWithdraw} ${token.symbol}`,
          `**Maximum Per Transaction:** ${maxPerTxHuman} ${token.symbol}`,
          "",
          "The withdrawal limits prevent you from withdrawing this token.",
          "Please contact an administrator if you need assistance."
        ].join("\n"),
        components: [limitErrorButtonRow]
      });
    }

    // Create withdrawal limits info for embed
    const maxLine = maxPerTxHuman > 0 ? `max per tx ${maxPerTxHuman} ${token.symbol}` : "no per-tx max";
    const limitsText = `**Limits:** min ${minWithdraw} · ${maxLine}`;

    // Create withdrawal amount input embed
    const embed = new EmbedBuilder()
      .setTitle(`💸 Withdraw ${token.symbol}`)
      .setDescription([
        `**Available Balance:** ${balance} ${token.symbol}`,
        `**Destination:** \`${user.agwAddress}\``,
        "",
        limitsText,
        "",
        "**How much would you like to withdraw?**",
        "",
        "💡 *Click a button below or use the custom amount option*"
      ].join("\n"))
      .setColor(0x00FF00)
      .setFooter({ text: "Withdrawals are sent directly to your linked wallet" })
      .setTimestamp();

    // Create preset amount buttons - only valid amounts
    const presetAmounts = [];
    
    // Add common amounts only if they meet requirements
    const commonAmounts = [50, 100, 250, 500, 1000, 2500, 5000];
    for (const amount of commonAmounts) {
      if (amount >= minWithdraw && 
          amount <= effectiveMax && 
          amount <= maxAmount) {
        presetAmounts.push(amount);
      }
    }
    
    // Add percentage-based options
    const percentages = [0.25, 0.5, 1.0];
    for (const pct of percentages) {
      const amount = Math.floor(effectiveMax * pct);
      if (amount >= minWithdraw && amount > 0) {
        presetAmounts.push(amount);
      }
    }
    
    // Always add the minimum if not already present
    if (minWithdraw <= effectiveMax && !presetAmounts.includes(minWithdraw)) {
      presetAmounts.unshift(minWithdraw);
    }

    // Remove duplicates and sort
    const uniqueAmounts = [...new Set(presetAmounts)].filter(amt => amt > 0).sort((a, b) => a - b);

    const amountButtons: ButtonBuilder[] = [];
    for (const amount of uniqueAmounts.slice(0, 8)) { // Max 8 preset buttons
      // Calculate percentage labels based on effective max
      let percentage = "";
      if (amount === effectiveMax || amount === maxAmount) {
        percentage = " (Max)";
      } else if (amount === Math.floor(effectiveMax * 0.5)) {
        percentage = " (Half)";
      } else if (amount === Math.floor(effectiveMax * 0.25)) {
        percentage = " (25%)";
      } else if (amount === minWithdraw) {
        percentage = " (Min)";
      }
      
      amountButtons.push(
        new ButtonBuilder()
          .setCustomId(`pip:withdraw_amount:${tokenId}:${amount}`)
          .setLabel(`${amount}${percentage}`)
          .setStyle((amount === effectiveMax || amount === maxAmount) ? ButtonStyle.Danger : ButtonStyle.Primary)
          .setEmoji("💰")
      );
    }

    // Organize amount buttons into rows
    const actionRows = [];
    for (let i = 0; i < amountButtons.length; i += 4) {
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(amountButtons.slice(i, i + 4));
      actionRows.push(row);
    }

    // Add navigation buttons
    const navRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`pip:withdraw_custom:${tokenId}`)
          .setLabel("💭 Custom Amount")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("pip:back_to_withdraw")
          .setLabel("⬅️ Back to Holdings")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("pip:cancel_withdraw")
          .setLabel("❌ Cancel")
          .setStyle(ButtonStyle.Secondary)
      );
    actionRows.push(navRow);

    await i.editReply({
      embeds: [embed],
      components: actionRows
    });

  } catch (error: any) {
    console.error("Withdraw token selection error:", error);
    await i.editReply({
      content: `❌ **Error**\n${error?.message || String(error)}`,
      components: []
    });
  }
}

/** Handle cancel withdraw */
async function handleCancelWithdraw(i: ButtonInteraction) {
  await i.deferUpdate().catch(() => {});
  
  try {
    await i.editReply({
      content: "❌ **Withdrawal cancelled**\n*Use `/pip_withdraw` to try again.*",
      components: []
    });
  } catch (error: any) {
    console.error("Cancel withdraw error:", error);
  }
}

/** Handle withdraw amount selection */
async function handleWithdrawAmount(i: ButtonInteraction, parts: string[]) {
  await i.deferUpdate().catch(() => {});
  
  try {
    const tokenId = parseInt(parts[2]);
    const amount = parseInt(parts[3]);
    
    // Get user and token details
    const [user, token, holding] = await Promise.all([
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: { id: true, agwAddress: true }
      }),
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.userBalance.findUnique({
        where: { 
          userId_tokenId: { 
            userId: (await prisma.user.findUniqueOrThrow({ where: { discordId: i.user.id } })).id, 
            tokenId 
          } 
        },
        include: { Token: true }
      })
    ]);

    if (!user || !token || !holding) {
      return i.editReply({
        content: "❌ **Error**\nUser, token, or balance not found.",
        components: []
      });
    }

    if (!user.agwAddress) {
      return i.editReply({
        content: "❌ **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
        components: []
      });
    }

    const currentBalance = Number(holding.amount);
    
    // Validate amount
    if (amount <= 0 || amount > currentBalance) {
      return i.editReply({
        content: [
          "❌ **Invalid Amount**",
          "",
          `You requested to withdraw **${formatDecimal(amount, token.symbol)}** ${token.symbol}`,
          `But your balance is only **${formatDecimal(currentBalance, token.symbol)}** ${token.symbol}`,
          "",
          "*Please select a valid amount from the options provided.*"
        ].join("\n"),
        components: []
      });
    }

    // Create confirmation embed
    const embed = new EmbedBuilder()
      .setTitle("⚠️ Confirm Withdrawal")
      .setDescription([
        `**Token:** ${token.symbol}`,
        `**Amount:** ${formatDecimal(amount, token.symbol)} ${token.symbol}`,
        `**Destination:** \`${user.agwAddress}\``,
        "",
        `**Remaining Balance:** ${formatDecimal(currentBalance - amount, token.symbol)} ${token.symbol}`,
        "",
        "⚠️ **This action cannot be undone**",
        "",
        "Click **Confirm** to proceed with the withdrawal."
      ].join("\n"))
      .setColor(0xFF6B35)
      .setFooter({ text: "Double-check your wallet address before confirming" })
      .setTimestamp();

    const confirmRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`pip:confirm_withdraw:${tokenId}:${amount}`)
          .setLabel("✅ Confirm Withdrawal")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`pip:withdraw_token:${tokenId}`)
          .setLabel("⬅️ Back to Amounts")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("pip:cancel_withdraw")
          .setLabel("❌ Cancel")
          .setStyle(ButtonStyle.Secondary)
      );

    await i.editReply({
      embeds: [embed],
      components: [confirmRow]
    });

  } catch (error: any) {
    console.error("Withdraw amount selection error:", error);
    await i.editReply({
      content: `❌ **Error**\n${error?.message || String(error)}`,
      components: []
    });
  }
}

/** Handle withdraw confirmation and processing */
async function handleConfirmWithdraw(i: ButtonInteraction, parts: string[]) {
  await i.deferUpdate().catch(() => {});
  
  try {
    const tokenId = parseInt(parts[2]);
    const amount = parseFloat(parts[3]);
    
    // Get user, token, and config
    const [user, token, config] = await Promise.all([
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: { id: true, agwAddress: true }
      }),
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.appConfig.findFirst()
    ]);

    if (!user || !token) {
      return i.editReply({
        content: "❌ **Error**\nUser or token not found.",
        components: []
      });
    }

    if (!user.agwAddress) {
      return i.editReply({
        content: "❌ **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
        components: []
      });
    }

    // Check token is active
    if (!token.active) {
      return i.editReply({
        content: "❌ **Token Inactive**\nThis token is currently not available for withdrawals.",
        components: []
      });
    }

    // Get withdrawal limits
    const maxPerTxHuman = token.withdrawMaxPerTx != null 
      ? Number(token.withdrawMaxPerTx) 
      : Number(config?.withdrawMaxPerTx ?? 0);
    
    const dailyCapHuman = token.withdrawDailyCap != null 
      ? Number(token.withdrawDailyCap) 
      : Number(config?.withdrawDailyCap ?? 0);

    const maxLine = maxPerTxHuman > 0 ? `max per tx ${maxPerTxHuman} ${token.symbol}` : "no per-tx max";
    const dailyLine = dailyCapHuman > 0 ? `daily cap ${dailyCapHuman} ${token.symbol}` : "no daily cap";
    const policyLine = `⚠️ **Withdraw limits:** min ${token.minWithdraw} ${token.symbol} · ${maxLine} · ${dailyLine}`;

    // Validate amount against limits
    if (amount < Number(token.minWithdraw)) {
      return i.editReply({
        content: [
          "❌ **Amount Below Minimum**",
          "",
          `Amount is below the minimum: **${token.minWithdraw} ${token.symbol}**`,
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }

    if (maxPerTxHuman > 0 && amount > maxPerTxHuman) {
      return i.editReply({
        content: [
          "❌ **Amount Exceeds Maximum**", 
          "",
          `Amount exceeds the per-transaction max: **${maxPerTxHuman} ${token.symbol}**`,
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }

    // Check user balance
    const userBalance = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: user.id, tokenId } }
    });

    const amtAtomic = toAtomicDirect(amount, token.decimals);
    const userBalAtomic = userBalance ? decToBigDirect(userBalance.amount, token.decimals) : 0n;

    if (userBalAtomic < amtAtomic) {
      return i.editReply({
        content: [
          "❌ **Insufficient Balance**",
          "",
          `You have ${formatAmount(userBalAtomic, token)} but requested ${formatAmount(amtAtomic, token)}`,
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }

    // Check daily cap if enabled
    if (dailyCapHuman > 0) {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      
      const agg = await prisma.transaction.aggregate({
        where: {
          type: "WITHDRAW",
          userId: user.id,
          tokenId: token.id,
          createdAt: { gte: since }
        },
        _sum: { amount: true }
      });
      
      const alreadyToday = parseFloat(String(agg._sum.amount ?? "0"));
      if (alreadyToday + amount > dailyCapHuman) {
        const remaining = Math.max(0, dailyCapHuman - alreadyToday);
        return i.editReply({
          content: [
            "❌ **Daily Limit Exceeded**",
            "",
            `This would exceed your daily cap. Remaining today: **${remaining} ${token.symbol}**`,
            "",
            policyLine
          ].join("\n"),
          components: []
        });
      }
    }

    // Update to processing state
    await i.editReply({
      content: [
        "⏳ **Processing Withdrawal**",
        "",
        `**Token:** ${token.symbol}`,
        `**Amount:** ${formatAmount(amtAtomic, token)}`,
        `**Destination:** \`${user.agwAddress}\``,
        "",
        "Please wait while we process your withdrawal...",
        "",
        policyLine
      ].join("\n"),
      components: []
    });

    // Import required modules for transaction processing
    const { JsonRpcProvider, Wallet, Contract } = await import("ethers");
    const { ABSTRACT_RPC_URL, AGW_SESSION_PRIVATE_KEY, TREASURY_AGW_ADDRESS } = await import("../config.js");
    const { debitToken } = await import("../services/balances.js");
    const { queueNotice } = await import("../services/notifier.js");

    const ERC20_ABI = [
      "function balanceOf(address) view returns (uint256)",
      "function transfer(address to, uint256 value) returns (bool)"
    ];

    // Setup blockchain connection
    const provider = new JsonRpcProvider(ABSTRACT_RPC_URL);
    const signer = new Wallet(AGW_SESSION_PRIVATE_KEY, provider);
    const signerAddr = (await signer.getAddress()).toLowerCase();

    if (signerAddr !== TREASURY_AGW_ADDRESS.toLowerCase()) {
      return i.editReply({
        content: [
          "❌ **Treasury Configuration Error**",
          "",
          `Signer \`${signerAddr}\` != Treasury \`${TREASURY_AGW_ADDRESS}\``,
          "Please contact an administrator.",
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }

    // Check treasury balance
    const tokenContract = new Contract(token.address, ERC20_ABI, signer);
    const treasBal: bigint = await tokenContract.balanceOf(signerAddr);
    
    if (treasBal < amtAtomic) {
      return i.editReply({
        content: [
          "❌ **Treasury Insufficient Funds**",
          "",
          `Treasury has insufficient ${token.symbol} for this withdrawal.`,
          `Treasury balance: ${formatAmount(treasBal, token)}`,
          "",
          "Please try again later or contact an administrator.",
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }

    try {
      // Execute the withdrawal transaction
      const tx = await tokenContract.transfer(user.agwAddress, amtAtomic);
      await tx.wait();

      // Debit user balance and record transaction
      await debitToken(i.user.id, token.id, amtAtomic, "WITHDRAW", {
        guildId: i.guildId,
        txHash: tx.hash
      });

      // Queue success notification
      await queueNotice(user.id, "withdraw_success", {
        token: token.symbol,
        amount: formatAmount(amtAtomic, token),
        tx: tx.hash
      });

      // Success message
      await i.editReply({
        content: [
          "✅ **Withdrawal Successful**",
          "",
          `**Amount:** ${formatAmount(amtAtomic, token)}`,
          `**Destination:** \`${user.agwAddress}\``,
          `**Transaction:** \`${tx.hash}\``,
          "",
          "Your tokens have been sent to your linked wallet!",
          "",
          policyLine
        ].join("\n"),
        components: []
      });

    } catch (error: any) {
      // Queue error notification
      await queueNotice(user.id, "withdraw_error", {
        reason: error?.reason || error?.message || String(error)
      });

      await i.editReply({
        content: [
          "❌ **Withdrawal Failed**",
          "",
          `**Error:** ${error?.reason || error?.message || String(error)}`,
          "",
          "Your balance has not been affected. Please try again later.",
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }

  } catch (error: any) {
    console.error("Confirm withdraw error:", error);
    await i.editReply({
      content: `❌ **Error**\n${error?.message || String(error)}`,
      components: []
    });
  }
}

/** Handle custom withdraw amount input */
async function handleWithdrawCustom(i: ButtonInteraction, parts: string[]) {
  try {
    const tokenId = parseInt(parts[2]);
    
    // Get token info for limits
    const [token, config] = await Promise.all([
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.appConfig.findFirst()
    ]);

    if (!token) {
      return i.reply({
        content: "❌ **Error**\nToken not found.",
        flags: 64
      });
    }

    const minWithdraw = Number(token.minWithdraw);
    const maxPerTxHuman = token.withdrawMaxPerTx != null 
      ? Number(token.withdrawMaxPerTx) 
      : Number(config?.withdrawMaxPerTx ?? 0);

    // Create modal for custom amount input
    const modal = new ModalBuilder()
      .setCustomId(`pip:withdraw_custom_modal:${tokenId}`)
      .setTitle(`💭 Withdraw ${token.symbol} - Custom Amount`);

    const amountInput = new TextInputBuilder()
      .setCustomId("amount")
      .setLabel("Enter withdrawal amount")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(`Min: ${minWithdraw}${maxPerTxHuman > 0 ? `, Max: ${maxPerTxHuman}` : ''}`)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(20);

    const actionRow = new ActionRowBuilder<TextInputBuilder>()
      .addComponents(amountInput);

    modal.addComponents(actionRow);

    await i.showModal(modal);

  } catch (error: any) {
    console.error("Custom withdraw error:", error);
    await i.reply({
      content: `❌ **Error**\n${error?.message || String(error)}`,
      flags: 64
    }).catch(() => {});
  }
}

/** Handle custom withdraw amount modal submission */
async function handleWithdrawCustomModal(i: ModalSubmitInteraction, parts: string[]) {
  await i.deferReply({ flags: 64 }).catch(() => {});
  
  try {
    const tokenId = parseInt(parts[2]);
    const amountInput = i.fields.getTextInputValue("amount");
    const amount = parseFloat(amountInput.trim());
    
    // Validate amount is a number
    if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
      return i.editReply({
        content: [
          "❌ **Invalid Amount**",
          "",
          `"${amountInput}" is not a valid number.`,
          "",
          "Please enter a positive number for the withdrawal amount."
        ].join("\n")
      });
    }

    // Get token and config for validation
    const [token, config, user] = await Promise.all([
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.appConfig.findFirst(),
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: { id: true, agwAddress: true }
      })
    ]);

    if (!token || !user) {
      return i.editReply({
        content: "❌ **Error**\nToken or user not found."
      });
    }

    // Validate withdrawal limits BEFORE showing confirmation
    const minWithdraw = Number(token.minWithdraw);
    const maxPerTxHuman = token.withdrawMaxPerTx != null 
      ? Number(token.withdrawMaxPerTx) 
      : Number(config?.withdrawMaxPerTx ?? 0);

    // Check minimum withdrawal
    if (amount < minWithdraw) {
      return i.editReply({
        content: [
          "❌ **Amount Below Minimum**",
          "",
          `**Entered Amount:** ${amount} ${token.symbol}`,
          `**Minimum Required:** ${minWithdraw} ${token.symbol}`,
          "",
          "Please enter an amount that meets the minimum withdrawal requirement."
        ].join("\n")
      });
    }

    // Check maximum withdrawal
    if (maxPerTxHuman > 0 && amount > maxPerTxHuman) {
      return i.editReply({
        content: [
          "❌ **Amount Exceeds Maximum**",
          "",
          `**Entered Amount:** ${amount} ${token.symbol}`,
          `**Maximum Allowed:** ${maxPerTxHuman} ${token.symbol}`,
          "",
          "Please enter an amount within the withdrawal limits."
        ].join("\n")
      });
    }

    // Check user balance
    const userBalance = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: user.id, tokenId } }
    });

    const currentBalance = Number(userBalance?.amount || 0);
    if (amount > currentBalance) {
      return i.editReply({
        content: [
          "❌ **Insufficient Balance**",
          "",
          `**Requested Amount:** ${amount} ${token.symbol}`,
          `**Available Balance:** ${currentBalance} ${token.symbol}`,
          "",
          "You don't have enough tokens for this withdrawal."
        ].join("\n")
      });
    }

    // Use the same confirmation flow as preset amounts
    // Just redirect to the handleWithdrawAmount function with the custom amount
    const customParts = ["pip", "withdraw_amount", tokenId.toString(), amount.toString()];
    
    // Create a mock button interaction to reuse the existing confirmation flow
    const mockButtonInteraction = {
      ...i,
      deferUpdate: () => Promise.resolve(),
      editReply: i.editReply.bind(i),
      user: i.user,
      guildId: i.guildId
    } as any;
    
    return handleWithdrawAmount(mockButtonInteraction, customParts);

  } catch (error: any) {
    console.error("Custom withdraw modal error:", error);
    await i.editReply({
      content: `❌ **Error**\n${error?.message || String(error)}`
    }).catch(() => {});
  }
}

/** Handle back to withdraw holdings */
async function handleBackToWithdraw(i: ButtonInteraction) {
  await i.deferUpdate().catch(() => {});
  
  try {
    // Regenerate the main withdraw interface by calling the original command logic
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
      select: { id: true, agwAddress: true }
    });

    if (!user) {
      return i.editReply({
        content: "❌ **Error**\nUser account not found.",
        components: []
      });
    }

    if (!user.agwAddress) {
      return i.editReply({
        content: "❌ **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
        components: []
      });
    }

    // Get user's token holdings
    const holdings = await prisma.userBalance.findMany({
      where: { 
        userId: user.id,
        amount: { gt: 0 }
      },
      include: { Token: true },
      orderBy: { amount: 'desc' }
    });

    if (holdings.length === 0) {
      return i.editReply({
        content: [
          "💰 **No Holdings to Withdraw**",
          "",
          "You don't have any tokens in your account to withdraw.",
          "",
          "**To get tokens:**",
          "• Use `/pip_deposit` to add funds",
          "• Receive tips from other users",
          "• Win games with `/pip_game`"
        ].join("\n"),
        components: []
      });
    }

    // Recreate holdings display embed (same as original withdraw command)
    const embed = new EmbedBuilder()
      .setTitle("💸 Withdraw Your Tokens")
      .setDescription([
        `**Your Linked Wallet:** \`${user.agwAddress}\``,
        "",
        "**Your Holdings:**",
        holdings.map(holding => {
          const balance = formatDecimal(holding.amount, holding.Token.symbol);
          return `• **${balance}** ${holding.Token.symbol}`;
        }).join("\n"),
        "",
        "🪙 **Select a token below to withdraw:**"
      ].join("\n"))
      .setColor(0x00FF00)
      .setFooter({ text: "Click a token to continue with withdrawal" })
      .setTimestamp();

    // Recreate token selection buttons
    const tokenButtons: ButtonBuilder[] = [];
    const maxButtons = Math.min(holdings.length, 15);

    for (let i = 0; i < maxButtons; i++) {
      const holding = holdings[i];
      const balance = formatDecimal(holding.amount, holding.Token.symbol);
      
      tokenButtons.push(
        new ButtonBuilder()
          .setCustomId(`pip:withdraw_token:${holding.Token.id}`)
          .setLabel(`${holding.Token.symbol} (${balance})`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji("💰")
      );
    }

    // Organize buttons into rows
    const actionRows = [];
    for (let i = 0; i < tokenButtons.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(tokenButtons.slice(i, i + 5));
      actionRows.push(row);
    }

    // Add action buttons
    const actionRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("pip:view_profile")
          .setLabel("👤 View Profile")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("pip:show_help")
          .setLabel("📚 Get Help")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("pip:cancel_withdraw")
          .setLabel("❌ Cancel")
          .setStyle(ButtonStyle.Secondary)
      );
    actionRows.push(actionRow);

    await i.editReply({
      embeds: [embed],
      components: actionRows
    });

  } catch (error: any) {
    console.error("Back to withdraw error:", error);
    await i.editReply({
      content: `❌ **Error**\n${error?.message || String(error)}`,
      components: []
    });
  }
}

/** Handle CSV export of user transaction history */
async function handleExportCSV(i: ButtonInteraction) {
  await i.deferReply({ flags: 64 }).catch(() => {});
  
  try {
    // Get user
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
      select: { id: true }
    });

    if (!user) {
      return i.editReply({
        content: "❌ **Error**\nUser account not found."
      });
    }

    // Get all transactions for the user
    const transactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { userId: user.id },
          { otherUserId: user.id }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    // Get all tips (sent and received) including status info
    const [tipsSent, tipsReceived] = await Promise.all([
      prisma.tip.findMany({
        where: { fromUserId: user.id },
        include: {
          Token: true,
          From: { select: { discordId: true } },
          To: { select: { discordId: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.tip.findMany({
        where: { toUserId: user.id },
        include: {
          Token: true,
          From: { select: { discordId: true } },
          To: { select: { discordId: true } }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    // Get group tip activity
    const [groupTipsCreated, groupTipsClaimed] = await Promise.all([
      prisma.groupTip.findMany({
        where: { creatorId: user.id },
        include: { Token: true },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.groupTipClaim.findMany({
        where: { userId: user.id },
        include: {
          GroupTip: {
            include: { Token: true, Creator: { select: { discordId: true } } }
          }
        },
        orderBy: { claimedAt: 'desc' }
      })
    ]);

    // Create simplified CSV content focused on user activity
    const csvRows = [];
    
    // CSV Header - simplified and user-friendly
    csvRows.push([
      "Date",
      "Activity", 
      "Amount",
      "Token",
      "Counterparty",
      "Direction",
      "Fee",
      "Note",
      "Transaction_Hash"
    ]);

    // Get token symbols for transactions
    const allTokens = await prisma.token.findMany({
      select: { id: true, symbol: true }
    });
    const tokenMap = new Map(allTokens.map(t => [t.id, t.symbol]));

    // Consolidate activities to avoid duplicates
    const activities = new Map();

    // Process direct tips sent
    for (const tip of tipsSent) {
      const key = `tip_sent_${tip.createdAt.getTime()}`;
      let activityName = "Direct Tip Sent";
      let statusNote = tip.note || "";
      
      if (tip.status === "REFUNDED") {
        activityName = "Direct Tip Sent (refunded — failed)";
        statusNote = `${statusNote} [REFUNDED: principal + tax returned]`.trim();
      }
      
      activities.set(key, {
        date: tip.createdAt,
        activity: activityName,
        amount: formatDecimal(tip.amountAtomic, tip.Token.symbol),
        token: tip.Token.symbol,
        counterparty: tip.To?.discordId || 'Unknown',
        direction: "OUT",
        fee: formatDecimal(tip.feeAtomic, tip.Token.symbol),
        note: statusNote,
        txHash: ""
      });
    }

    // Process direct tips received
    for (const tip of tipsReceived) {
      const key = `tip_received_${tip.createdAt.getTime()}`;
      let activityName = "Direct Tip Received";
      let statusNote = tip.note || "";
      
      if (tip.status === "REFUNDED") {
        activityName = "Direct Tip Received (refunded — failed)";
        statusNote = `${statusNote} [REFUNDED: tip was returned to sender]`.trim();
      }
      
      activities.set(key, {
        date: tip.createdAt,
        activity: activityName,
        amount: formatDecimal(tip.amountAtomic, tip.Token.symbol),
        token: tip.Token.symbol,
        counterparty: tip.From?.discordId || 'Unknown',
        direction: "IN",
        fee: "0",
        note: statusNote,
        txHash: ""
      });
    }

    // Process group tips created
    for (const groupTip of groupTipsCreated) {
      const key = `group_tip_${groupTip.createdAt.getTime()}`;
      let activityName = "Group Tip Created";
      let statusNote = `${groupTip.duration / 60}min duration`;
      
      if (groupTip.status === "REFUNDED") {
        activityName = "Group Tip Created (refunded — not collected)";
        statusNote = `${statusNote} [REFUNDED: principal + tax returned]`;
      } else if (groupTip.status === "FAILED") {
        activityName = "Group Tip Created (refunded — failed)";
        statusNote = `${statusNote} [REFUNDED: posting failed, principal + tax returned]`;
      }
      
      activities.set(key, {
        date: groupTip.createdAt,
        activity: activityName,
        amount: formatDecimal(groupTip.totalAmount, groupTip.Token.symbol),
        token: groupTip.Token.symbol,
        counterparty: "Public",
        direction: "OUT",
        fee: formatDecimal(groupTip.taxAtomic, groupTip.Token.symbol),
        note: statusNote,
        txHash: ""
      });
    }

    // Process deposits, withdrawals, and other important transactions
    for (const tx of transactions) {
      if (tx.type === "DEPOSIT" && tx.userId === user.id) {
        const key = `deposit_${tx.createdAt.getTime()}`;
        const tokenSymbol = tx.tokenId ? tokenMap.get(tx.tokenId) || "Unknown" : "Unknown";
        activities.set(key, {
          date: tx.createdAt,
          activity: "Deposit",
          amount: formatDecimal(tx.amount, tokenSymbol),
          token: tokenSymbol,
          counterparty: "Treasury",
          direction: "IN",
          fee: formatDecimal(tx.fee, tokenSymbol),
          note: "Blockchain deposit",
          txHash: tx.txHash || ""
        });
      } else if (tx.type === "WITHDRAW" && tx.userId === user.id) {
        const key = `withdraw_${tx.createdAt.getTime()}`;
        const tokenSymbol = tx.tokenId ? tokenMap.get(tx.tokenId) || "Unknown" : "Unknown";
        activities.set(key, {
          date: tx.createdAt,
          activity: "Withdrawal",
          amount: formatDecimal(tx.amount, tokenSymbol),
          token: tokenSymbol,
          counterparty: "Your Wallet",
          direction: "OUT",
          fee: formatDecimal(tx.fee, tokenSymbol),
          note: "Blockchain withdrawal",
          txHash: tx.txHash || ""
        });
      } else if (tx.type === "MATCH_WAGER" && tx.userId === user.id) {
        const key = `match_wager_${tx.createdAt.getTime()}`;
        const tokenSymbol = tx.tokenId ? tokenMap.get(tx.tokenId) || "Unknown" : "Unknown";
        activities.set(key, {
          date: tx.createdAt,
          activity: "Game Wager",
          amount: formatDecimal(tx.amount, tokenSymbol),
          token: tokenSymbol,
          counterparty: "Match System",
          direction: "OUT",
          fee: "0",
          note: "Rock-paper-scissors wager",
          txHash: ""
        });
      } else if (tx.type === "MATCH_PAYOUT" && tx.userId === user.id) {
        const key = `match_payout_${tx.createdAt.getTime()}`;
        const tokenSymbol = tx.tokenId ? tokenMap.get(tx.tokenId) || "Unknown" : "Unknown";
        activities.set(key, {
          date: tx.createdAt,
          activity: "Game Payout",
          amount: formatDecimal(tx.amount, tokenSymbol),
          token: tokenSymbol,
          counterparty: "Match System",
          direction: "IN",
          fee: "0",
          note: "Rock-paper-scissors winnings",
          txHash: ""
        });
      }
    }

    // Add group tips claimed
    for (const claim of groupTipsClaimed) {
      const key = `group_tip_claimed_${claim.claimedAt?.getTime() || Date.now()}`;
      activities.set(key, {
        date: claim.claimedAt || new Date(),
        activity: "Group Tip Claimed",
        amount: formatDecimal(claim.GroupTip.totalAmount, claim.GroupTip.Token.symbol),
        token: claim.GroupTip.Token.symbol,
        counterparty: claim.GroupTip.Creator?.discordId || 'Unknown',
        direction: "IN",
        fee: "0",
        note: "Claimed from group tip",
        txHash: ""
      });
    }

    // Convert activities to CSV rows
    const sortedActivities = Array.from(activities.values())
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    for (const activity of sortedActivities) {
      csvRows.push([
        activity.date.toISOString(),
        activity.activity,
        activity.amount,
        activity.token,
        activity.counterparty,
        activity.direction,
        activity.fee,
        activity.note,
        activity.txHash
      ]);
    }

    // Convert to CSV string
    const csvContent = csvRows
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    // Create file buffer
    const buffer = Buffer.from(csvContent, 'utf8');
    const fileName = `piptip_transactions_${i.user.username}_${new Date().toISOString().split('T')[0]}.csv`;

    // Send as file attachment
    await i.editReply({
      content: [
        "📊 **Transaction History Export Complete**",
        "",
        `**Total Records:** ${csvRows.length - 1}`,
        `**File Name:** ${fileName}`,
        "",
        "Your complete transaction history has been exported to CSV format.",
        "This includes all deposits, withdrawals, tips, and group tip activity."
      ].join("\n"),
      files: [{
        attachment: buffer,
        name: fileName
      }]
    });

  } catch (error: any) {
    console.error("CSV export error:", error);
    await i.editReply({
      content: `❌ **Export Failed**\n${error?.message || String(error)}`
    }).catch(() => {});
  }
}

/** Handle refresh stats */
async function handleRefreshStats(i: ButtonInteraction) {
  await i.reply({
    content: "🔄 **Refreshing Stats**\nPlease use `/pip_stats` again to see updated statistics.",
    flags: 64
  });
}

/** Handle dismiss stats */
async function handleDismissStats(i: ButtonInteraction) {
  await i.deferUpdate().catch(() => {});
  
  try {
    await i.editReply({
      content: "📊 **Statistics dismissed**\n*Use `/pip_stats` to view your statistics again.*",
      embeds: [],
      components: []
    });
  } catch (error: any) {
    console.error("Dismiss stats error:", error);
  }
}
