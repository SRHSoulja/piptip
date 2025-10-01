import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../../services/db.js";
async function handleShowDepositInstructions(i) {
  await i.deferReply({ ephemeral: true }).catch(() => {
  });
  try {
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
      select: { agwAddress: true }
    });
    if (!user?.agwAddress) {
      return i.editReply({
        content: [
          "\u274C **Wallet Not Linked**",
          "",
          "You need to link your wallet before getting deposit instructions.",
          "",
          "**Get an Abstract wallet:** https://abs.xyz",
          "**Then link it:** `/pip_link address:0x...`"
        ].join("\n")
      });
    }
    const { getActiveTokens } = await import("../../services/token.js");
    const tokens = await getActiveTokens();
    if (tokens.length === 0) {
      return i.editReply({
        content: "\u274C No active tokens available for deposit."
      });
    }
    const tokenButtons = [];
    const maxButtons = Math.min(tokens.length, 15);
    for (let idx = 0; idx < maxButtons; idx++) {
      const token = tokens[idx];
      tokenButtons.push(
        new ButtonBuilder().setCustomId(`pip:deposit_token:${token.id}`).setLabel(`${token.symbol}`).setStyle(ButtonStyle.Primary).setEmoji("\u{1F4B0}")
      );
    }
    const actionRows = [];
    for (let i2 = 0; i2 < tokenButtons.length; i2 += 5) {
      const row = new ActionRowBuilder().addComponents(tokenButtons.slice(i2, i2 + 5));
      actionRows.push(row);
    }
    const cancelRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pip:cancel_deposit").setLabel("Cancel").setStyle(ButtonStyle.Secondary).setEmoji("\u274C")
    );
    actionRows.push(cancelRow);
    await i.editReply({
      content: [
        "\u{1F4B0} **Select Token for Deposit Instructions**",
        "",
        `\u{1F517} **Your Linked Wallet:** \`${user.agwAddress}\``,
        "",
        "Choose which token you want to deposit:",
        "",
        "\u{1F4A1} *Instructions will show treasury address and minimum amounts*"
      ].join("\n"),
      components: actionRows
    });
  } catch (error) {
    console.error("Show deposit instructions error:", error);
    await i.editReply({
      content: `\u274C **Error showing deposit instructions**
${error?.message || String(error)}`
    });
  }
}
async function handleDepositToken(i, parts) {
  await i.deferUpdate().catch(() => {
  });
  try {
    const tokenId = parseInt(parts[2]);
    const [token, user] = await Promise.all([
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: { agwAddress: true }
      })
    ]);
    if (!token) {
      return i.editReply({
        content: "\u274C **Token not found**\nThe selected token is no longer available.",
        components: []
      });
    }
    if (!user?.agwAddress) {
      return i.editReply({
        content: "\u274C **Wallet not linked**\nPlease link your wallet first.",
        components: []
      });
    }
    const { TREASURY_AGW_ADDRESS } = await import("../../config.js");
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pip:show_deposit_instructions").setLabel("\u2B05\uFE0F Back to Token Selection").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pip:view_profile").setLabel("\u{1F464} View Profile").setStyle(ButtonStyle.Secondary)
    );
    await i.editReply({
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
        `\u26A0\uFE0F **Minimum deposit:** ${token.minDeposit} ${token.symbol} (deposits below this are ignored)`,
        "",
        "\u{1F4A1} *Only send from your linked wallet address shown above!*"
      ].join("\n"),
      components: [backButton]
    });
  } catch (error) {
    console.error("Deposit token selection error:", error);
    await i.editReply({
      content: `\u274C **Error**
${error?.message || String(error)}`,
      components: []
    });
  }
}
async function handleCancelDeposit(i) {
  await i.deferUpdate().catch(() => {
  });
  try {
    await i.editReply({
      content: "\u274C **Deposit cancelled**\n*Use `/pip_deposit` or the Add Funds button to try again.*",
      components: []
    });
  } catch (error) {
    console.error("Cancel deposit error:", error);
  }
}
export {
  handleCancelDeposit,
  handleDepositToken,
  handleShowDepositInstructions
};
//# sourceMappingURL=deposits.js.map
