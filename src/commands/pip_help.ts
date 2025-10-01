// src/commands/pip_help.ts - Bot usage guide and help
import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getConfig } from "../config.js";

export default async function pipHelp(i: ChatInputCommandInteraction) {
  // Load current config for dynamic referral info
  const config = await getConfig();
  const embed = new EmbedBuilder()
    .setTitle("🐧🧊🪨 PIPTip Bot Help")
    .setDescription("**Welcome to PIPTip!** The Penguin Ice Pebble Tip Bot - tip tokens, play games, and climb the colony ranks on Abstract Chain")
    .setColor(0x5865F2)
    .addFields(
      {
        name: "🚀 Getting Started",
        value: 
          "1️⃣ **View Profile**: `/pip_profile` - View your balance and account details (auto-creates account)\n" +
          "2️⃣ **Get Wallet**: Visit **abs.xyz** to create a free Abstract wallet\n" +
          "3️⃣ **Link Wallet**: `/pip_link address:0x...` - Connect your wallet for deposits\n" +
          "4️⃣ **Add Funds**: `/pip_deposit token:PENGUIN` - Get deposit instructions\n" +
          "5️⃣ **Start Playing**: `/pip_tip amount:10 user:@friend` - Send tips or `/pip_game` to challenge friends!",
        inline: false
      },
      ...(config.referralEnabled ? [{
        name: "🔗 Referral Rewards",
        value: (() => {
          const taxReduction = (config.referralTaxReductionBps / 100).toFixed(1);
          const rakeReduction = (config.referralRakeReductionBps / 100).toFixed(1);
          const threshold = Number(config.referralVerificationThreshold);
          const rewardInterval = config.referralRewardInterval;
          const welcomeBonus = Number(config.referralWelcomeBonus);

          let benefits = "**New User Benefits:**\n";

          if (Number(taxReduction) > 0) {
            benefits += `💰 ${taxReduction}% tip fee reduction for your first ${threshold} tokens\n`;
          }
          if (Number(rakeReduction) > 0) {
            benefits += `🎮 ${rakeReduction}% game rake reduction for your first ${threshold} tokens\n`;
          }
          if (welcomeBonus > 0) {
            benefits += `🎁 ${welcomeBonus} token welcome bonus on first tip\n`;
          }

          benefits += `\n**Referrer Rewards:**\n`;
          benefits += `🏆 1-week tax-free membership every ${rewardInterval} verified referrals\n`;
          benefits += `🏅 Achievement badges for referral milestones\n\n`;

          benefits += `**Commands:**\n`;
          benefits += `\`/pip_referral code\` - Get your referral code to share\n`;
          benefits += `\`/pip_referral use CODE123\` - Use a friend's referral code\n`;
          benefits += `\`/pip_referral stats\` - View your referral statistics`;

          return benefits;
        })(),
        inline: false
      }] : []),
      {
        name: "💸 Tipping Commands",
        value:
          "**Direct Tips**: `/pip_tip amount:10 user:@someone` - Send tokens to a specific user\n" +
          "**Group Tips**: `/pip_tip amount:10` - Create a tip everyone can claim (leave user empty)\n" +
          "**With Notes**: `/pip_tip amount:5 user:@friend note:\"Great work!\"` - Add a message\n\n" +
          "💡 *Tip: The same command does both - just include or omit the user parameter!*",
        inline: false
      },
      {
        name: "🎮 Gaming & Features",
        value:
          "**Challenge Players**: `/pip_game token:ABSTER amount:5` - Start a Penguin Ice Pebble match\n" +
          "**View Profile**: `/pip_profile` - See your balance, stats, and recent activity\n" +
          "**Detailed Stats**: `/pip_stats` - Comprehensive transaction history and analytics\n" +
          "**Achievements**: `/pip_achievements` - View your unlocked achievements and progress\n" +
          "**Leaderboards**: `/pip_leaderboard category:streaks` - See top players (streaks, wins, tips, etc.)\n" +
          "**Withdraw Funds**: `/pip_withdraw` - Interactive withdrawal interface with your holdings and limits",
        inline: false
      },
      {
        name: "📈 Progression System",
        value:
          "**🎖️ Penguin Levels**: Earn XP from tips, games, and activities to level up\n" +
          "• Higher levels unlock perks and show your colony status\n" +
          "• Check your level progress in `/pip_profile`\n\n" +
          "**🌟 Social Score**: Your overall colony contribution ranking\n" +
          "• Earn points from tipping, winning matches, achievements, and more\n" +
          "• View your rank on the social leaderboard\n" +
          "• Active participation = higher standing in the colony\n\n" +
          "**🏆 Achievements**: Complete challenges to unlock badges and rewards\n" +
          "• View your progress with `/pip_achievements`\n" +
          "• Some achievements grant XP bonuses and special perks",
        inline: false
      },
      {
        name: "🔮 Prediction Markets (Website Only)",
        value:
          "**🌐 All prediction markets are now available exclusively on the website!**\n\n" +
          "**Regular Markets** (PIPChips):\n" +
          "• Trade predictions on crypto prices, sports, and events\n" +
          "• Real-time odds and parimutuel pools\n" +
          "• Visit: `/pengubook/markets`\n\n" +
          "**Tournament Markets** (TPIP):\n" +
          "• Enter tournaments with multi-token payments (any Abstract token)\n" +
          "• Receive TPIP (Tournament PIPChips) for tournament play\n" +
          "• Compete for prizes with isolated tournament balances\n" +
          "• TPIP resets to zero at tournament conclusion\n\n" +
          "💡 *Visit PenguBook to browse active markets, enter tournaments, and start trading!*",
        inline: false
      },
      {
        name: "📖 PenguBook Social Features",
        value:
          "**Create Bio**: `/pip_bio set text:\"Your bio here\"` - Create your PenguBook profile\n" +
          "**Browse Profiles**: `/pip_pengubook` - Discover other users and their bios\n" +
          "**View Statistics**: Web dashboard shows detailed gaming, tipping, and financial stats\n" +
          "**Transaction History**: Complete history of all tips, deposits, and withdrawals\n" +
          "**🔍 Search Users**: Use the search feature to find specific Discord usernames safely\n" +
          "**Send Messages**: Tip with notes through PenguBook - messages go to their inbox\n\n" +
          "🛡️ *Safety: Always verify exact usernames to avoid impersonators!*",
        inline: false
      },
      {
        name: "🛡️ Server Administration",
        value:
          "**For Server Owners & Admins:**\n" +
          "📝 **Apply for PIPTip**: `/pip_apply` or visit `/pengubook/apply` to get your server approved\n" +
          "🌐 **Web Dashboard**: Visit `/server` on PenguBook to manage your Discord server settings\n" +
          "⚙️ **Channel Controls**: Configure which channels allow tipping and gaming\n" +
          "📊 **Activity Monitoring**: View server-wide PIPTip usage statistics\n" +
          "🔧 **Permission Management**: Fine-tune bot permissions and restrictions\n\n" +
          "*Server approval required first, then Administrator or Manage Server permissions*",
        inline: false
      },
      {
        name: "⭐ Premium Features",
        value:
          "🔹 **Tier Memberships**: Purchase premium tiers for reduced fees and special perks\n" +
          "🔹 **Tax-Free Tipping**: Premium members get lower or no fees on tips\n" +
          "🔹 **Exclusive Perks**: Priority support and special benefits\n\n" +
          "*Check your profile for membership options!*",
        inline: false
      },
      {
        name: "🛠️ Quick Reference",
        value:
          "**Account Management**:\n" +
          "`/pip_link` - Link your Abstract wallet\n" +
          "`/pip_profile` - View balance and stats\n\n" +
          "**Money & Tokens**:\n" +
          "`/pip_deposit` - Add funds to your account\n" +
          "`/pip_withdraw` - Interactive withdrawal interface\n" +
          "`/pip_tip` - Send tips (direct or group)\n\n" +
          "**Social & Gaming**:\n" +
          "`/pip_bio` - Manage your PenguBook profile\n" +
          "`/pip_pengubook` - Browse community profiles\n" +
          "`/pip_game` - Challenge others to play\n" +
          "`/pip_achievements` - View unlocked achievements\n" +
          "`/pip_leaderboard` - See community leaderboards\n" +
          "`/pip_stats` - Detailed transaction analytics\n" +
          (config.referralEnabled ? "`/pip_referral` - Referral system and rewards\n" : "") +
          "`/pip_help` - Show this guide",
        inline: false
      }
    )
    .setFooter({ 
      text: "💡 Pro tip: Most commands support autocomplete - just start typing!" 
    })
    .setTimestamp();

  // Add web access buttons
  const webAccessRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setURL(`${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/pengubook`)
        .setLabel("🌐 Open PenguBook")
        .setStyle(ButtonStyle.Link)
        .setEmoji("💻"),
      new ButtonBuilder()
        .setURL(`${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/server`)
        .setLabel("🛡️ Server Admin")
        .setStyle(ButtonStyle.Link)
        .setEmoji("⚙️"),
      new ButtonBuilder()
        .setCustomId("pip:view_profile")
        .setLabel("👤 Profile")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📊")
    );

  await i.reply({
    embeds: [embed],
    components: [webAccessRow],
    ephemeral: true
  });
}