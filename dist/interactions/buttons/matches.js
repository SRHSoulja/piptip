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
// payout helper uses dynamic house fee (bps) from AppConfig
function rpsPayout(wagerAtomic, houseFeeBps) {
    const pot = 2n * wagerAtomic;
    // SECURITY: Prevent precision overflow attacks - minimum wager enforcement
    if (wagerAtomic < BigInt(1000)) {
        throw new Error("Wager too small - minimum 0.000001 tokens to prevent fee bypass attacks");
    }
    // SECURITY: Calculate base rake
    let rake = (pot * houseFeeBps) / 10000n;
    // SECURITY: Apply ceiling division first (round up, favor platform)
    const remainder = (pot * houseFeeBps) % 10000n;
    if (remainder > 0n) {
        rake = rake + 1n; // Round up to next atomic unit
    }
    // SECURITY: Force minimum rake only if calculated rake is still 0 (prevent rake bypass)
    if (houseFeeBps > 0n && rake === 0n) {
        rake = 1n; // Minimum rake enforcement
    }
    const payout = pot - rake;
    return { pot, rake, payout };
}
/** Challenger locks their secret move and posts the public match. */
export async function handlePick(i, matchId, move) {
    // Acknowledge immediately to avoid 3s timeout
    await i.deferUpdate().catch(() => { });
    const m = await prisma.match.findUnique({
        where: { id: matchId },
        include: { Challenger: true, Token: true }
    });
    if (!m)
        return i.followUp({ content: "Match not found.", flags: 64 });
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
    const ch = await i.client.channels.fetch(i.channelId);
    if (!ch?.isTextBased() || !("send" in ch)) {
        return i.followUp({ content: "Cannot post match in this channel.", flags: 64 });
    }
    const wagerAtomic = decToBigDirect(updated.wagerAtomic, m.Token.decimals);
    const wagerTxt = formatAmount(wagerAtomic, m.Token);
    const ad = await getActiveAd();
    const msg = await ch.send({
        embeds: [
            matchOfferEmbed(`<@${m.Challenger?.discordId || 'Unknown'}>`, wagerTxt, ad ?? undefined)
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
    }).catch(() => { });
}
/** Opponent joins with their move; match resolves immediately. */
export async function handleJoin(i, matchId, move) {
    // Ack fast
    await i.deferReply({ ephemeral: true }).catch(() => { });
    const cfg = await getConfig();
    // Get base house fee
    let houseFeeBps = BigInt(cfg.houseFeeBps ?? 200);
    let rakeReductionBenefit = null;
    // Track streak updates to process after transaction
    const streakUpdates = [];
    try {
        const settled = await prisma.$transaction(async (tx) => {
            // ATOMIC LOCK: Check status and lock in single operation to prevent race condition
            const lockResult = await tx.match.updateMany({
                where: {
                    id: matchId,
                    status: "OFFERED" // Only lock if still offered
                },
                data: { status: "LOCKED" }
            });
            // If no rows updated, match was already taken or doesn't exist
            if (lockResult.count === 0) {
                const existingMatch = await tx.match.findUnique({
                    where: { id: matchId },
                    select: { status: true }
                });
                if (!existingMatch) {
                    throw new Error("Match not found");
                }
                else if (existingMatch.status === "LOCKED") {
                    throw new Error("Match is being joined by another player");
                }
                else if (existingMatch.status === "SETTLED") {
                    throw new Error("Match already completed");
                }
                else if (existingMatch.status === "EXPIRED") {
                    throw new Error("Match expired");
                }
                else {
                    throw new Error("Match no longer available");
                }
            }
            // Now safely get the locked match
            const m = await tx.match.findUnique({
                where: { id: matchId },
                include: { Challenger: true, Token: true }
            });
            if (!m)
                throw new Error("Match not found after lock");
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
            // ensure joiner row
            const joiner = await tx.user.upsert({
                where: { discordId: i.user.id },
                update: {},
                create: { discordId: i.user.id }
            });
            // Check for role-based rake reductions for both players
            const challengerRakeReduction = await RoleRakeReductionService.getBestRakeReduction(m.Challenger.id, i.guildId || '', m.Challenger.discordId);
            const joinerRakeReduction = await RoleRakeReductionService.getBestRakeReduction(joiner.id, i.guildId || '', i.user.id);
            // Apply best rake reduction from either player
            const bestRakeReduction = [challengerRakeReduction, joinerRakeReduction]
                .filter(Boolean)
                .reduce((best, current) => {
                if (!best || !current)
                    return best || current;
                return current.reductionRate > best.reductionRate ? current : best;
            }, null);
            // Apply rake reduction to house fee
            if (bestRakeReduction) {
                const originalHouseFeeBps = houseFeeBps;
                const reductionMultiplier = (100 - bestRakeReduction.reductionRate) / 100;
                houseFeeBps = BigInt(Math.round(Number(originalHouseFeeBps) * reductionMultiplier));
                rakeReductionBenefit = bestRakeReduction;
            }
            const wager = decToBigDirect(m.wagerAtomic, m.Token.decimals);
            // SECURITY: Use atomic debit to prevent race conditions with balance checking
            try {
                await debitTokenAtomicTx(tx, i.user.id, m.Token.id, wager, "MATCH_WAGER", {
                    guildId: i.guildId ?? null
                });
            }
            catch (balanceError) {
                // UNLOCK THE MATCH immediately if user lacks funds
                await tx.match.update({
                    where: { id: matchId },
                    data: { status: "OFFERED" } // Reset to offered so others can join
                });
                throw new Error(`Insufficient funds: ${String(balanceError)}`);
            }
            // resolve outcome
            const outcome = judge(m.challengerMove, move);
            let result = "TIE";
            let rakeBig = 0n;
            let winnerUserId = null;
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
            }
            else {
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
                    // Update streaks outside of database transaction
                    streakUpdates.push({
                        discordId: m.Challenger.discordId,
                        won: true
                    });
                    streakUpdates.push({
                        discordId: i.user.id,
                        won: false
                    });
                }
                else {
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
                    // Update streaks outside of database transaction
                    streakUpdates.push({
                        discordId: i.user.id,
                        won: true
                    });
                    streakUpdates.push({
                        discordId: m.Challenger.discordId,
                        won: false
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
            // Calculate rake savings for analytics
            const originalRake = rpsPayout(wager, BigInt(cfg.houseFeeBps ?? 200)).rake;
            const rakeSaved = originalRake - rakeBig;
            // finalize match row
            const final = await tx.match.update({
                where: { id: m.id },
                data: {
                    status: "SETTLED",
                    joinerId: joiner.id, // keep joiner even on ties
                    joinerMove: move,
                    result,
                    rakeAtomic: rakeBig.toString(), // Store atomic units, not converted amounts
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
        }, { timeout: 15000, maxWait: 15000 });
        // Process streak updates after successful transaction
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
            }
            catch (error) {
                console.error("Failed to update streak:", error);
            }
        }
        // Update the public match message (AFTER COMMIT)
        try {
            const ch2 = await i.client.channels.fetch(settled.channelId);
            if (ch2?.isTextBased() && "messages" in ch2 && settled.messageId) {
                const challengerTag = settled.Challenger ? `<@${settled.Challenger.discordId}>` : "Unknown Challenger";
                const joinerTag = settled.Joiner ? `<@${settled.Joiner.discordId}>` : "Opponent";
                const potBig = 2n * decToBigDirect(settled.wagerAtomic, settled.Token.decimals);
                const rakeBig = decToBigDirect(settled.rakeAtomic, settled.Token.decimals);
                const payoutBig = potBig - rakeBig;
                const outcomeLine = settled.result === "TIE" ? "Tie. Both refunded." :
                    settled.result === "WIN_CHALLENGER" ? `${challengerTag} wins` :
                        `${joinerTag} wins`;
                const ad = await getActiveAd();
                await ch2.messages.edit(settled.messageId, {
                    embeds: [matchResultEmbed({
                            challengerTag,
                            joinerTag,
                            challengerMove: label(settled.challengerMove),
                            joinerMove: label(settled.joinerMove),
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
        }
        catch {
            // ignore edit failures
        }
        // Build response with ENHANCED rake benefit notification
        let responseContent = "Match resolved.";
        if (rakeReductionBenefit) {
            const rakeSavedBig = decToBigDirect(settled.rakeSavedAtomic, settled.Token.decimals);
            if (rakeSavedBig > 0n && settled.result !== "TIE") {
                const benefit = rakeReductionBenefit;
                const enhancedMessage = await formatRakeBenefitNotification(benefit, formatAmount(rakeSavedBig, settled.Token), settled.Token.symbol, i.guildId || '');
                responseContent += `\n🎮 ${enhancedMessage}`;
                // Add tier purchase button for FOMO conversion if tier-based rake benefit was used
                const tierButton = await createMatchTierButton(rakeReductionBenefit, i.user.id);
                if (tierButton) {
                    await i.editReply({
                        content: responseContent,
                        components: [tierButton]
                    }).catch(() => { });
                    return; // Exit early since we already edited with components
                }
            }
        }
        await i.editReply({ content: responseContent }).catch(() => { });
    }
    catch (err) {
        await i.editReply({ content: `Failed to join: ${err?.message || String(err)}` }).catch(() => { });
    }
}
/** Challenger cancels their offered match (refund). */
export async function handleCancel(i, matchId) {
    // Ack fast
    await i.deferReply({ ephemeral: true }).catch(() => { });
    try {
        const result = await prisma.$transaction(async (tx) => {
            const m = await tx.match.findUnique({
                where: { id: matchId },
                include: { Challenger: true, Token: true }
            });
            if (!m)
                throw new Error("Match not found");
            if (m.status !== "OFFERED")
                throw new Error("Cannot cancel now");
            if (!m.Challenger)
                throw new Error("Match challenger not found");
            if (m.Challenger.discordId !== i.user.id)
                throw new Error("Only the challenger can cancel");
            const wager = decToBigDirect(m.wagerAtomic, m.Token.decimals);
            // refund challenger using tx-aware credit
            if (!m.Challenger)
                throw new Error("Match challenger not found");
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
                    await ch.messages.edit(result.messageId, {
                        content: "Match canceled and refunded.",
                        embeds: [],
                        components: []
                    });
                }
            }
        }
        catch { }
        await i.editReply({ content: "Canceled." }).catch(() => { });
    }
    catch (err) {
        await i.editReply({ content: `Failed to cancel: ${err?.message || String(err)}` }).catch(() => { });
    }
}
/**
 * Enhanced rake benefit notification formatter with social proof for gaming
 * Shows which specific role or tier granted the gaming benefit
 */
async function formatRakeBenefitNotification(benefit, savedAmount, tokenSymbol, guildId) {
    try {
        // Parse benefit source to determine type and get real name
        if (benefit.source.startsWith('role:')) {
            const roleId = benefit.source.substring(5);
            // Try to get Discord role name for enhanced social proof
            try {
                const discord = getDiscordClient();
                if (discord && guildId) {
                    const guild = await discord.guilds.fetch(guildId);
                    const role = await guild?.roles.fetch(roleId);
                    if (role && role.name) {
                        // Enhanced gaming notification with actual role name and special gaming language
                        const cleanRoleName = role.name.trim();
                        if (cleanRoleName.length > 0 && cleanRoleName !== roleId) {
                            return `Victory! Your **${cleanRoleName}** role eliminated house fees - kept ${savedAmount} extra ${tokenSymbol}!`;
                        }
                    }
                }
            }
            catch (error) {
                // Suppress common Discord API errors to avoid spam
                if (!String(error).includes('rate limit') && !String(error).includes('timeout')) {
                    console.warn('Discord API unavailable for gaming role name lookup:', String(error));
                }
            }
            // Fallback to label if Discord lookup fails
            return `Victory! Your **${benefit.label}** eliminated house fees - kept ${savedAmount} extra ${tokenSymbol}!`;
        }
        else if (benefit.source.startsWith('tier:')) {
            // Tier notification with premium language
            return `Victory! Your **${benefit.label}** perks eliminated house fees - kept ${savedAmount} extra ${tokenSymbol}!`;
        }
        else {
            // Generic fallback
            return `Victory! Your **${benefit.label}** reduced house fees - saved ${savedAmount} ${tokenSymbol}!`;
        }
    }
    catch (error) {
        console.error('Error formatting rake benefit notification:', error);
        // Simple fallback
        return `Victory! Your **${benefit.label}** saved ${savedAmount} ${tokenSymbol} in fees!`;
    }
}
/**
 * Create tier purchase button for gaming rake benefits (FOMO conversion)
 */
async function createMatchTierButton(benefit, userDiscordId) {
    try {
        // Only show for tier-based benefits
        if (!benefit || !benefit.source.startsWith('tier:')) {
            return null;
        }
        // Import prisma here to avoid circular imports
        const { prisma } = await import("../../services/db.js");
        // Check if user already has active tier
        const user = await prisma.user.findUnique({
            where: { discordId: userDiscordId },
            include: {
                tierMemberships: {
                    where: {
                        status: 'ACTIVE',
                        expiresAt: { gt: new Date() }
                    }
                }
            }
        });
        // Don't show to existing tier members
        if (user && user.tierMemberships.length > 0) {
            return null;
        }
        // Get cheapest available tier
        const availableTier = await prisma.tier.findFirst({
            where: { active: true },
            include: {
                prices: {
                    include: { token: true }
                }
            },
            orderBy: { priceAmount: 'asc' }
        });
        if (!availableTier || !availableTier.prices[0]) {
            return null;
        }
        // Create FOMO gaming tier button
        const savingsPercent = Math.round(benefit.reductionRate);
        const tierButton = new ButtonBuilder()
            .setCustomId(`pip:tier_purchase:${availableTier.id}`)
            .setLabel(`🏆 Get ${availableTier.name} - Save ${savingsPercent}% on gaming fees`)
            .setStyle(ButtonStyle.Success)
            .setEmoji("🎮");
        const row = new ActionRowBuilder()
            .addComponents(tierButton);
        return row;
    }
    catch (error) {
        console.error('Error creating match tier button:', error);
        return null;
    }
}
