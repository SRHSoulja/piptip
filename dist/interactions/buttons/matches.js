import { prisma } from "../../services/db.js";
import { judge, label } from "../../services/matches.js";
import { publicJoinRow, cancelRow } from "../../ui/components.js";
import { matchOfferEmbed, matchResultEmbed } from "../../ui/embeds.js";
import { decToBigDirect, formatAmount } from "../../services/token.js";
import { debitTokenAtomicTx, creditTokenTx } from "../../services/balances.js";
import { getConfig } from "../../config.js";
import { getActiveAd } from "../../services/ads.js";
import { RoleRakeReductionService } from "../../services/role_rake_benefits.js";
import { getDiscordClient } from "../../services/discord_users.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { awardMatchXP } from "../../services/xp_integration.js";
function rpsPayout(wagerAtomic, houseFeeBps) {
  const pot = 2n * wagerAtomic;
  if (wagerAtomic < BigInt(1e3)) {
    throw new Error("Wager too small - minimum 0.000001 tokens to prevent fee bypass attacks");
  }
  let rake = pot * houseFeeBps / 10000n;
  const remainder = pot * houseFeeBps % 10000n;
  if (remainder > 0n) {
    rake = rake + 1n;
  }
  if (houseFeeBps > 0n && rake === 0n) {
    rake = 1n;
  }
  const payout = pot - rake;
  return { pot, rake, payout };
}
async function handlePick(i, matchId, move) {
  await i.deferUpdate().catch(() => {
  });
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
  const offerDeadline = new Date(Date.now() + 10 * 60 * 1e3);
  const updated = await prisma.match.update({
    where: { id: m.id },
    data: { status: "OFFERED", challengerMove: move, offerDeadline }
  });
  const ch = await i.client.channels.fetch(i.channelId);
  if (!ch?.isTextBased() || !("send" in ch)) {
    return i.followUp({ content: "Cannot post match in this channel.", flags: 64 });
  }
  const wagerAtomic = decToBigDirect(updated.wagerAtomic, m.Token.decimals);
  const wagerTxt = formatAmount(wagerAtomic, m.Token);
  const ad = await getActiveAd();
  const msg = await ch.send({
    embeds: [
      matchOfferEmbed(
        `<@${m.Challenger?.discordId || "Unknown"}>`,
        wagerTxt,
        ad ?? void 0
      )
    ],
    components: [publicJoinRow(updated.id), cancelRow(updated.id)]
  });
  await prisma.match.update({
    where: { id: updated.id },
    data: { messageId: msg.id, channelId: msg.channelId }
  });
  await i.editReply({
    content: "Move locked. Your public match is posted.",
    components: []
  }).catch(() => {
  });
}
async function handleJoin(i, matchId, move) {
  await i.deferReply({ ephemeral: true }).catch(() => {
  });
  const cfg = await getConfig();
  let houseFeeBps = BigInt(cfg.houseFeeBps ?? 200);
  let rakeReductionBenefit = null;
  const streakUpdates = [];
  try {
    const settled = await prisma.$transaction(async (tx) => {
      const lockResult = await tx.match.updateMany({
        where: {
          id: matchId,
          status: "OFFERED"
          // Only lock if still offered
        },
        data: { status: "LOCKED" }
      });
      if (lockResult.count === 0) {
        const existingMatch = await tx.match.findUnique({
          where: { id: matchId },
          select: { status: true }
        });
        if (!existingMatch) {
          throw new Error("Match not found");
        } else if (existingMatch.status === "LOCKED") {
          throw new Error("Match is being joined by another player");
        } else if (existingMatch.status === "SETTLED") {
          throw new Error("Match already completed");
        } else if (existingMatch.status === "EXPIRED") {
          throw new Error("Match expired");
        } else {
          throw new Error("Match no longer available");
        }
      }
      const m = await tx.match.findUnique({
        where: { id: matchId },
        include: { Challenger: true, Token: true }
      });
      if (!m) throw new Error("Match not found after lock");
      if (!m.Challenger) {
        throw new Error("Match challenger not found");
      }
      if (m.Challenger.discordId === i.user.id) {
        throw new Error("You cannot join your own match");
      }
      if (m.offerDeadline && m.offerDeadline.getTime() < Date.now()) {
        await tx.match.update({ where: { id: m.id }, data: { status: "EXPIRED" } });
        throw new Error("Match expired");
      }
      const joiner = await tx.user.upsert({
        where: { discordId: i.user.id },
        update: {},
        create: { discordId: i.user.id }
      });
      const challengerRakeReduction = await RoleRakeReductionService.getBestRakeReduction(
        m.Challenger.id,
        i.guildId || "",
        m.Challenger.discordId
      );
      const joinerRakeReduction = await RoleRakeReductionService.getBestRakeReduction(
        joiner.id,
        i.guildId || "",
        i.user.id
      );
      const bestRakeReduction = [challengerRakeReduction, joinerRakeReduction].filter(Boolean).reduce((best, current) => {
        if (!best || !current) return best || current;
        return current.reductionRate > best.reductionRate ? current : best;
      }, null);
      if (bestRakeReduction) {
        const originalHouseFeeBps = houseFeeBps;
        const reductionMultiplier = (100 - bestRakeReduction.reductionRate) / 100;
        houseFeeBps = BigInt(Math.round(Number(originalHouseFeeBps) * reductionMultiplier));
        rakeReductionBenefit = bestRakeReduction;
      }
      const wager = decToBigDirect(m.wagerAtomic, m.Token.decimals);
      try {
        await debitTokenAtomicTx(tx, i.user.id, m.Token.id, wager, "MATCH_WAGER", {
          guildId: i.guildId ?? null
        });
      } catch (balanceError) {
        await tx.match.update({
          where: { id: matchId },
          data: { status: "OFFERED" }
          // Reset to offered so others can join
        });
        throw new Error(`Insufficient funds: ${String(balanceError)}`);
      }
      const outcome = judge(m.challengerMove, move);
      let result = "TIE";
      let rakeBig = 0n;
      let winnerUserId = null;
      if (outcome === 0) {
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
          streakUpdates.push({
            discordId: m.Challenger.discordId,
            won: true
          });
          streakUpdates.push({
            discordId: i.user.id,
            won: false
          });
        } else {
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
          streakUpdates.push({
            discordId: i.user.id,
            won: true
          });
          streakUpdates.push({
            discordId: m.Challenger.discordId,
            won: false
          });
        }
        if (rakeBig > 0n) {
          const { logCompleteTransaction } = await import("../../services/tx_logger.js");
          await logCompleteTransaction(tx, {
            source: "BOT",
            operation: "TREASURY_RAKE",
            userId: null,
            // Treasury operation
            guildId: i.guildId ?? null,
            idempotencyKey: `rake_match_${m.id}`,
            opRef: `match_${m.id}`,
            metadata: {
              matchId: m.id,
              rakeAmount: rakeBig.toString(),
              tokenSymbol: m.Token.symbol,
              description: "Match house rake collection"
            },
            balanceChanges: [
              {
                tokenId: m.Token.id,
                userId: void 0,
                // Treasury (null userId)
                amountDelta: rakeBig,
                // Positive delta to treasury
                reason: "match_rake_collected"
              }
            ]
          });
        }
      }
      const originalRake = rpsPayout(wager, BigInt(cfg.houseFeeBps ?? 200)).rake;
      const rakeSaved = originalRake - rakeBig;
      const final = await tx.match.update({
        where: { id: m.id },
        data: {
          status: "SETTLED",
          joinerId: joiner.id,
          // keep joiner even on ties
          joinerMove: move,
          result,
          rakeAtomic: rakeBig.toString(),
          // Store atomic units, not converted amounts
          winnerUserId,
          // Analytics tracking for role benefits
          guildId: i.guildId,
          challengerRakeReduction: challengerRakeReduction?.label || null,
          joinerRakeReduction: joinerRakeReduction?.label || null,
          rakeSavedAtomic: rakeSaved.toString()
        },
        include: { Challenger: true, Joiner: true, Token: true }
      });
      return final;
    }, { timeout: 15e3, maxWait: 15e3 });
    const streakResults = [];
    for (const update of streakUpdates) {
      try {
        const { updateStreak } = await import("../../services/streaks.js");
        const result = await updateStreak(update.discordId, update.won);
        if (result.achievement) {
          streakResults.push({
            discordId: update.discordId,
            achievement: result.achievement,
            newStreak: result.newStreak
          });
        }
        if (update.won !== null) {
          const matchResult = update.won ? "win" : "loss";
          await awardMatchXP(update.discordId, matchResult);
        }
      } catch (error) {
        console.error("Failed to update streak or award XP:", error);
      }
    }
    try {
      const ch2 = await i.client.channels.fetch(settled.channelId);
      if (ch2?.isTextBased() && "messages" in ch2 && settled.messageId) {
        const challengerTag = settled.Challenger ? `<@${settled.Challenger.discordId}>` : "Unknown Challenger";
        const joinerTag = settled.Joiner ? `<@${settled.Joiner.discordId}>` : "Opponent";
        const potBig = 2n * decToBigDirect(settled.wagerAtomic, settled.Token.decimals);
        const rakeBig = decToBigDirect(settled.rakeAtomic, settled.Token.decimals);
        const payoutBig = potBig - rakeBig;
        const outcomeLine = settled.result === "TIE" ? "Tie. Both refunded." : settled.result === "WIN_CHALLENGER" ? `${challengerTag} wins` : `${joinerTag} wins`;
        const ad = await getActiveAd();
        await ch2.messages.edit(settled.messageId, {
          embeds: [matchResultEmbed({
            challengerTag,
            joinerTag,
            challengerMove: label(settled.challengerMove),
            joinerMove: label(settled.joinerMove),
            resultLine: outcomeLine,
            payoutText: settled.result === "TIE" ? void 0 : formatAmount(payoutBig, settled.Token),
            rakeText: settled.result === "TIE" ? void 0 : formatAmount(rakeBig, settled.Token),
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
            } : void 0,
            ad: ad ?? void 0
          })],
          components: []
        });
      }
    } catch {
    }
    let responseContent = "Match resolved.";
    if (rakeReductionBenefit) {
      const rakeSavedBig = decToBigDirect(settled.rakeSavedAtomic, settled.Token.decimals);
      if (rakeSavedBig > 0n && settled.result !== "TIE") {
        const benefit = rakeReductionBenefit;
        const enhancedMessage = await formatRakeBenefitNotification(
          benefit,
          formatAmount(rakeSavedBig, settled.Token),
          settled.Token.symbol,
          i.guildId || ""
        );
        responseContent += `
\u{1F3AE} ${enhancedMessage}`;
        const tierButton = await createMatchTierButton(rakeReductionBenefit, i.user.id);
        if (tierButton) {
          await i.editReply({
            content: responseContent,
            components: [tierButton]
          }).catch(() => {
          });
          return;
        }
      }
    }
    await i.editReply({ content: responseContent }).catch(() => {
    });
  } catch (err) {
    await i.editReply({ content: `Failed to join: ${err?.message || String(err)}` }).catch(() => {
    });
  }
}
async function handleCancel(i, matchId) {
  await i.deferReply({ ephemeral: true }).catch(() => {
  });
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
      if (!m.Challenger) throw new Error("Match challenger not found");
      await creditTokenTx(tx, m.Challenger.discordId, m.Token.id, wager, "MATCH_PAYOUT", {
        guildId: i.guildId ?? null
      });
      const updated = await tx.match.update({
        where: { id: m.id },
        data: { status: "CANCELED" }
      });
      return { updated, channelId: m.channelId, messageId: m.messageId };
    }, { timeout: 15e3, maxWait: 15e3 });
    try {
      if (result.channelId && result.messageId) {
        const ch = await i.client.channels.fetch(result.channelId);
        if (ch?.isTextBased() && "messages" in ch) {
          await ch.messages.edit(result.messageId, {
            content: "Match canceled and refunded.",
            embeds: [],
            components: []
          });
        }
      }
    } catch {
    }
    await i.editReply({ content: "Canceled." }).catch(() => {
    });
  } catch (err) {
    await i.editReply({ content: `Failed to cancel: ${err?.message || String(err)}` }).catch(() => {
    });
  }
}
async function formatRakeBenefitNotification(benefit, savedAmount, tokenSymbol, guildId) {
  try {
    if (benefit.source.startsWith("role:")) {
      const roleId = benefit.source.substring(5);
      try {
        const discord = getDiscordClient();
        if (discord && guildId) {
          const guild = await discord.guilds.fetch(guildId);
          const role = await guild?.roles.fetch(roleId);
          if (role && role.name) {
            const cleanRoleName = role.name.trim();
            if (cleanRoleName.length > 0 && cleanRoleName !== roleId) {
              return `Victory! Your **${cleanRoleName}** role eliminated house fees - kept ${savedAmount} extra ${tokenSymbol}!`;
            }
          }
        }
      } catch (error) {
        if (!String(error).includes("rate limit") && !String(error).includes("timeout")) {
          console.warn("Discord API unavailable for gaming role name lookup:", String(error));
        }
      }
      return `Victory! Your **${benefit.label}** eliminated house fees - kept ${savedAmount} extra ${tokenSymbol}!`;
    } else if (benefit.source.startsWith("tier:")) {
      return `Victory! Your **${benefit.label}** perks eliminated house fees - kept ${savedAmount} extra ${tokenSymbol}!`;
    } else {
      return `Victory! Your **${benefit.label}** reduced house fees - saved ${savedAmount} ${tokenSymbol}!`;
    }
  } catch (error) {
    console.error("Error formatting rake benefit notification:", error);
    return `Victory! Your **${benefit.label}** saved ${savedAmount} ${tokenSymbol} in fees!`;
  }
}
async function createMatchTierButton(benefit, userDiscordId) {
  try {
    if (!benefit || !benefit.source.startsWith("tier:")) {
      return null;
    }
    const { prisma: prisma2 } = await import("../../services/db.js");
    const user = await prisma2.user.findUnique({
      where: { discordId: userDiscordId },
      include: {
        tierMemberships: {
          where: {
            status: "ACTIVE",
            expiresAt: { gt: /* @__PURE__ */ new Date() }
          }
        }
      }
    });
    if (user && user.tierMemberships.length > 0) {
      return null;
    }
    const availableTier = await prisma2.tier.findFirst({
      where: { active: true },
      include: {
        prices: {
          include: { token: true }
        }
      },
      orderBy: { priceAmount: "asc" }
    });
    if (!availableTier || !availableTier.prices[0]) {
      return null;
    }
    const savingsPercent = Math.round(benefit.reductionRate);
    const tierButton = new ButtonBuilder().setCustomId(`pip:tier_purchase:${availableTier.id}`).setLabel(`\u{1F3C6} Get ${availableTier.name} - Save ${savingsPercent}% on gaming fees`).setStyle(ButtonStyle.Success).setEmoji("\u{1F3AE}");
    const row = new ActionRowBuilder().addComponents(tierButton);
    return row;
  } catch (error) {
    console.error("Error creating match tier button:", error);
    return null;
  }
}
export {
  handleCancel,
  handleJoin,
  handlePick
};
//# sourceMappingURL=matches.js.map
