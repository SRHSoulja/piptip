import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { pipchipsService } from "../services/pipchips_service.js";
import { ensureUser } from "../services/balances.js";
export default async function pipBalance(i) {
    try {
        await i.deferReply({ ephemeral: true });
        // Ensure user exists in database
        await ensureUser(i.user.id);
        // Get balance and streak information
        const [balance, streakInfo] = await Promise.all([
            pipchipsService.getUserBalance(i.user.id),
            pipchipsService.getStreakInfo(i.user.id)
        ]);
        // Format balance numbers with commas
        const formatNumber = (num) => {
            return num.toLocaleString();
        };
        // Create main balance embed
        const embed = new EmbedBuilder()
            .setTitle("💰 Your PIPChips Balance")
            .setColor(0x3B82F6)
            .setAuthor({
            name: i.user.displayName,
            iconURL: i.user.displayAvatarURL()
        });
        // Balance section
        embed.addFields({
            name: "🎰 Current Balance",
            value: `**${formatNumber(balance.balance)}** PIPChips`,
            inline: true
        });
        // Streak section
        const streakEmoji = streakInfo.currentStreak >= 7 ? "🔥" :
            streakInfo.currentStreak >= 3 ? "⭐" : "📅";
        embed.addFields({
            name: `${streakEmoji} Daily Streak`,
            value: [
                `**Current:** ${streakInfo.currentStreak} days`,
                `**Best:** ${streakInfo.longestStreak} days`,
                `**Multiplier:** ${streakInfo.streakMultiplier}x`
            ].join('\n'),
            inline: true
        });
        // Statistics section
        embed.addFields({
            name: "📊 Statistics",
            value: [
                `**Total Earned:** ${formatNumber(balance.earnedTotal)}`,
                `**Total Spent:** ${formatNumber(balance.spentTotal)}`,
                `**Total Bought:** ${formatNumber(balance.boughtTotal)}`
            ].join('\n'),
            inline: false
        });
        // Daily bonus section
        if (streakInfo.canClaim) {
            embed.addFields({
                name: "🎁 Daily Bonus Available!",
                value: `Claim your daily bonus now to continue your ${streakInfo.currentStreak}-day streak!`,
                inline: false
            });
            embed.setColor(0x10B981); // Green when bonus available
        }
        else {
            const hours = Math.floor(streakInfo.hoursUntilNext);
            const minutes = Math.floor((streakInfo.hoursUntilNext - hours) * 60);
            embed.addFields({
                name: "⏰ Next Daily Bonus",
                value: `Available in ${hours}h ${minutes}m`,
                inline: false
            });
        }
        // Last daily claim info
        if (balance.lastDaily) {
            embed.setFooter({
                text: `Last daily claimed: ${balance.lastDaily.toLocaleDateString()}`
            });
        }
        else {
            embed.setFooter({
                text: "Tip: Use /pip_daily to claim your daily bonus!"
            });
        }
        // Action buttons
        const row = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId("claim_daily")
            .setLabel(streakInfo.canClaim ? "Claim Daily Bonus" : "Daily Claimed")
            .setStyle(streakInfo.canClaim ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji("🎁")
            .setDisabled(!streakInfo.canClaim), new ButtonBuilder()
            .setCustomId("view_transactions")
            .setLabel("Transaction History")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("📊"), new ButtonBuilder()
            .setCustomId("buy_chips")
            .setLabel("Buy More Chips")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("💰"));
        await i.editReply({ embeds: [embed], components: [row] });
    }
    catch (error) {
        console.error("Balance command error:", error);
        if (i.deferred) {
            await i.editReply({
                content: `❌ **Error loading balance**\n${error?.message || String(error)}`
            });
        }
        else {
            await i.reply({
                content: `❌ **Error loading balance**\n${error?.message || String(error)}`,
                ephemeral: true
            });
        }
    }
}
