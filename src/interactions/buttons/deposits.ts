// src/interactions/buttons/deposits.ts - Deposit flow interactions
import type { ButtonInteraction } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../../services/db.js";

/** Handle show deposit instructions button */
export async function handleShowDepositInstructions(i: ButtonInteraction) {
  await i.deferReply({ ephemeral: true }).catch(() => {});
  
  try {
    // Check if user has linked wallet
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
      select: { agwAddress: true }
    });

    if (!user?.agwAddress) {
      return i.editReply({
        content: [
          "❌ **Wallet Not Linked**",
          "",
          "You need to link your wallet before getting deposit instructions.",
          "",
          "**Get an Abstract wallet:** https://abs.xyz",
          "**Then link it:** `/pip_link address:0x...`"
        ].join("\n")
      });
    }

    // Import and get available tokens
    const { getActiveTokens } = await import("../../services/token.js");
    const tokens = await getActiveTokens();
    
    if (tokens.length === 0) {
      return i.editReply({
        content: "❌ No active tokens available for deposit."
      });
    }

    // Create token selection buttons
    const tokenButtons: ButtonBuilder[] = [];
    const maxButtons = Math.min(tokens.length, 15); // Discord limit
    
    for (let idx = 0; idx < maxButtons; idx++) {
      const token = tokens[idx];
      tokenButtons.push(
        new ButtonBuilder()
          .setCustomId(`pip:deposit_token:${token.id}`)
          .setLabel(`${token.symbol}`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji("💰")
      );
    }

    // Organize buttons into rows (max 5 per row)
    const actionRows = [];
    for (let i = 0; i < tokenButtons.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(tokenButtons.slice(i, i + 5));
      actionRows.push(row);
    }

    // Add cancel button
    const cancelRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("pip:cancel_deposit")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("❌")
      );
    actionRows.push(cancelRow);

    await i.editReply({
      content: [
        "💰 **Select Token for Deposit Instructions**",
        "",
        `🔗 **Your Linked Wallet:** \`${user.agwAddress}\``,
        "",
        "Choose which token you want to deposit:",
        "",
        "💡 *Instructions will show treasury address and minimum amounts*"
      ].join("\n"),
      components: actionRows
    });

  } catch (error: any) {
    console.error("Show deposit instructions error:", error);
    await i.editReply({
      content: `❌ **Error showing deposit instructions**\n${error?.message || String(error)}`
    });
  }
}

/** Handle deposit token selection */
export async function handleDepositToken(i: ButtonInteraction, parts: string[]) {
  await i.deferUpdate().catch(() => {});
  
  try {
    const tokenId = parseInt(parts[2]);
    
    // Get token and user details
    const [token, user] = await Promise.all([
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: { agwAddress: true }
      })
    ]);

    if (!token) {
      return i.editReply({
        content: "❌ **Token not found**\nThe selected token is no longer available.",
        components: []
      });
    }

    if (!user?.agwAddress) {
      return i.editReply({
        content: "❌ **Wallet not linked**\nPlease link your wallet first.",
        components: []
      });
    }

    const { TREASURY_AGW_ADDRESS } = await import("../../config.js");
    
    // Create back button
    const backButton = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("pip:show_deposit_instructions")
          .setLabel("⬅️ Back to Token Selection")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("pip:view_profile")
          .setLabel("👤 View Profile")
          .setStyle(ButtonStyle.Secondary)
      );

    await i.editReply({
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
        `⚠️ **Minimum deposit:** ${token.minDeposit} ${token.symbol} (deposits below this are ignored)`,
        "",
        "💡 *Only send from your linked wallet address shown above!*"
      ].join("\n"),
      components: [backButton]
    });

  } catch (error: any) {
    console.error("Deposit token selection error:", error);
    await i.editReply({
      content: `❌ **Error**\n${error?.message || String(error)}`,
      components: []
    });
  }
}

/** Handle cancel deposit */
export async function handleCancelDeposit(i: ButtonInteraction) {
  await i.deferUpdate().catch(() => {});
  
  try {
    await i.editReply({
      content: "❌ **Deposit cancelled**\n*Use `/pip_deposit` or the Add Funds button to try again.*",
      components: []
    });
  } catch (error: any) {
    console.error("Cancel deposit error:", error);
  }
}