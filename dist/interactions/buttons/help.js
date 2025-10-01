async function handleShowHelp(i) {
  await i.deferReply({ ephemeral: true }).catch(() => {
  });
  try {
    const { EmbedBuilder } = await import("discord.js");
    const embed = new EmbedBuilder().setTitle("\u{1F427}\u{1F9CA}\u{1FAA8} PIPTip Bot Help").setDescription("**Welcome to PIPTip!** Your Discord bot for tipping Abstract Chain tokens (Penguin, Ice, Pebble)").setColor(5793266).addFields(
      {
        name: "\u{1F680} Getting Started",
        value: "1\uFE0F\u20E3 **View Profile**: `/pip_profile` - View your balance and account details (auto-creates account)\n2\uFE0F\u20E3 **Get Wallet**: Visit **abs.xyz** to create a free Abstract wallet\n3\uFE0F\u20E3 **Link Wallet**: `/pip_link address:0x...` - Connect your wallet for deposits\n4\uFE0F\u20E3 **Add Funds**: `/pip_deposit token:PENGUIN` - Get deposit instructions\n5\uFE0F\u20E3 **Start Playing**: `/pip_tip amount:10 user:@friend` - Send tips or `/pip_game` to challenge friends!",
        inline: false
      },
      {
        name: "\u{1F4B8} Tipping Commands",
        value: '**Direct Tips**: `/pip_tip amount:10 user:@someone` - Send tokens to a specific user\n**Group Tips**: `/pip_tip amount:10` - Create a tip everyone can claim (leave user empty)\n**With Notes**: `/pip_tip amount:5 user:@friend note:"Great work!"` - Add a message\n\n\u{1F4A1} *Tip: The same command does both - just include or omit the user parameter!*',
        inline: false
      },
      {
        name: "\u{1F3AE} Gaming & Features",
        value: "**Challenge Players**: `/pip_game token:PENGUIN amount:5` - Start a Penguin Ice Pebble match\n**View Profile**: `/pip_profile` - See your balance, stats, and recent activity\n**Detailed Statistics**: Web dashboard with comprehensive gaming and financial stats\n**Transaction History**: Complete history of all your tips, deposits, and withdrawals\n**Withdraw Funds**: `/pip_withdraw token:PENGUIN amount:10` - Send tokens to your wallet",
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
        value: "**Account Management**:\n`/pip_link` - Link your Abstract wallet\n`/pip_profile` - View balance and stats\n\n**Money & Tokens**:\n`/pip_deposit` - Add funds to your account\n`/pip_withdraw` - Send tokens to your wallet\n`/pip_tip` - Send tips (direct or group)\n\n**Gaming & Help**:\n`/pip_game` - Challenge others to play\n`/pip_help` - Show this guide",
        inline: false
      }
    ).setFooter({
      text: "\u{1F4A1} Pro tip: Most commands support autocomplete - just start typing!"
    }).setTimestamp();
    await i.editReply({
      embeds: [embed]
    });
  } catch (error) {
    console.error("Show help error:", error);
    await i.editReply({
      content: `\u274C **Error showing help**
${error?.message || String(error)}`
    });
  }
}
export {
  handleShowHelp
};
//# sourceMappingURL=help.js.map
