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
      .addStringOption(o => 
        o.setName("token")
          .setDescription("Select token to deposit")
          .setRequired(true)
          .setAutocomplete(true)
      ),
    
    new SlashCommandBuilder()
      .setName("pip_game")
      .setDescription("🎮 Challenge others to Penguin Ice Pebble - a rock-paper-scissors style game!")
      .addStringOption(o => 
        o.setName("token")
          .setDescription("Select token to wager")
          .setRequired(true)
          .setAutocomplete(true)
      )
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
      .addSubcommand(subcommand =>
        subcommand
          .setName("set")
          .setDescription("Set your bio and social links")
          .addStringOption(option =>
            option.setName("bio")
              .setDescription("Your bio text (max 500 characters)")
              .setRequired(true)
          )
          .addStringOption(option =>
            option.setName("x_username")
              .setDescription("Your X/Twitter username (without @)")
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName("view")
          .setDescription("View a user's bio")
          .addUserOption(option =>
            option.setName("user")
              .setDescription("User to view (leave empty for your own)")
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName("clear")
          .setDescription("Clear your bio and remove from PenguBook")
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName("settings")
          .setDescription("Manage your PenguBook privacy settings")
      ),
    
    new SlashCommandBuilder()
      .setName("pip_pengubook")
      .setDescription("📖 Browse user profiles, discover the community, and send tips!")
      .addStringOption(option =>
        option.setName("mode")
          .setDescription("How to browse profiles")
          .setRequired(false)
          .addChoices(
            { name: "🕒 Recent - Most recently updated", value: "recent" },
            { name: "🔥 Popular - Most profile views", value: "popular" },
            { name: "🎲 Random - Random discovery", value: "random" }
          )
      )
      .addIntegerOption(option =>
        option.setName("page")
          .setDescription("Page number to start from")
          .setRequired(false)
          .setMinValue(1)
      ),

    new SlashCommandBuilder()
      .setName("pip_achievements")
      .setDescription("🏆 View achievements and badges")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("User to view achievements for (defaults to yourself)")
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("pip_leaderboard")
      .setDescription("🏅 View leaderboards and rankings")
      .addStringOption(option =>
        option.setName("category")
          .setDescription("Leaderboard category")
          .setRequired(false)
          .addChoices(
            { name: "🔥 Win Streaks", value: "streaks" },
            { name: "🏆 Total Wins", value: "wins" },
            { name: "📊 Win Rate", value: "winrate" },
            { name: "💸 Tips Sent", value: "tips_sent" },
            { name: "💝 Tips Received", value: "tips_received" },
            { name: "👥 Referrals", value: "referrals" },
            { name: "💰 Wealth", value: "wealth" }
          )
      ),

    new SlashCommandBuilder()
      .setName("pip_apply")
      .setDescription("📝 Apply for PIPTip access for your Discord server"),

    new SlashCommandBuilder()
      .setName("pip_balance")
      .setDescription("💰 View your PIPChips balance, streak info, and statistics"),

    new SlashCommandBuilder()
      .setName("pip_daily")
      .setDescription("🎁 Claim your daily PIPChips bonus and build your streak!"),

    new SlashCommandBuilder()
      .setName("pip_buy_chips")
      .setDescription("🛒 Purchase PIPChips with your tokens")
      .addIntegerOption(option =>
        option.setName("amount")
          .setDescription("Amount of PIPChips to purchase")
          .setRequired(true)
          .setMinValue(1)
      )
      .addStringOption(option =>
        option.setName("token")
          .setDescription("Token to use for purchase")
          .setRequired(true)
          .setAutocomplete(true)
      ),


    new SlashCommandBuilder()
      .setName("pip_settings")
      .setDescription("⚙️ Configure PIPTip channel settings and permissions")
      .addSubcommand(subcommand =>
        subcommand
          .setName("channels")
          .setDescription("View and configure channel settings")
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName("setup")
          .setDescription("Quick setup wizard for channel configuration")
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName("activity")
          .setDescription("View channel activity and usage statistics")
          .addIntegerOption(option =>
            option.setName("hours")
              .setDescription("Hours to look back (default: 24)")
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(168)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName("reset")
          .setDescription("Reset all channel settings to defaults")
      ),

    new SlashCommandBuilder()
      .setName("pip_safety")
      .setDescription("🛡️ Responsible gaming and prediction safety controls")
      .addSubcommand(subcommand =>
        subcommand
          .setName("limits")
          .setDescription("View or set your daily prediction limits")
          .addIntegerOption(option =>
            option.setName("max_daily_loss")
              .setDescription("Maximum tokens you can lose per day (0 to disable)")
              .setRequired(false)
              .setMinValue(0)
          )
          .addIntegerOption(option =>
            option.setName("max_daily_predictions")
              .setDescription("Maximum predictions you can make per day (0 to disable)")
              .setRequired(false)
              .setMinValue(0)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName("exclude")
          .setDescription("Self-exclude from predictions for a specified time period")
          .addIntegerOption(option =>
            option.setName("duration_hours")
              .setDescription("Hours to exclude yourself (24 hours default, 0 for permanent)")
              .setRequired(false)
              .setMinValue(0)
              .setMaxValue(8760)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName("status")
          .setDescription("View your current responsible gaming status and settings")
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName("reminder")
          .setDescription("View responsible gaming guidelines and resources")
      ),
    new SlashCommandBuilder()
      .setName("pip_automation_status")
      .setDescription("🤖 View prediction market automation system status and activity"),
  ];
  return defs.map(d => d.toJSON());
}
