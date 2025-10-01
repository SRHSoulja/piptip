import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { prisma } from "../../services/db.js";
import { getConfig } from "../../config.js";
async function handleSelectToken(i, parts) {
  await i.deferUpdate().catch(() => {
  });
  try {
    const [, , amount, tipType, target, encodedNote, tokenId] = parts;
    const note = decodeURIComponent(encodedNote);
    if (tipType === "direct") {
      return showTipConfirmation(i, {
        amount: Number(amount),
        tipType: "direct",
        targetUserId: target,
        note,
        tokenId: Number(tokenId)
      });
    } else {
      return showDurationSelection(i, {
        amount: Number(amount),
        note,
        tokenId: Number(tokenId)
      });
    }
  } catch (error) {
    console.error("Token selection error:", error);
    await i.editReply({
      content: `\u274C **Failed to process token selection**
${error?.message || String(error)}`,
      embeds: [],
      components: []
    });
  }
}
async function handleCancelTip(i) {
  await i.deferUpdate().catch(() => {
  });
  await i.editReply({
    content: "\u274C **Tip cancelled**\n*Use `/pip_tip` to start a new tip.*",
    embeds: [],
    components: []
  });
}
async function handleSelectDuration(i, parts) {
  await i.deferUpdate().catch(() => {
  });
  try {
    const [, , amount, encodedNote, tokenId, duration] = parts;
    const note = decodeURIComponent(encodedNote);
    return showTipConfirmation(i, {
      amount: Number(amount),
      tipType: "group",
      note,
      tokenId: Number(tokenId),
      duration: Number(duration)
    });
  } catch (error) {
    console.error("Duration selection error:", error);
    await i.editReply({
      content: `\u274C **Failed to process duration selection**
${error?.message || String(error)}`,
      embeds: [],
      components: []
    });
  }
}
async function handleConfirmTip(i, parts) {
  await i.deferUpdate().catch(() => {
  });
  try {
    const [, , amount, tipType, target, encodedNote, tokenId, duration] = parts;
    const note = decodeURIComponent(encodedNote);
    const { processTip } = await import("../../services/tip_processor.js");
    const tipData = {
      amount: Number(amount),
      tipType,
      targetUserId: target !== "group" ? target : void 0,
      note,
      tokenId: Number(tokenId),
      duration: duration ? Number(duration) : void 0,
      userId: i.user.id,
      guildId: i.guildId,
      channelId: i.channelId
    };
    await i.editReply({
      content: `\u{1F427} Processing your ${tipType} tip... This may take a moment! \u26A1`,
      embeds: [],
      components: []
    });
    const result = await processTip(tipData, i.client);
    const statusEmoji = result.success ? "\u2705" : "\u274C";
    await i.editReply({
      content: `${statusEmoji} **${result.message}**
${result.details || ""}`,
      embeds: [],
      components: []
    });
    if (result.success && result.publicMessage && i.channel?.isTextBased() && "send" in i.channel) {
      await i.channel.send(result.publicMessage).catch(() => {
      });
    }
  } catch (error) {
    console.error("Tip confirmation error:", error);
    await i.editReply({
      content: `\u274C **Tip failed**
${error?.message || String(error)}

*You can try again with a new tip command.*`,
      embeds: [],
      components: []
    });
  }
}
async function showDurationSelection(i, data) {
  const { getActiveTokens } = await import("../../services/token.js");
  const tokens = await getActiveTokens();
  const token = tokens.find((t) => t.id === data.tokenId);
  if (!token) {
    return i.editReply({
      content: "\u274C **Token not found**\nThe selected token is no longer available.",
      embeds: [],
      components: []
    });
  }
  const embed = new EmbedBuilder().setTitle("\u23F0 Choose Group Tip Duration").setDescription(
    `**Amount:** ${data.amount} ${token.symbol}
**Type:** Group Tip
` + (data.note ? `**Note:** ${data.note}
` : "") + `
\u{1F389} **Select how long people can claim this tip:**
\u{1F4A1} *Choose from quick options (top row) or extended durations (bottom row)*`
  ).setColor(16766720).setFooter({ text: "Everyone in the channel can claim until it expires" }).setTimestamp();
  const durationButtons = [
    { label: "1 min", value: 1, emoji: "\u26A1" },
    { label: "3 min", value: 3, emoji: "\u{1F4A8}" },
    { label: "5 min", value: 5, emoji: "\u{1F525}" },
    { label: "10 min", value: 10, emoji: "\u23F0" },
    { label: "15 min", value: 15, emoji: "\u{1F550}" }
  ].map(
    (d) => new ButtonBuilder().setCustomId(`pip:select_duration:${data.amount}:${encodeURIComponent(data.note)}:${data.tokenId}:${d.value}`).setLabel(d.label).setStyle(ButtonStyle.Primary).setEmoji(d.emoji)
  );
  const extendedDurationButtons = [
    { label: "30 min", value: 30, emoji: "\u{1F555}" },
    { label: "1 hour", value: 60, emoji: "\u{1F552}" },
    { label: "2 hours", value: 120, emoji: "\u{1F553}" },
    { label: "6 hours", value: 360, emoji: "\u{1F555}" },
    { label: "24 hours", value: 1440, emoji: "\u{1F4C5}" }
  ].map(
    (d) => new ButtonBuilder().setCustomId(`pip:select_duration:${data.amount}:${encodeURIComponent(data.note)}:${data.tokenId}:${d.value}`).setLabel(d.label).setStyle(ButtonStyle.Secondary).setEmoji(d.emoji)
  );
  const actionRow1 = new ActionRowBuilder().addComponents(durationButtons);
  const actionRow2 = new ActionRowBuilder().addComponents(extendedDurationButtons);
  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pip:cancel_tip").setLabel("Cancel").setStyle(ButtonStyle.Secondary).setEmoji("\u274C")
  );
  await i.editReply({
    embeds: [embed],
    components: [actionRow1, actionRow2, cancelRow]
  });
}
async function showTipConfirmation(i, data) {
  if (!i.deferred && !i.replied) {
    await i.deferUpdate().catch(() => {
    });
  }
  const { getActiveTokens } = await import("../../services/token.js");
  const { userHasActiveTaxFreeTier } = await import("../../services/tiers.js");
  const tokens = await getActiveTokens();
  const token = tokens.find((t) => t.id === data.tokenId);
  if (!token) {
    return i.editReply({
      content: "\u274C **Token not found**\nThe selected token is no longer available.",
      embeds: [],
      components: []
    });
  }
  const cfg = await getConfig();
  const fromUser = await prisma.user.findUnique({ where: { discordId: i.user.id } });
  const taxFree = fromUser ? await userHasActiveTaxFreeTier(fromUser.id) : false;
  const feeBpsNum = taxFree ? 0 : token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;
  const feePercent = feeBpsNum / 100;
  const feeAmount = data.amount * feePercent / 100;
  const totalCost = data.amount + feeAmount;
  const tipEmoji = data.tipType === "direct" ? "\u{1F4B8}" : "\u{1F389}";
  const embed = new EmbedBuilder().setTitle(`${tipEmoji} Confirm Your Tip`).setDescription(
    `**Type:** ${data.tipType === "direct" ? "Direct Tip" : "Group Tip"}
**Amount:** ${data.amount} ${token.symbol}
**Fee:** ${feeAmount.toFixed(8)} ${token.symbol} ${taxFree ? "(Tax-free tier)" : `(${feePercent}%)`}
**Total Cost:** ${totalCost.toFixed(8)} ${token.symbol}
` + (data.tipType === "direct" && data.targetUserId ? `**Recipient:** <@${data.targetUserId}>
` : "") + (data.tipType === "group" && data.duration ? `**Duration:** ${data.duration >= 60 ? `${(data.duration / 60).toFixed(data.duration % 60 === 0 ? 0 : 1)} ${data.duration >= 60 ? "hour" + (data.duration === 60 ? "" : "s") : "minutes"}` : `${data.duration} minute${data.duration === 1 ? "" : "s"}`}
` : "") + (data.note ? `**Note:** ${data.note}
` : "") + `
${data.tipType === "direct" ? "\u{1F4B0} Send tip directly to user" : "\u{1F389} Create group tip for everyone"}`
  ).setColor(data.tipType === "direct" ? 65280 : 16766720).setFooter({ text: "Click confirm to process the tip" }).setTimestamp();
  const confirmButton = new ButtonBuilder().setCustomId(`pip:confirm_tip:${data.amount}:${data.tipType}:${data.targetUserId || "group"}:${encodeURIComponent(data.note)}:${data.tokenId}:${data.duration || ""}`).setLabel(`Confirm ${data.tipType === "direct" ? "Direct" : "Group"} Tip`).setStyle(ButtonStyle.Success).setEmoji("\u2705");
  const cancelButton = new ButtonBuilder().setCustomId("pip:cancel_tip").setLabel("Cancel").setStyle(ButtonStyle.Secondary).setEmoji("\u274C");
  const actionRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
  await i.editReply({
    embeds: [embed],
    components: [actionRow]
  });
}
export {
  handleCancelTip,
  handleConfirmTip,
  handleSelectDuration,
  handleSelectToken,
  showDurationSelection,
  showTipConfirmation
};
//# sourceMappingURL=tips.js.map
