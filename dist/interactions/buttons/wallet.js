import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { prisma } from "../../services/db.js";
async function handlePromptLinkWallet(i) {
  await i.deferReply({ ephemeral: true }).catch(() => {
  });
  try {
    await i.editReply({
      content: [
        "\u{1F517} **Link Your Abstract Wallet**",
        "",
        "To link your wallet, use the following command:",
        "`/pip_link address:0x...`",
        "",
        "**Don't have an Abstract wallet yet?**",
        "\u{1F310} Get one free at **abs.xyz**",
        "",
        "**Your wallet address should:**",
        "\u2022 Start with `0x`",
        "\u2022 Be 42 characters long",
        "\u2022 Be from the Abstract blockchain",
        "",
        "\u{1F4A1} *Once linked, you can deposit and withdraw tokens!*"
      ].join("\n")
    });
  } catch (error) {
    console.error("Prompt link wallet error:", error);
    await i.editReply({
      content: `\u274C **Error**
${error?.message || String(error)}`
    });
  }
}
async function handleLinkWalletModal(i) {
  try {
    const modal = new ModalBuilder().setCustomId("pip:link_wallet_submit").setTitle("\u{1F517} Link Your Abstract Wallet");
    const addressInput = new TextInputBuilder().setCustomId("wallet_address").setLabel("Enter your Abstract wallet address").setStyle(TextInputStyle.Short).setPlaceholder("0x...").setRequired(true).setMinLength(42).setMaxLength(42);
    const actionRow = new ActionRowBuilder().addComponents(addressInput);
    modal.addComponents(actionRow);
    await i.showModal(modal);
  } catch (error) {
    console.error("Link wallet modal error:", error);
    await i.reply({
      content: `\u274C **Error showing modal**
${error?.message || String(error)}`,
      flags: 64
    }).catch(() => {
    });
  }
}
async function handleLinkWalletSubmit(i) {
  await i.deferReply({ flags: 64 }).catch(() => {
  });
  try {
    const rawAddr = i.fields.getTextInputValue("wallet_address");
    if (!rawAddr || typeof rawAddr !== "string") {
      return i.editReply({ content: "Invalid address format." });
    }
    const addr = rawAddr.trim().toLowerCase();
    const isAddress = (s) => /^0x[a-fA-F0-9]{40}$/.test(s);
    if (!isAddress(addr)) {
      return i.editReply({
        content: [
          "\u274C **Invalid wallet address format**",
          "",
          "Please provide a valid Abstract wallet address (starts with 0x).",
          "",
          "**Don't have an Abstract wallet?**",
          "Get one free at **abs.xyz**"
        ].join("\n")
      });
    }
    const taken = await prisma.user.findFirst({
      where: { agwAddress: addr, discordId: { not: i.user.id } }
    });
    if (taken) {
      return i.editReply({ content: "That wallet is already linked to another user." });
    }
    await prisma.user.upsert({
      where: { discordId: i.user.id },
      update: { agwAddress: addr },
      create: { discordId: i.user.id, agwAddress: addr }
    });
    await i.editReply({
      content: [
        `\u2705 **Wallet Successfully Linked!**`,
        "",
        `\u{1F517} **Address:** \`${addr}\``,
        "",
        "**What's next?**",
        "\u2022 Use `/pip_profile` to view your wallet and balances",
        "\u2022 Use deposit instructions to add tokens",
        "\u2022 Start tipping and gaming with your tokens!"
      ].join("\n")
    });
  } catch (error) {
    console.error("Link wallet submit error:", error);
    await i.editReply({
      content: `\u274C **Error linking wallet**
${error?.message || String(error)}`
    });
  }
}
export {
  handleLinkWalletModal,
  handleLinkWalletSubmit,
  handlePromptLinkWallet
};
//# sourceMappingURL=wallet.js.map
