// src/interactions/buttons/wallet.ts - Wallet linking interactions
import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { prisma } from "../../services/db.js";

/** Handle prompt link wallet button - shows instructions */
export async function handlePromptLinkWallet(i: ButtonInteraction) {
  await i.deferReply({ ephemeral: true }).catch(() => {});
  
  try {
    await i.editReply({
      content: [
        "🔗 **Link Your Abstract Wallet**",
        "",
        "To link your wallet, use the following command:",
        "`/pip_link address:0x...`",
        "",
        "**Don't have an Abstract wallet yet?**",
        "🌐 Get one free at **abs.xyz**",
        "",
        "**Your wallet address should:**",
        "• Start with `0x`",
        "• Be 42 characters long",
        "• Be from the Abstract blockchain",
        "",
        "💡 *Once linked, you can deposit and withdraw tokens!*"
      ].join("\n")
    });

  } catch (error: any) {
    console.error("Prompt link wallet error:", error);
    await i.editReply({
      content: `❌ **Error**\n${error?.message || String(error)}`
    });
  }
}

/** Handle link wallet modal button - shows the modal */
export async function handleLinkWalletModal(i: ButtonInteraction) {
  try {
    const modal = new ModalBuilder()
      .setCustomId("pip:link_wallet_submit")
      .setTitle("🔗 Link Your Abstract Wallet");

    const addressInput = new TextInputBuilder()
      .setCustomId("wallet_address")
      .setLabel("Enter your Abstract wallet address")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("0x...")
      .setRequired(true)
      .setMinLength(42)
      .setMaxLength(42);

    const actionRow = new ActionRowBuilder<TextInputBuilder>()
      .addComponents(addressInput);

    modal.addComponents(actionRow);

    await i.showModal(modal);

  } catch (error: any) {
    console.error("Link wallet modal error:", error);
    await i.reply({ 
      content: `❌ **Error showing modal**\n${error?.message || String(error)}`, 
      flags: 64 
    }).catch(() => {});
  }
}

/** Handle link wallet modal submission */
export async function handleLinkWalletSubmit(i: ModalSubmitInteraction) {
  await i.deferReply({ flags: 64 }).catch(() => {});
  
  try {
    const rawAddr = i.fields.getTextInputValue("wallet_address");
    if (!rawAddr || typeof rawAddr !== "string") {
      return i.editReply({ content: "Invalid address format." });
    }
    
    const addr = rawAddr.trim().toLowerCase();
    const isAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
    
    if (!isAddress(addr)) {
      return i.editReply({
        content: [
          "❌ **Invalid wallet address format**",
          "",
          "Please provide a valid Abstract wallet address (starts with 0x).",
          "",
          "**Don't have an Abstract wallet?**",
          "Get one free at **abs.xyz**"
        ].join("\n")
      });
    }

    // Prevent sharing the same wallet
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
        `✅ **Wallet Successfully Linked!**`,
        "",
        `🔗 **Address:** \`${addr}\``,
        "",
        "**What's next?**",
        "• Use `/pip_profile` to view your wallet and balances",
        "• Use deposit instructions to add tokens",
        "• Start tipping and gaming with your tokens!"
      ].join("\n")
    });

  } catch (error: any) {
    console.error("Link wallet submit error:", error);
    await i.editReply({
      content: `❌ **Error linking wallet**\n${error?.message || String(error)}`
    });
  }
}