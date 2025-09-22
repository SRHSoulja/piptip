import { prisma } from "../services/db.js";
import { decToBigDirect, formatAmount } from "../services/token.js";
import { groupTipEmbed } from "../ui/embeds.js";
import { groupTipClaimRow } from "../ui/components.js";
import { rateLimitedDiscord } from "../services/discord_rate_limiter.js";
export async function updateGroupTipMessage(client, groupTipId) {
    console.log(`🚀 ENTERING updateGroupTipMessage for tip ${groupTipId}`);
    try {
        console.log(`🔍 Fetching tip ${groupTipId} from database...`);
        const tip = await prisma.groupTip.findUnique({
            where: { id: groupTipId },
            include: {
                Creator: true,
                Token: true,
                claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
                contributions: { include: { contributor: true }, orderBy: { createdAt: "asc" } },
            },
        });
        console.log(`🔍 Database query completed for tip ${groupTipId}:`, {
            found: !!tip,
            status: tip?.status,
            channelId: tip?.channelId,
            messageId: tip?.messageId
        });
        if (!tip || !tip.channelId || !tip.messageId) {
            console.log(`❌ updateGroupTipMessage: Missing required data for tip ${groupTipId}`);
            return;
        }
        console.log(`🔍 Processing tip data for tip ${groupTipId}...`);
        const now = new Date();
        const expired = (!!tip.expiresAt && now >= tip.expiresAt) || tip.status === 'FINALIZED';
        console.log(`🔍 Calculated expired=${expired} for tip ${groupTipId}`);
        const claimCount = tip.claims.length;
        const claimedBy = tip.claims
            .map(c => (c.User?.discordId ? `<@${c.User.discordId}>` : null))
            .filter(Boolean);
        console.log(`🔍 Claims processed: ${claimCount} claims, ${claimedBy.length} with Discord IDs`);
        const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";
        console.log(`🔍 Creator display: ${creatorDisplay}`);
        const atomicTotal = decToBigDirect(tip.totalAmount, tip.Token.decimals);
        console.log(`🔍 Calculated atomicTotal: ${atomicTotal}`);
        const amountStr = formatAmount(atomicTotal, {
            address: tip.Token.address,
            symbol: tip.Token.symbol,
            decimals: tip.Token.decimals,
        });
        console.log(`🔍 Formatted amount: ${amountStr}`);
        // Calculate payout per user if finalized
        let payoutPerUser;
        console.log(`🔍 About to calculate payoutPerUser, tip.status=${tip.status}, claimCount=${claimCount}`);
        if (tip.status === 'FINALIZED' && claimCount > 0) {
            const totalPayout = decToBigDirect(tip.totalAmount, tip.Token.decimals);
            const perUser = totalPayout / BigInt(claimCount);
            payoutPerUser = formatAmount(perUser, {
                address: tip.Token.address,
                symbol: tip.Token.symbol,
                decimals: tip.Token.decimals,
            });
        }
        console.log(`🔍 About to create embed with data:`, {
            expired,
            isFinalized: tip.status === 'FINALIZED',
            payoutPerUser
        });
        const embed = groupTipEmbed({
            creator: creatorDisplay,
            amount: amountStr,
            expiresAt: tip.expiresAt, // not optional in your schema
            claimCount,
            claimedBy,
            isExpired: expired, // 👈 tell the embed it's expired
            isFinalized: tip.status === 'FINALIZED',
            payoutPerUser,
            // note: (omit, since GroupTip has no note column)
        });
        console.log(`🔍 Embed created successfully`);
        // Force Discord cache refresh by setting a new timestamp for finalized tips
        if (tip.status === 'FINALIZED') {
            console.log(`🔍 Setting fresh timestamp for finalized tip`);
            embed.setTimestamp(new Date());
        }
        const components = [groupTipClaimRow(tip.id, expired || tip.status !== "ACTIVE")];
        const channel = await rateLimitedDiscord.fetchChannel(client, tip.channelId).catch(() => null);
        if (!channel || typeof channel !== 'object' || !('isTextBased' in channel) || typeof channel.isTextBased !== 'function' || !channel.isTextBased())
            return;
        const msg = await channel.messages.fetch(tip.messageId).catch(() => null);
        if (!msg)
            return;
        // Use rate limiter for message editing to prevent Discord API issues
        console.log(`🔧 updateGroupTipMessage: Editing message for tip ${groupTipId}`, {
            expired,
            isFinalized: tip.status === 'FINALIZED',
            status: tip.status,
            messageId: tip.messageId,
            embedFields: embed.data.fields?.map(f => ({ name: f.name, value: f.value }))
        });
        try {
            console.log(`🔧 updateGroupTipMessage: Making DIRECT Discord API call for tip ${groupTipId}`);
            const result = await msg.edit({ embeds: [embed], components });
            console.log(`✅ updateGroupTipMessage: DIRECT Discord API success:`, {
                messageId: result.id,
                editedTimestamp: result.editedTimestamp,
                embedsLength: result.embeds?.length,
                embedTitle: result.embeds?.[0]?.title
            });
            console.log(`✅ updateGroupTipMessage: Successfully edited message for tip ${groupTipId}`);
        }
        catch (error) {
            console.error(`❌ updateGroupTipMessage: Failed to edit message for tip ${groupTipId}:`, {
                error: error.message,
                name: error.name,
                code: error.code,
                status: error.status
            });
            throw error;
        }
    }
    catch (outerError) {
        console.error(`💥 FATAL ERROR in updateGroupTipMessage for tip ${groupTipId}:`, {
            error: outerError.message,
            name: outerError.name,
            stack: outerError.stack
        });
        throw outerError;
    }
}
