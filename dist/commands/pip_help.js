import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getConfig } from "../config.js";
async function pipHelp(i) {
  const config = await getConfig();
  const embed = new EmbedBuilder().setTitle("\u{1F427}\u{1F9CA}\u{1FAA8} PIPTip Bot Help").setDescription("**Welcome to PIPTip!** Your Discord bot for tipping Abstract Chain tokens (Penguin, Ice, Pebble)").setColor(5793266).addFields(
    {
      name: "\u{1F680} Getting Started",
      value: "1\uFE0F\u20E3 **View Profile**: `/pip_profile` - View your balance and account details (auto-creates account)\n2\uFE0F\u20E3 **Get Wallet**: Visit **abs.xyz** to create a free Abstract wallet\n3\uFE0F\u20E3 **Link Wallet**: `/pip_link address:0x...` - Connect your wallet for deposits\n4\uFE0F\u20E3 **Add Funds**: `/pip_deposit token:PENGUIN` - Get deposit instructions\n5\uFE0F\u20E3 **Start Playing**: `/pip_tip amount:10 user:@friend` - Send tips or `/pip_game` to challenge friends!",
      inline: false
    },
    ...config.referralEnabled ? [{
      name: "\u{1F517} Referral Rewards",
      value: (() => {
        const taxReduction = (config.referralTaxReductionBps / 100).toFixed(1);
        const rakeReduction = (config.referralRakeReductionBps / 100).toFixed(1);
        const threshold = Number(config.referralVerificationThreshold);
        const rewardInterval = config.referralRewardInterval;
        const welcomeBonus = Number(config.referralWelcomeBonus);
        let benefits = "**New User Benefits:**\n";
        if (Number(taxReduction) > 0) {
          benefits += `\u{1F4B0} ${taxReduction}% tip fee reduction for your first ${threshold} tokens
`;
        }
        if (Number(rakeReduction) > 0) {
          benefits += `\u{1F3AE} ${rakeReduction}% game rake reduction for your first ${threshold} tokens
`;
        }
        if (welcomeBonus > 0) {
          benefits += `\u{1F381} ${welcomeBonus} token welcome bonus on first tip
`;
        }
        benefits += `
**Referrer Rewards:**
`;
        benefits += `\u{1F3C6} 1-week tax-free membership every ${rewardInterval} verified referrals
`;
        benefits += `\u{1F3C5} Achievement badges for referral milestones

`;
        benefits += `**Commands:**
`;
        benefits += `\`/pip_referral code\` - Get your referral code to share
`;
        benefits += `\`/pip_referral use CODE123\` - Use a friend's referral code
`;
        benefits += `\`/pip_referral stats\` - View your referral statistics`;
        return benefits;
      })(),
      inline: false
    }] : [],
    {
      name: "\u{1F4B8} Tipping Commands",
      value: '**Direct Tips**: `/pip_tip amount:10 user:@someone` - Send tokens to a specific user\n**Group Tips**: `/pip_tip amount:10` - Create a tip everyone can claim (leave user empty)\n**With Notes**: `/pip_tip amount:5 user:@friend note:"Great work!"` - Add a message\n\n\u{1F4A1} *Tip: The same command does both - just include or omit the user parameter!*',
      inline: false
    },
    {
      name: "\u{1F3AE} Gaming & Features",
      value: "**Challenge Players**: `/pip_game token:ABSTER amount:5` - Start a Penguin Ice Pebble match\n**View Profile**: `/pip_profile` - See your balance, stats, and recent activity\n**Detailed Stats**: `/pip_stats` - Comprehensive transaction history and analytics\n**Achievements**: `/pip_achievements` - View your unlocked achievements and progress\n**Leaderboards**: `/pip_leaderboard category:streaks` - See top players (streaks, wins, tips, etc.)\n**Withdraw Funds**: `/pip_withdraw` - Interactive withdrawal interface with your holdings and limits",
      inline: false
    },
    {
      name: "\u{1F52E} Prediction Markets (Website Only)",
      value: "**\u{1F310} All prediction markets are now available exclusively on the website!**\n\n**Regular Markets** (PIPChips):\n\u2022 Trade predictions on crypto prices, sports, and events\n\u2022 Real-time odds and parimutuel pools\n\u2022 Visit: `/pengubook/markets`\n\n**Tournament Markets** (TPIP):\n\u2022 Enter tournaments with multi-token payments (any Abstract token)\n\u2022 Receive TPIP (Tournament PIPChips) for tournament play\n\u2022 Compete for prizes with isolated tournament balances\n\u2022 TPIP resets to zero at tournament conclusion\n\n\u{1F4A1} *Visit PenguBook to browse active markets, enter tournaments, and start trading!*",
      inline: false
    },
    {
      name: "\u{1F4D6} PenguBook Social Features",
      value: '**Create Bio**: `/pip_bio set text:"Your bio here"` - Create your PenguBook profile\n**Browse Profiles**: `/pip_pengubook` - Discover other users and their bios\n**View Statistics**: Web dashboard shows detailed gaming, tipping, and financial stats\n**Transaction History**: Complete history of all tips, deposits, and withdrawals\n**\u{1F50D} Search Users**: Use the search feature to find specific Discord usernames safely\n**Send Messages**: Tip with notes through PenguBook - messages go to their inbox\n\n\u{1F6E1}\uFE0F *Safety: Always verify exact usernames to avoid impersonators!*',
      inline: false
    },
    {
      name: "\u{1F6E1}\uFE0F Server Administration",
      value: "**For Server Owners & Admins:**\n\u{1F4DD} **Apply for PIPTip**: `/pip_apply` or visit `/pengubook/apply` to get your server approved\n\u{1F310} **Web Dashboard**: Visit `/server` on PenguBook to manage your Discord server settings\n\u2699\uFE0F **Channel Controls**: Configure which channels allow tipping and gaming\n\u{1F4CA} **Activity Monitoring**: View server-wide PIPTip usage statistics\n\u{1F527} **Permission Management**: Fine-tune bot permissions and restrictions\n\n*Server approval required first, then Administrator or Manage Server permissions*",
      inline: false
    },
    {
      name: "\u2B50 Premium Features",
      value: "\u{1F539} **Tier Memberships**: Purchase premium tiers for reduced fees and special perks\n\u{1F539} **Tax-Free Tipping**: Premium members get lower or no fees on tips\n\u{1F539} **Exclusive Perks**: Priority support and special benefits\n\n*Check your profile for membership options!*",
      inline: false
    },
    {
      name: "\u{1F6E0}\uFE0F Quick Reference",
      value: "**Account Management**:\n`/pip_link` - Link your Abstract wallet\n`/pip_profile` - View balance and stats\n\n**Money & Tokens**:\n`/pip_deposit` - Add funds to your account\n`/pip_withdraw` - Interactive withdrawal interface\n`/pip_tip` - Send tips (direct or group)\n\n**Social & Gaming**:\n`/pip_bio` - Manage your PenguBook profile\n`/pip_pengubook` - Browse community profiles\n`/pip_game` - Challenge others to play\n`/pip_achievements` - View unlocked achievements\n`/pip_leaderboard` - See community leaderboards\n`/pip_stats` - Detailed transaction analytics\n" + (config.referralEnabled ? "`/pip_referral` - Referral system and rewards\n" : "") + "`/pip_help` - Show this guide",
      inline: false
    }
  ).setFooter({
    text: "\u{1F4A1} Pro tip: Most commands support autocomplete - just start typing!"
  }).setTimestamp();
  const webAccessRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setURL(`${process.env.PUBLIC_BASE_URL || "http://localhost:3000"}/pengubook`).setLabel("\u{1F310} Open PenguBook").setStyle(ButtonStyle.Link).setEmoji("\u{1F4BB}"),
    new ButtonBuilder().setURL(`${process.env.PUBLIC_BASE_URL || "http://localhost:3000"}/server`).setLabel("\u{1F6E1}\uFE0F Server Admin").setStyle(ButtonStyle.Link).setEmoji("\u2699\uFE0F"),
    new ButtonBuilder().setCustomId("pip:view_profile").setLabel("\u{1F464} Profile").setStyle(ButtonStyle.Primary).setEmoji("\u{1F4CA}")
  );
  await i.reply({
    embeds: [embed],
    components: [webAccessRow],
    ephemeral: true
  });
}
export {
  pipHelp as default
};
//# sourceMappingURL=pip_help.js.map
