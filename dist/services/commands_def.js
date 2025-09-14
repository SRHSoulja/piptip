// src/services/commands_def.ts
import { SlashCommandBuilder } from "discord.js";
export function getCommandsJson() {
    const defs = [
        new SlashCommandBuilder().setName("pip_profile").setDescription("👤 View your balance, stats, and account details"),
        new SlashCommandBuilder()
            .setName("pip_withdraw")
            .setDescription("💸 Interactive withdrawal - view your holdings and withdraw to your wallet"),
        new SlashCommandBuilder()
            .setName("pip_deposit")
            .setDescription("💰 Get instructions to add funds to your account")
            .addStringOption(o => o.setName("token")
            .setDescription("Select token to deposit")
            .setRequired(true)
            .setAutocomplete(true)),
        new SlashCommandBuilder()
            .setName("pip_game")
            .setDescription("🎮 Challenge others to Penguin Ice Pebble - a rock-paper-scissors style game!")
            .addStringOption(o => o.setName("token")
            .setDescription("Select token to wager")
            .setRequired(true)
            .setAutocomplete(true))
            .addNumberOption(o => o.setName("amount").setDescription("Wager amount").setRequired(true)),
        new SlashCommandBuilder()
            .setName("pip_link")
            .setDescription("🔗 Connect your Abstract wallet for deposits and withdrawals")
            .addStringOption(o => o.setName("address").setDescription("Your wallet address (0x...)").setRequired(true)),
        new SlashCommandBuilder()
            .setName("pip_tip")
            .setDescription("💸 Tip tokens - specify user for direct tip, leave empty for group tip!")
            .addNumberOption(o => o.setName("amount").setDescription("Amount to tip").setRequired(true))
            .addUserOption(o => o.setName("user").setDescription("Who to tip (leave empty for group tip that everyone can claim)").setRequired(false))
            .addStringOption(o => o.setName("note").setDescription("Optional note").setRequired(false)),
        new SlashCommandBuilder()
            .setName("pip_help")
            .setDescription("📚 Learn how to use PIPTip bot - commands, tips, and getting started!"),
        new SlashCommandBuilder()
            .setName("pip_stats")
            .setDescription("📊 View your comprehensive statistics and export transaction history"),
        new SlashCommandBuilder()
            .setName("pip_bio")
            .setDescription("📝 Manage your PenguBook profile - bio, X/Twitter, and settings")
            .addSubcommand(subcommand => subcommand
            .setName("set")
            .setDescription("Set your bio and social links")
            .addStringOption(option => option.setName("bio")
            .setDescription("Your bio text (max 500 characters)")
            .setRequired(true))
            .addStringOption(option => option.setName("x_username")
            .setDescription("Your X/Twitter username (without @)")
            .setRequired(false)))
            .addSubcommand(subcommand => subcommand
            .setName("view")
            .setDescription("View a user's bio")
            .addUserOption(option => option.setName("user")
            .setDescription("User to view (leave empty for your own)")
            .setRequired(false)))
            .addSubcommand(subcommand => subcommand
            .setName("clear")
            .setDescription("Clear your bio and remove from PenguBook"))
            .addSubcommand(subcommand => subcommand
            .setName("settings")
            .setDescription("Manage your PenguBook privacy settings")),
        new SlashCommandBuilder()
            .setName("pip_pengubook")
            .setDescription("📖 Browse user profiles, discover the community, and send tips!")
            .addStringOption(option => option.setName("mode")
            .setDescription("How to browse profiles")
            .setRequired(false)
            .addChoices({ name: "🕒 Recent - Most recently updated", value: "recent" }, { name: "🔥 Popular - Most profile views", value: "popular" }, { name: "🎲 Random - Random discovery", value: "random" }))
            .addIntegerOption(option => option.setName("page")
            .setDescription("Page number to start from")
            .setRequired(false)
            .setMinValue(1)),
        new SlashCommandBuilder()
            .setName("pip_achievements")
            .setDescription("🏆 View achievements and badges")
            .addUserOption(option => option.setName("user")
            .setDescription("User to view achievements for (defaults to yourself)")
            .setRequired(false)),
        new SlashCommandBuilder()
            .setName("pip_leaderboard")
            .setDescription("🏅 View leaderboards and rankings")
            .addStringOption(option => option.setName("category")
            .setDescription("Leaderboard category")
            .setRequired(false)
            .addChoices({ name: "🔥 Win Streaks", value: "streaks" }, { name: "🏆 Total Wins", value: "wins" }, { name: "📊 Win Rate", value: "winrate" }, { name: "💸 Tips Sent", value: "tips_sent" }, { name: "💝 Tips Received", value: "tips_received" }, { name: "👥 Referrals", value: "referrals" }, { name: "💰 Wealth", value: "wealth" })),
    ];
    return defs.map(d => d.toJSON());
}
