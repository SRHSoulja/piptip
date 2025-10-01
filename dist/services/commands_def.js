import { SlashCommandBuilder } from "discord.js";
import { data as pipReferralData } from "../commands/pip_referral.js";
function getCommandsJson() {
  const defs = [
    new SlashCommandBuilder().setName("pip_profile").setDescription("\u{1F464} View your balance, stats, and account details"),
    new SlashCommandBuilder().setName("pip_withdraw").setDescription("\u{1F4B8} Interactive withdrawal - view your holdings and withdraw to your wallet"),
    new SlashCommandBuilder().setName("pip_deposit").setDescription("\u{1F4B0} Get instructions to add funds to your account").addStringOption(
      (o) => o.setName("token").setDescription("Select token to deposit").setRequired(true).setAutocomplete(true)
    ),
    new SlashCommandBuilder().setName("pip_game").setDescription("\u{1F3AE} Challenge others to Penguin Ice Pebble - a rock-paper-scissors style game!").addStringOption(
      (o) => o.setName("token").setDescription("Select token to wager").setRequired(true).setAutocomplete(true)
    ).addNumberOption((o) => o.setName("amount").setDescription("Wager amount").setRequired(true)),
    new SlashCommandBuilder().setName("pip_link").setDescription("\u{1F517} Connect your Abstract wallet for deposits and withdrawals").addStringOption((o) => o.setName("address").setDescription("Your wallet address (0x...)").setRequired(true)),
    new SlashCommandBuilder().setName("pip_tip").setDescription("\u{1F4B8} Tip tokens - specify user for direct tip, leave empty for group tip!").addNumberOption((o) => o.setName("amount").setDescription("Amount to tip").setRequired(true)).addUserOption((o) => o.setName("user").setDescription("Who to tip (leave empty for group tip that everyone can claim)").setRequired(false)).addStringOption((o) => o.setName("note").setDescription("Optional note").setRequired(false)),
    new SlashCommandBuilder().setName("pip_help").setDescription("\u{1F4DA} Learn how to use PIPTip bot - commands, tips, and getting started!"),
    new SlashCommandBuilder().setName("pip_stats").setDescription("\u{1F4CA} View your comprehensive statistics and export transaction history"),
    new SlashCommandBuilder().setName("pip_bio").setDescription("\u{1F4DD} Manage your PenguBook profile - bio, X/Twitter, and settings").addSubcommand(
      (subcommand) => subcommand.setName("set").setDescription("Set your bio and social links").addStringOption(
        (option) => option.setName("bio").setDescription("Your bio text (max 500 characters)").setRequired(true)
      ).addStringOption(
        (option) => option.setName("x_username").setDescription("Your X/Twitter username (without @)").setRequired(false)
      )
    ).addSubcommand(
      (subcommand) => subcommand.setName("view").setDescription("View a user's bio").addUserOption(
        (option) => option.setName("user").setDescription("User to view (leave empty for your own)").setRequired(false)
      )
    ).addSubcommand(
      (subcommand) => subcommand.setName("clear").setDescription("Clear your bio and remove from PenguBook")
    ).addSubcommand(
      (subcommand) => subcommand.setName("settings").setDescription("Manage your PenguBook privacy settings")
    ),
    new SlashCommandBuilder().setName("pip_pengubook").setDescription("\u{1F4D6} Browse user profiles, discover the community, and send tips!").addStringOption(
      (option) => option.setName("mode").setDescription("How to browse profiles").setRequired(false).addChoices(
        { name: "\u{1F552} Recent - Most recently updated", value: "recent" },
        { name: "\u{1F525} Popular - Most profile views", value: "popular" },
        { name: "\u{1F3B2} Random - Random discovery", value: "random" }
      )
    ).addIntegerOption(
      (option) => option.setName("page").setDescription("Page number to start from").setRequired(false).setMinValue(1)
    ),
    new SlashCommandBuilder().setName("pip_achievements").setDescription("\u{1F3C6} View achievements and badges").addUserOption(
      (option) => option.setName("user").setDescription("User to view achievements for (defaults to yourself)").setRequired(false)
    ),
    new SlashCommandBuilder().setName("pip_leaderboard").setDescription("\u{1F3C5} View leaderboards and rankings").addStringOption(
      (option) => option.setName("category").setDescription("Leaderboard category").setRequired(false).addChoices(
        { name: "\u{1F525} Win Streaks", value: "streaks" },
        { name: "\u{1F3C6} Total Wins", value: "wins" },
        { name: "\u{1F4CA} Win Rate", value: "winrate" },
        { name: "\u{1F4B8} Tips Sent", value: "tips_sent" },
        { name: "\u{1F49D} Tips Received", value: "tips_received" },
        { name: "\u{1F465} Referrals", value: "referrals" },
        { name: "\u{1F4B0} Wealth", value: "wealth" }
      )
    ),
    new SlashCommandBuilder().setName("pip_apply").setDescription("\u{1F4DD} Apply for PIPTip access for your Discord server"),
    new SlashCommandBuilder().setName("pip_balance").setDescription("\u{1F4B0} View your PIPChips balance, streak info, and statistics"),
    new SlashCommandBuilder().setName("pip_daily").setDescription("\u{1F381} Claim your daily PIPChips bonus and build your streak!"),
    new SlashCommandBuilder().setName("pip_buy_chips").setDescription("\u{1F6D2} Purchase PIPChips with your tokens").addIntegerOption(
      (option) => option.setName("amount").setDescription("Amount of PIPChips to purchase").setRequired(true).setMinValue(1)
    ).addStringOption(
      (option) => option.setName("token").setDescription("Token to use for purchase").setRequired(true).setAutocomplete(true)
    ),
    new SlashCommandBuilder().setName("pip_settings").setDescription("\u2699\uFE0F Configure PIPTip channel settings and permissions").addSubcommand(
      (subcommand) => subcommand.setName("channels").setDescription("View and configure channel settings")
    ).addSubcommand(
      (subcommand) => subcommand.setName("setup").setDescription("Quick setup wizard for channel configuration")
    ).addSubcommand(
      (subcommand) => subcommand.setName("activity").setDescription("View channel activity and usage statistics").addIntegerOption(
        (option) => option.setName("hours").setDescription("Hours to look back (default: 24)").setRequired(false).setMinValue(1).setMaxValue(168)
      )
    ).addSubcommand(
      (subcommand) => subcommand.setName("reset").setDescription("Reset all channel settings to defaults")
    ),
    new SlashCommandBuilder().setName("pip_safety").setDescription("\u{1F6E1}\uFE0F Responsible gaming and prediction safety controls").addSubcommand(
      (subcommand) => subcommand.setName("limits").setDescription("View or set your daily prediction limits").addIntegerOption(
        (option) => option.setName("max_daily_loss").setDescription("Maximum tokens you can lose per day (0 to disable)").setRequired(false).setMinValue(0)
      ).addIntegerOption(
        (option) => option.setName("max_daily_predictions").setDescription("Maximum predictions you can make per day (0 to disable)").setRequired(false).setMinValue(0)
      )
    ).addSubcommand(
      (subcommand) => subcommand.setName("exclude").setDescription("Self-exclude from predictions for a specified time period").addIntegerOption(
        (option) => option.setName("duration_hours").setDescription("Hours to exclude yourself (24 hours default, 0 for permanent)").setRequired(false).setMinValue(0).setMaxValue(8760)
      )
    ).addSubcommand(
      (subcommand) => subcommand.setName("status").setDescription("View your current responsible gaming status and settings")
    ).addSubcommand(
      (subcommand) => subcommand.setName("reminder").setDescription("View responsible gaming guidelines and resources")
    ),
    new SlashCommandBuilder().setName("pip_automation_status").setDescription("\u{1F916} View prediction market automation system status and activity"),
    pipReferralData
  ];
  return defs.map((d) => d.toJSON());
}
export {
  getCommandsJson
};
//# sourceMappingURL=commands_def.js.map
