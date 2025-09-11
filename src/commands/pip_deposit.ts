import type { ChatInputCommandInteraction } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getTokenByAddress } from "../services/token.js";
import { TREASURY_AGW_ADDRESS } from "../config.js";
import { prisma } from "../services/db.js";

export default async function pipDeposit(i: ChatInputCommandInteraction) {
  const tokenAddress = i.options.getString("token", true);
  
  // CRITICAL: Check if user has linked wallet first
  const user = await prisma.user.findUnique({
    where: { discordId: i.user.id },
    select: { agwAddress: true }
  });

  if (!user?.agwAddress) {
    // Create action buttons for users without linked wallets
    const actionRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setLabel("🌐 Get Abstract Wallet")
          .setStyle(ButtonStyle.Link)
          .setURL("https://abs.xyz"),
        new ButtonBuilder()
          .setCustomId("pip:prompt_link_wallet")
          .setLabel("🔗 Link My Wallet")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("pip:show_help")
          .setLabel("📚 Get Help")
          .setStyle(ButtonStyle.Secondary)
      );

    return i.reply({
      content: [
        "❌ **Wallet Not Linked**",
        "",
        "⚠️ **IMPORTANT**: You must link your wallet before depositing!",
        "Without a linked wallet, your deposit **will be lost forever**.",
        "",
        "**Need an Abstract wallet?**",
        "Click the button below to get one free!",
        "",
        "**Already have a wallet?**",
        "Use the Link Wallet button for instructions.",
        "",
        "**Then you can safely deposit tokens.**",
        "",
        "💡 *Use the buttons below for quick actions!*"
      ].join("\n"),
      components: [actionRow],
      flags: 64 // ephemeral
    });
  }
  
  // Get token details
  const token = await getTokenByAddress(tokenAddress);
  if (!token) {
    return i.reply({ content: "Invalid or inactive token selected.", flags: 64 });
  }

  const warning = `⚠️ **Minimum deposit:** ${token.minDeposit} ${token.symbol} (deposits below this are ignored)`;

  await i.reply({
    content: [
      `✅ **Deposit Instructions for ${token.symbol}**`,
      "",
      `Send **${token.symbol}** tokens from your linked wallet to the Treasury.`,
      "Your balance will be credited automatically after blockchain confirmation.",
      "",
      `**Treasury Address:** \`${TREASURY_AGW_ADDRESS}\``,
      `**Token Contract:** \`${token.address}\``,
      `**Your Linked Wallet:** \`${user.agwAddress}\``,
      "",
      warning,
      "",
      "💡 *Only send from your linked wallet address shown above!*"
    ].join("\n"),
    flags: 64 // ephemeral
  });
}