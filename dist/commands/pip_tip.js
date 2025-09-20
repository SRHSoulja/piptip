// src/commands/pip_tip_new.ts - Enhanced button-based tip interface
import { MessageFlags } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { prisma } from "../services/db.js";
import { getActiveTokens } from "../services/token.js";
import { PENGUIN_ERRORS } from "../utils/penguin_messages.js";
export default async function pipTip(i) {
    try {
        // Check for emergency mode
        const config = await prisma.appConfig.findFirst();
        if (config?.tippingPaused || config?.emergencyMode) {
            return i.reply({
                content: [
                    "🚨 **Tipping Temporarily Disabled**",
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
        // Validate amount
        if (!amount || typeof amount !== "number" || !isFinite(amount) || amount <= 0 || amount > 1e15) {
            return i.reply({
                content: PENGUIN_ERRORS.invalidAmount(),
                flags: MessageFlags.Ephemeral
            });
        }
        // Enforce 2 decimal places limit for user-friendliness
        const decimalPlaces = (amount.toString().split('.')[1] || '').length;
        if (decimalPlaces > 2) {
            return i.reply({
                content: PENGUIN_ERRORS.invalidAmount(),
                flags: MessageFlags.Ephemeral
            });
        }
        // Validate target user for direct tips
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
        // Get available tokens
        const tokens = await getActiveTokens();
        if (tokens.length === 0) {
            return i.reply({
                content: PENGUIN_ERRORS.noTokensAvailable(),
                flags: MessageFlags.Ephemeral
            });
        }
        // Determine tip type
        const tipType = targetUser ? "direct" : "group";
        const tipEmoji = tipType === "direct" ? "💸" : "🎉";
        const tipDescription = tipType === "direct"
            ? `💰 Send ${amount} tokens directly to ${targetUser.displayName || targetUser.username}`
            : `🎉 Create a group tip of ${amount} tokens that everyone in this channel can claim!`;
        // Create enhanced embed
        const embed = new EmbedBuilder()
            .setTitle(`${tipEmoji} Choose Your Token`)
            .setDescription(`**Tip Type:** ${tipType === "direct" ? "Direct Tip" : "Group Tip"}\n` +
            `**Amount:** ${amount} tokens\n` +
            `**${tipType === "direct" ? "Recipient" : "Duration"}:** ${tipType === "direct" ? `<@${targetUser.id}>` : "Will be set in next step"}\n` +
            (note ? `**Note:** ${note}\n` : "") +
            `\n${tipDescription}`)
            .setColor(tipType === "direct" ? 0x00FF00 : 0xFFD700)
            .setFooter({
            text: tipType === "direct"
                ? "💡 Tip: Leave user empty next time for group tips that everyone can claim!"
                : "💡 Tip: Specify a user next time for direct tips to individuals!"
        })
            .setTimestamp();
        // Create token selection buttons (max 5 per row)
        const tokenButtons = [];
        const maxButtons = Math.min(tokens.length, 15); // Discord limit: 3 rows × 5 buttons
        for (let i = 0; i < maxButtons; i++) {
            const token = tokens[i];
            const buttonId = `pip:select_token:${amount}:${tipType}:${targetUser?.id || "group"}:${encodeURIComponent(note)}:${token.id}`;
            tokenButtons.push(new ButtonBuilder()
                .setCustomId(buttonId)
                .setLabel(`${token.symbol}`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji("🪙"));
        }
        // Organize buttons into rows
        const actionRows = [];
        for (let i = 0; i < tokenButtons.length; i += 5) {
            const row = new ActionRowBuilder()
                .addComponents(tokenButtons.slice(i, i + 5));
            actionRows.push(row);
        }
        // Add cancel button
        const cancelRow = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId("pip:cancel_tip")
            .setLabel("🐧 Nevermind")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("❌"));
        actionRows.push(cancelRow);
        await i.reply({
            embeds: [embed],
            components: actionRows,
            flags: MessageFlags.Ephemeral
        });
    }
    catch (error) {
        console.error("Enhanced tip command error:", error);
        const errorMessage = PENGUIN_ERRORS.genericError("tip");
        if (i.deferred || i.replied) {
            await i.editReply({ content: errorMessage, embeds: [], components: [] }).catch(() => { });
        }
        else {
            await i.reply({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    }
}
