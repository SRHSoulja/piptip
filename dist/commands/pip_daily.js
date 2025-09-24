import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { pipchipsService } from "../services/pipchips_service.js";
import { ensureUser } from "../services/balances.js";
export default async function pipDaily(i) {
    try {
        await i.deferReply({ ephemeral: true });
        // Ensure user exists in database
        await ensureUser(i.user.id);
        // Check if user can claim daily bonus
        const streakInfo = await pipchipsService.getStreakInfo(i.user.id);
        if (!streakInfo.canClaim) {
            const hours = Math.floor(streakInfo.hoursUntilNext);
            const minutes = Math.floor((streakInfo.hoursUntilNext - hours) * 60);
            const embed = new EmbedBuilder()
                .setTitle("⏰ Daily Bonus Already Claimed")
                .setDescription(`You've already claimed your daily bonus today!`)
                .setColor(0xF59E0B)
                .addFields({
                name: "🔥 Current Streak",
                value: `${streakInfo.currentStreak} days (${streakInfo.streakMultiplier}x multiplier)`,
                inline: true
            }, {
                name: "⏰ Next Bonus Available",
                value: `${hours}h ${minutes}m`,
                inline: true
            })
                .setFooter({ text: "Come back tomorrow to continue your streak!" });
            const row = new ActionRowBuilder()
                .addComponents(new ButtonBuilder()
                .setCustomId("view_balance")
                .setLabel("View Balance")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("💰"), new ButtonBuilder()
                .setCustomId("buy_chips")
                .setLabel("Buy More Chips")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("🛒"));
            return i.editReply({ embeds: [embed], components: [row] });
        }
        // Claim the daily bonus
        const claimResult = await pipchipsService.claimDailyBonus(i.user.id);
        // Format numbers with commas
        const formatNumber = (num) => {
            return num.toLocaleString();
        };
        // Determine streak achievement level for styling
        let streakColor = 0x10B981; // Green
        let streakEmoji = "🎁";
        let achievementText = "";
        if (claimResult.newStreak >= 100) {
            streakColor = 0x8B5CF6; // Purple
            streakEmoji = "👑";
            achievementText = "**LEGENDARY STREAK!** 🏆";
        }
        else if (claimResult.newStreak >= 30) {
            streakColor = 0xF59E0B; // Gold
            streakEmoji = "🥇";
            achievementText = "**GOLD STREAK!** ⭐";
        }
        else if (claimResult.newStreak >= 7) {
            streakColor = 0xEF4444; // Red/Fire
            streakEmoji = "🔥";
            achievementText = "**ON FIRE!** 🚀";
        }
        else if (claimResult.newStreak >= 3) {
            streakColor = 0x3B82F6; // Blue
            streakEmoji = "⭐";
            achievementText = "**Building momentum!** 💪";
        }
        // Create success embed
        const embed = new EmbedBuilder()
            .setTitle(`${streakEmoji} Daily Bonus Claimed!`)
            .setDescription(achievementText || "Great job staying consistent! 🎉")
            .setColor(streakColor)
            .addFields({
            name: "💰 Bonus Earned",
            value: `**+${formatNumber(claimResult.amount)}** PIPChips`,
            inline: true
        }, {
            name: "🔥 Streak Bonus",
            value: `${claimResult.newStreak} days (${claimResult.streakMultiplier}x)`,
            inline: true
        }, {
            name: "💳 New Balance",
            value: `**${formatNumber(claimResult.newBalance)}** PIPChips`,
            inline: false
        });
        // Add special achievement messages
        if (claimResult.newStreak === 1) {
            embed.addFields({
                name: "🌟 Welcome Back!",
                value: "Keep claiming daily to build your streak and earn bonus multipliers!",
                inline: false
            });
        }
        else if ([7, 14, 30, 50, 100].includes(claimResult.newStreak)) {
            const milestoneRewards = {
                7: "🔥 Week warrior! Your multiplier increased!",
                14: "💎 Two week champion! You're on a roll!",
                30: "🥇 Monthly master! Gold streak achieved!",
                50: "👑 Streak royalty! You're unstoppable!",
                100: "🏆 LEGENDARY STATUS! Maximum multiplier unlocked!"
            };
            embed.addFields({
                name: "🎊 Milestone Achievement!",
                value: milestoneRewards[claimResult.newStreak],
                inline: false
            });
        }
        // Next steps and encouragement
        embed.setFooter({
            text: "Come back tomorrow to continue your streak! Use PIPChips to make predictions in the web app."
        });
        // Action buttons
        const row = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId("view_balance")
            .setLabel("View Full Balance")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("💰"), new ButtonBuilder()
            .setCustomId("web_predictions")
            .setLabel("Make Predictions")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("🎯")
            .setURL(process.env.WEB_URL || "https://piptip.com"), // Will need to update this
        new ButtonBuilder()
            .setCustomId("share_streak")
            .setLabel("Share Streak")
            .setStyle(ButtonStyle.Success)
            .setEmoji("📢"));
        await i.editReply({ embeds: [embed], components: [row] });
    }
    catch (error) {
        console.error("Daily command error:", error);
        if (i.deferred) {
            await i.editReply({
                content: `❌ **Error claiming daily bonus**\n${error?.message || String(error)}`
            });
        }
        else {
            await i.reply({
                content: `❌ **Error claiming daily bonus**\n${error?.message || String(error)}`,
                ephemeral: true
            });
        }
    }
}
