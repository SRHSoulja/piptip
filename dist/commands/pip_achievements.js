import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { prisma } from "../services/db.js";
import { getStreakStats, formatStreakText } from "../services/streaks.js";
import { areAchievementsEnabled } from "../services/emergency_controls.js";
import { getUserAchievements, formatAchievementBadge } from "../services/achievement_display.js";
export default async function pipAchievements(i) {
    try {
        // Check if achievements are globally enabled
        if (!(await areAchievementsEnabled())) {
            return i.reply({
                content: "🚫 Achievement system is temporarily disabled",
                flags: MessageFlags.Ephemeral
            });
        }
        // Get user to check with validation
        const targetUser = i.options.getUser("user") || i.user;
        // Validate Discord user ID format (snowflake)
        if (!targetUser.id.match(/^\d{17,19}$/)) {
            return i.reply({
                content: "❌ Invalid user ID format",
                flags: MessageFlags.Ephemeral
            });
        }
        // Get user from database
        const [user, achievements, streakStats] = await Promise.all([
            prisma.user.findUnique({
                where: { discordId: targetUser.id },
                select: {
                    id: true,
                    wins: true,
                    losses: true,
                    ties: true,
                    createdAt: true
                }
            }),
            getUserAchievements(targetUser.id),
            getStreakStats(targetUser.id)
        ]);
        if (!user) {
            return i.reply({
                content: "❌ You don't have an account yet! Use `/pip_profile` to get started.",
                flags: MessageFlags.Ephemeral
            });
        }
        // Calculate total games and win rate
        const totalGames = user.wins + user.losses + user.ties;
        const winRate = totalGames > 0 ? ((user.wins / totalGames) * 100).toFixed(1) : "0.0";
        // Create main embed
        const embed = new EmbedBuilder()
            .setTitle(`🏆 ${targetUser.username}'s Achievements`)
            .setColor(0xFFD700)
            .setThumbnail(targetUser.displayAvatarURL())
            .setTimestamp();
        // Add current stats section
        const streakText = formatStreakText(streakStats.currentWins, streakStats.longestWins);
        embed.addFields({
            name: "🔥 Current Status",
            value: [
                streakText,
                `📊 **Win Rate:** ${winRate}% (${user.wins}W-${user.losses}L-${user.ties}T)`,
                `📅 **Member Since:** <t:${Math.floor(user.createdAt.getTime() / 1000)}:D>`,
                `🏆 **Total Achievements:** ${achievements.length}`
            ].join("\n"),
            inline: false
        });
        // Group achievements by category
        const achievementsByCategory = new Map();
        for (const achievement of achievements) {
            const categoryList = achievementsByCategory.get(achievement.category) || [];
            categoryList.push(achievement);
            achievementsByCategory.set(achievement.category, categoryList);
        }
        // Display achievements by category
        if (achievements.length > 0) {
            const categoryOrder = ['streaks', 'tips', 'deposits', 'referrals', 'veteran', 'special'];
            const categoryNames = {
                streaks: "🔥 Streak Achievements",
                tips: "💸 Tipping Achievements",
                deposits: "💰 Deposit Milestones",
                referrals: "👥 Referral Achievements",
                veteran: "🎖️ Veteran Status",
                special: "✨ Special Achievements"
            };
            for (const category of categoryOrder) {
                const categoryAchievements = achievementsByCategory.get(category) || [];
                if (categoryAchievements.length > 0) {
                    const badges = categoryAchievements
                        .sort((a, b) => new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime())
                        .slice(0, 5)
                        .map((achievement) => {
                        const badge = formatAchievementBadge(achievement);
                        const date = `<t:${Math.floor(new Date(achievement.unlockedAt).getTime() / 1000)}:R>`;
                        return `${badge} - ${date}`;
                    })
                        .join("\n");
                    embed.addFields({
                        name: categoryNames[category],
                        value: badges.substring(0, 1024),
                        inline: false
                    });
                }
            }
            // Add rarity breakdown
            const rarityCount = achievements.reduce((acc, achievement) => {
                acc[achievement.rarity] = (acc[achievement.rarity] || 0) + 1;
                return acc;
            }, {});
            const rarityText = Object.entries(rarityCount)
                .map(([rarity, count]) => {
                const rarityEmojis = {
                    common: "⚪",
                    rare: "🔵",
                    epic: "🟣",
                    legendary: "🟡"
                };
                return `${rarityEmojis[rarity]} ${rarity}: ${count}`;
            })
                .join(" • ");
            if (rarityText) {
                embed.addFields({
                    name: "💎 Rarity Breakdown",
                    value: rarityText,
                    inline: false
                });
            }
        }
        else {
            embed.addFields({
                name: "🎯 No Achievements Yet",
                value: "Play matches, send tips, and explore PIPtip to unlock achievements!",
                inline: false
            });
        }
        // Action buttons
        const buttons = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId("achievements_refresh")
            .setLabel("🔄 Refresh")
            .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
            .setCustomId("achievements_categories")
            .setLabel("📋 Browse All")
            .setStyle(ButtonStyle.Primary));
        await i.reply({
            embeds: [embed],
            components: [buttons]
        });
    }
    catch (error) {
        console.error("Error in pip_achievements:", error);
        await i.reply({
            content: `❌ Error loading achievements: ${error?.message || "Unknown error"}`,
            flags: MessageFlags.Ephemeral
        }).catch(() => { });
    }
}
