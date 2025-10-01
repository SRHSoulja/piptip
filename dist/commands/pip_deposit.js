import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getTokenByAddress } from "../services/token.js";
import { TREASURY_AGW_ADDRESS } from "../config.js";
import { prisma } from "../services/db.js";
async function pipDeposit(i) {
  const tokenAddress = i.options.getString("token", true);
  const user = await prisma.user.findUnique({
    where: { discordId: i.user.id },
    select: { agwAddress: true }
  });
  if (!user?.agwAddress) {
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("\u{1F310} Get Abstract Wallet").setStyle(ButtonStyle.Link).setURL("https://abs.xyz"),
      new ButtonBuilder().setCustomId("pip:prompt_link_wallet").setLabel("\u{1F517} Link My Wallet").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("pip:show_help").setLabel("\u{1F4DA} Get Help").setStyle(ButtonStyle.Secondary)
    );
    return i.reply({
      content: [
        "\u274C **Wallet Not Linked**",
        "",
        "\u26A0\uFE0F **IMPORTANT**: You must link your wallet before depositing!",
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
        "\u{1F4A1} *Use the buttons below for quick actions!*"
      ].join("\n"),
      components: [actionRow],
      flags: 64
      // ephemeral
    });
  }
  const token = await getTokenByAddress(tokenAddress);
  if (!token) {
    return i.reply({ content: "Invalid or inactive token selected.", flags: 64 });
  }
  const warning = `\u26A0\uFE0F **Minimum deposit:** ${token.minDeposit} ${token.symbol} (deposits below this are ignored)`;
  await i.reply({
    content: [
      `\u2705 **Deposit Instructions for ${token.symbol}**`,
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
      "\u{1F4A1} *Only send from your linked wallet address shown above!*"
    ].join("\n"),
    flags: 64
    // ephemeral
  });
}
export {
  pipDeposit as default
};
//# sourceMappingURL=pip_deposit.js.map
