// src/interactions/buttons/tips.ts
import type { ButtonInteraction } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { prisma } from "../../services/db.js";
import { getConfig } from "../../config.js";
import { formatDecimal } from "../../services/token.js";

/** Handle tip token selection */
export async function handleSelectToken(i: ButtonInteraction, parts: string[]) {
  await i.deferUpdate().catch(() => {});
  
  try {
    // Parse button data: pip:select_token:amount:tipType:target:note:tokenId
    const [, , amount, tipType, target, encodedNote, tokenId] = parts;
    const note = decodeURIComponent(encodedNote);
    
    if (tipType === "direct") {
      // Direct tip - go straight to confirmation
      return showTipConfirmation(i, {
        amount: Number(amount),
        tipType: "direct",
        targetUserId: target,
        note,
        tokenId: Number(tokenId)
      });
    } else {
      // Group tip - show duration selection first
      return showDurationSelection(i, {
        amount: Number(amount),
        note,
        tokenId: Number(tokenId)
      });
    }
  } catch (error: any) {
    console.error("Token selection error:", error);
    await i.editReply({
      content: `❌ **Failed to process token selection**\n${error?.message || String(error)}`,
      embeds: [],
      components: []
    });
  }
}

/** Handle tip cancellation */
export async function handleCancelTip(i: ButtonInteraction) {
  await i.deferUpdate().catch(() => {});
  
  await i.editReply({
    content: "❌ **Tip cancelled**\n*Use `/pip_tip` to start a new tip.*",
    embeds: [],
    components: []
  });
}

/** Handle group tip duration selection */
export async function handleSelectDuration(i: ButtonInteraction, parts: string[]) {
  await i.deferUpdate().catch(() => {});
  
  try {
    // Parse: pip:select_duration:amount:note:tokenId:duration
    const [, , amount, encodedNote, tokenId, duration] = parts;
    const note = decodeURIComponent(encodedNote);
    
    return showTipConfirmation(i, {
      amount: Number(amount),
      tipType: "group", 
      note,
      tokenId: Number(tokenId),
      duration: Number(duration)
    });
  } catch (error: any) {
    console.error("Duration selection error:", error);
    await i.editReply({
      content: `❌ **Failed to process duration selection**\n${error?.message || String(error)}`,
      embeds: [],
      components: []
    });
  }
}

/** Handle final tip confirmation */
export async function handleConfirmTip(i: ButtonInteraction, parts: string[]) {
  await i.deferUpdate().catch(() => {});

  try {
    // Parse: pip:confirm_tip:amount:tipType:target:note:tokenId:duration?
    const [, , amount, tipType, target, encodedNote, tokenId, duration] = parts;
    const note = decodeURIComponent(encodedNote);
    
    // Import the original tip logic
    const { processTip } = await import("../../services/tip_processor.js");
    
    const tipData = {
      amount: Number(amount),
      tipType,
      targetUserId: target !== "group" ? target : undefined,
      note,
      tokenId: Number(tokenId),
      duration: duration ? Number(duration) : undefined,
      userId: i.user.id,
      guildId: i.guildId,
      channelId: i.channelId
    };

    // Optimistic UI update - show immediate processing feedback
    await i.editReply({
      content: `🐧 Processing your ${tipType} tip... This may take a moment! ⚡`,
      embeds: [],
      components: []
    });

    const result = await processTip(tipData, i.client);

    const statusEmoji = result.success ? "✅" : "❌";
    await i.editReply({
      content: `${statusEmoji} **${result.message}**\n${result.details || ""}`,
      embeds: [],
      components: []
    });
    
    // Post public message if successful
    if (result.success && result.publicMessage && i.channel?.isTextBased() && "send" in i.channel) {
      await (i.channel as any).send(result.publicMessage).catch(() => {});
    }
    
  } catch (error: any) {
    console.error("Tip confirmation error:", error);
    await i.editReply({
      content: `❌ **Tip failed**\n${error?.message || String(error)}\n\n*You can try again with a new tip command.*`,
      embeds: [],
      components: []
    });
  }
}

/** Show duration selection for group tips */
export async function showDurationSelection(i: ButtonInteraction, data: { amount: number; note: string; tokenId: number }) {

  const { getActiveTokens } = await import("../../services/token.js");
  const tokens = await getActiveTokens();
  const token = tokens.find(t => t.id === data.tokenId);

  if (!token) {
    return i.editReply({
      content: "❌ **Token not found**\nThe selected token is no longer available.",
      embeds: [],
      components: []
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("⏰ Choose Group Tip Duration")
    .setDescription(
      `**Amount:** ${data.amount} ${token.symbol}\n` +
      `**Type:** Group Tip\n` +
      (data.note ? `**Note:** ${data.note}\n` : "") +
      `\n🎉 **Select how long people can claim this tip:**\n` +
      `💡 *Choose from quick options (top row) or extended durations (bottom row)*`
    )
    .setColor(0xFFD700)
    .setFooter({ text: "Everyone in the channel can claim until it expires" })
    .setTimestamp();

  const durationButtons = [
    { label: "1 min", value: 1, emoji: "⚡" },
    { label: "3 min", value: 3, emoji: "💨" },
    { label: "5 min", value: 5, emoji: "🔥" },
    { label: "10 min", value: 10, emoji: "⏰" },
    { label: "15 min", value: 15, emoji: "🕐" }
  ].map(d =>
    new ButtonBuilder()
      .setCustomId(`pip:select_duration:${data.amount}:${encodeURIComponent(data.note)}:${data.tokenId}:${d.value}`)
      .setLabel(d.label)
      .setStyle(ButtonStyle.Primary)
      .setEmoji(d.emoji)
  );

  const extendedDurationButtons = [
    { label: "30 min", value: 30, emoji: "🕕" },
    { label: "1 hour", value: 60, emoji: "🕒" },
    { label: "2 hours", value: 120, emoji: "🕓" },
    { label: "6 hours", value: 360, emoji: "🕕" },
    { label: "24 hours", value: 1440, emoji: "📅" }
  ].map(d =>
    new ButtonBuilder()
      .setCustomId(`pip:select_duration:${data.amount}:${encodeURIComponent(data.note)}:${data.tokenId}:${d.value}`)
      .setLabel(d.label)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(d.emoji)
  );

  const actionRow1 = new ActionRowBuilder<ButtonBuilder>().addComponents(durationButtons);
  const actionRow2 = new ActionRowBuilder<ButtonBuilder>().addComponents(extendedDurationButtons);

  
  const cancelRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("pip:cancel_tip")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❌")
    );


  await i.editReply({
    embeds: [embed],
    components: [actionRow1, actionRow2, cancelRow]
  });

}

/** Show final confirmation screen */
export async function showTipConfirmation(i: ButtonInteraction, data: {
  amount: number;
  tipType: string;
  targetUserId?: string;
  note: string;
  tokenId: number;
  duration?: number;
}) {
  // Ensure interaction is acknowledged (defensive programming)
  if (!i.deferred && !i.replied) {
    await i.deferUpdate().catch(() => {});
  }

  const { getActiveTokens } = await import("../../services/token.js");
  const { userHasActiveTaxFreeTier } = await import("../../services/tiers.js");

  const tokens = await getActiveTokens();
  const token = tokens.find(t => t.id === data.tokenId);

  if (!token) {
    return i.editReply({
      content: "❌ **Token not found**\nThe selected token is no longer available.",
      embeds: [],
      components: []
    });
  }

  // Calculate fees
  const cfg = await getConfig();
  const fromUser = await prisma.user.findUnique({ where: { discordId: i.user.id } });
  const taxFree = fromUser ? await userHasActiveTaxFreeTier(fromUser.id) : false;
  const feeBpsNum = taxFree ? 0 : (token.tipFeeBps ?? cfg?.tipFeeBps ?? 100);
  const feePercent = feeBpsNum / 100;
  const feeAmount = data.amount * feePercent / 100;
  const totalCost = data.amount + feeAmount;

  const tipEmoji = data.tipType === "direct" ? "💸" : "🎉";
  const embed = new EmbedBuilder()
    .setTitle(`${tipEmoji} Confirm Your Tip`)
    .setDescription(
      `**Type:** ${data.tipType === "direct" ? "Direct Tip" : "Group Tip"}\n` +
      `**Amount:** ${data.amount} ${token.symbol}\n` +
      `**Fee:** ${feeAmount.toFixed(8)} ${token.symbol} ${taxFree ? "(Tax-free tier)" : `(${feePercent}%)`}\n` +
      `**Total Cost:** ${totalCost.toFixed(8)} ${token.symbol}\n` +
      (data.tipType === "direct" && data.targetUserId ? `**Recipient:** <@${data.targetUserId}>\n` : "") +
      (data.tipType === "group" && data.duration ?
        `**Duration:** ${data.duration >= 60 ?
          `${(data.duration / 60).toFixed(data.duration % 60 === 0 ? 0 : 1)} ${data.duration >= 60 ? 'hour' + (data.duration === 60 ? '' : 's') : 'minutes'}` :
          `${data.duration} minute${data.duration === 1 ? '' : 's'}`}\n` : "") +
      (data.note ? `**Note:** ${data.note}\n` : "") +
      `\n${data.tipType === "direct" ? "💰 Send tip directly to user" : "🎉 Create group tip for everyone"}`
    )
    .setColor(data.tipType === "direct" ? 0x00FF00 : 0xFFD700)
    .setFooter({ text: "Click confirm to process the tip" })
    .setTimestamp();

  const confirmButton = new ButtonBuilder()
    .setCustomId(`pip:confirm_tip:${data.amount}:${data.tipType}:${data.targetUserId || "group"}:${encodeURIComponent(data.note)}:${data.tokenId}:${data.duration || ""}`)
    .setLabel(`Confirm ${data.tipType === "direct" ? "Direct" : "Group"} Tip`)
    .setStyle(ButtonStyle.Success)
    .setEmoji("✅");

  const cancelButton = new ButtonBuilder()
    .setCustomId("pip:cancel_tip")
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("❌");

  const actionRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(confirmButton, cancelButton);

  await i.editReply({
    embeds: [embed],
    components: [actionRow]
  });
}