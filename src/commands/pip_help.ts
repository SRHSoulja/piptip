// src/commands/pip_help.ts - Bot usage guide and help
import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";

export default async function pipHelp(i: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle("🐧🧊🪨 PIPTip Bot Help")
    .setDescription("**Welcome to PIPTip!** Your Discord bot for tipping Abstract Chain tokens (Penguin, Ice, Pebble)")
    .setColor(0x5865F2)
    .addFields(
      {
        name: "🚀 Getting Started",
        value: 
          "1️⃣ **Create Profile**: `/pip_register` - Create your PIPTip account\n" +
          "2️⃣ **Link Wallet**: `/pip_link address:0x...` - Connect your wallet for deposits\n" +
          "3️⃣ **Add Funds**: `/pip_deposit token:PENGUIN` - Get deposit instructions\n" +
          "4️⃣ **Start Tipping**: `/pip_tip amount:10 user:@friend` - Send your first tip!",
        inline: false
      },
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
        name: "🎮 Gaming & Fun",
        value:
          "**Start Match**: `/pip_start token:PENGUIN amount:5` - Challenge others to Penguin Ice Pebble\n" +
          "**View Profile**: `/pip_profile` - See your balance, stats, and recent activity\n" +
          "**Withdraw**: `/pip_withdraw token:PENGUIN amount:10` - Send tokens to your wallet",
        inline: false
      },
      {
        name: "⭐ Premium Features",
        value:
          "🔹 **Tier Memberships**: Purchase premium tiers for reduced fees and special perks\n" +
          "🔹 **Tax-Free Tipping**: Premium members get lower or no fees on tips\n" +
          "🔹 **Enhanced Stats**: Detailed analytics and activity tracking\n\n" +
          "*Check your profile for membership options!*",
        inline: false
      },
      {
        name: "🛠️ Quick Reference",
        value:
          "**Essential Commands**:\n" +
          "`/pip_register` - Create account\n" +
          "`/pip_profile` - View your stats\n" +
          "`/pip_tip` - Send tips (direct or group)\n" +
          "`/pip_deposit` - Add funds\n" +
          "`/pip_withdraw` - Get your tokens\n" +
          "`/pip_help` - Show this help",
        inline: false
      }
    )
    .setFooter({ 
      text: "💡 Pro tip: Most commands support autocomplete - just start typing!" 
    })
    .setTimestamp();

  await i.reply({
    embeds: [embed],
    ephemeral: true
  });
}