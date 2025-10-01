import { MessageFlags } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { getActiveTokens } from "../services/token.js";
import { PENGUIN_ERRORS } from "../utils/penguin_messages.js";
import { getAppConfig } from "../services/app_config_cache.js";
async function pipTip(i) {
  try {
    try {
      const { analyzeUserBehavior } = await import("../services/anomaly_detection.js");
      const mockReq = {
        get: (header) => i.client.user?.tag || "Discord Bot",
        ip: "discord.com",
        headers: { "user-agent": "Discord Bot" },
        socket: { remoteAddress: "discord.com" }
      };
      await analyzeUserBehavior(i.user.id, mockReq, "tip_command", {
        tipAmount: i.options.getNumber("amount", true),
        isFinancialTransaction: true,
        hasTarget: !!i.options.getUser("user"),
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (behaviorError) {
      console.warn("Anomaly detection analysis failed for tip command:", behaviorError);
    }
    const config = await getAppConfig();
    if (config?.tippingPaused || config?.emergencyMode) {
      return i.reply({
        content: [
          "\u{1F6A8} **Tipping Temporarily Disabled**",
          "",
          "Tipping is currently paused for maintenance.",
          "Please try again later or contact support if this is urgent.",
          "",
          "All other bot functions remain available."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }
    const amount = i.options.getNumber("amount", true);
    const targetUser = i.options.getUser("user");
    const note = i.options.getString("note")?.trim().slice(0, 200).replace(/[<>@&]/g, "") || "";
    if (!amount || typeof amount !== "number" || !isFinite(amount) || amount <= 0 || amount > 1e15) {
      return i.reply({
        content: PENGUIN_ERRORS.invalidAmount(),
        flags: MessageFlags.Ephemeral
      });
    }
    const decimalPlaces = (amount.toString().split(".")[1] || "").length;
    if (decimalPlaces > 2) {
      return i.reply({
        content: PENGUIN_ERRORS.invalidAmount(),
        flags: MessageFlags.Ephemeral
      });
    }
    if (targetUser) {
      if (targetUser.bot) {
        return i.reply({
          content: PENGUIN_ERRORS.cannotTipBot(),
          flags: MessageFlags.Ephemeral
        });
      }
      if (targetUser.id === i.user.id) {
        return i.reply({
          content: PENGUIN_ERRORS.cannotTipSelf(),
          flags: MessageFlags.Ephemeral
        });
      }
    }
    const tokens = await getActiveTokens();
    if (tokens.length === 0) {
      return i.reply({
        content: PENGUIN_ERRORS.noTokensAvailable(),
        flags: MessageFlags.Ephemeral
      });
    }
    const tipType = targetUser ? "direct" : "group";
    const tipEmoji = tipType === "direct" ? "\u{1F4B8}" : "\u{1F389}";
    const tipDescription = tipType === "direct" ? `\u{1F4B0} Send ${amount} tokens directly to ${targetUser.displayName || targetUser.username}` : `\u{1F389} Create a group tip of ${amount} tokens that everyone in this channel can claim!`;
    const embed = new EmbedBuilder().setTitle(`${tipEmoji} Choose Your Token`).setDescription(
      `**Tip Type:** ${tipType === "direct" ? "Direct Tip" : "Group Tip"}
**Amount:** ${amount} tokens
**${tipType === "direct" ? "Recipient" : "Duration"}:** ${tipType === "direct" ? `<@${targetUser.id}>` : "Will be set in next step"}
` + (note ? `**Note:** ${note}
` : "") + `
${tipDescription}`
    ).setColor(tipType === "direct" ? 65280 : 16766720).setFooter({
      text: tipType === "direct" ? "\u{1F4A1} Tip: Leave user empty next time for group tips that everyone can claim!" : "\u{1F4A1} Tip: Specify a user next time for direct tips to individuals!"
    }).setTimestamp();
    const tokenButtons = [];
    const maxButtons = Math.min(tokens.length, 15);
    for (let i2 = 0; i2 < maxButtons; i2++) {
      const token = tokens[i2];
      const buttonId = `pip:select_token:${amount}:${tipType}:${targetUser?.id || "group"}:${encodeURIComponent(note)}:${token.id}`;
      tokenButtons.push(
        new ButtonBuilder().setCustomId(buttonId).setLabel(`${token.symbol}`).setStyle(ButtonStyle.Primary).setEmoji("\u{1FA99}")
      );
    }
    const actionRows = [];
    for (let i2 = 0; i2 < tokenButtons.length; i2 += 5) {
      const row = new ActionRowBuilder().addComponents(tokenButtons.slice(i2, i2 + 5));
      actionRows.push(row);
    }
    const cancelRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pip:cancel_tip").setLabel("\u{1F427} Nevermind").setStyle(ButtonStyle.Secondary).setEmoji("\u274C")
    );
    actionRows.push(cancelRow);
    await i.reply({
      embeds: [embed],
      components: actionRows,
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error("Enhanced tip command error:", error);
    throw error;
  }
}
export {
  pipTip as default
};
//# sourceMappingURL=pip_tip.js.map
