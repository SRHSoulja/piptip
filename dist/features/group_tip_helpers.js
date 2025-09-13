import { prisma } from "../services/db.js";
import { decToBigDirect, formatAmount } from "../services/token.js";
import { groupTipEmbed } from "../ui/embeds.js";
import { groupTipClaimRow } from "../ui/components.js";
export async function updateGroupTipMessage(client, groupTipId) {
    const tip = await prisma.groupTip.findUnique({
        where: { id: groupTipId },
        include: {
            Creator: true,
            Token: true,
            claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
        },
    });
    if (!tip || !tip.channelId || !tip.messageId)
        return;
    const now = new Date();
    const expired = !!tip.expiresAt && now >= tip.expiresAt;
    const claimCount = tip.claims.length;
    const claimedBy = tip.claims
        .map(c => (c.User?.discordId ? `<@${c.User.discordId}>` : null))
        .filter(Boolean);
    const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";
    const atomicTotal = decToBigDirect(tip.totalAmount, tip.Token.decimals);
    const amountStr = formatAmount(atomicTotal, {
        address: tip.Token.address,
        symbol: tip.Token.symbol,
        decimals: tip.Token.decimals,
    });
    const embed = groupTipEmbed({
        creator: creatorDisplay,
        amount: amountStr,
        expiresAt: tip.expiresAt, // not optional in your schema
        claimCount,
        claimedBy,
        isExpired: expired, // 👈 tell the embed it's expired
        // note: (omit, since GroupTip has no note column)
    });
    const components = [groupTipClaimRow(tip.id, expired || tip.status !== "ACTIVE")];
    const channel = await client.channels.fetch(tip.channelId).catch(() => null);
    if (!channel || !channel.isTextBased())
        return;
    const msg = await channel.messages.fetch(tip.messageId).catch(() => null);
    if (!msg)
        return;
    await msg.edit({ embeds: [embed], components });
}
