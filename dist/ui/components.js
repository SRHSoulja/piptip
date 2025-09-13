import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
/** Challenger's secret pick (ephemeral) */
export function secretPickRow(matchId) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(`pip:pick:${matchId}:penguin`)
        .setLabel("🐧 Penguin")
        .setStyle(ButtonStyle.Primary), new ButtonBuilder()
        .setCustomId(`pip:pick:${matchId}:ice`)
        .setLabel("🧊 Ice")
        .setStyle(ButtonStyle.Primary), new ButtonBuilder()
        .setCustomId(`pip:pick:${matchId}:pebble`)
        .setLabel("🪨 Pebble")
        .setStyle(ButtonStyle.Primary));
}
/** Public join row on the posted match */
export function publicJoinRow(matchId) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(`pip:join:${matchId}:penguin`)
        .setLabel("🐧 Penguin")
        .setStyle(ButtonStyle.Success), new ButtonBuilder()
        .setCustomId(`pip:join:${matchId}:ice`)
        .setLabel("🧊 Ice")
        .setStyle(ButtonStyle.Success), new ButtonBuilder()
        .setCustomId(`pip:join:${matchId}:pebble`)
        .setLabel("🪨 Pebble")
        .setStyle(ButtonStyle.Success));
}
/** Challenger cancel button on the public message */
export function cancelRow(matchId) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(`pip:cancel:${matchId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger));
}
/** Group tip claim button */
export function groupTipClaimRow(groupTipId, disabled = false) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(`grouptip:claim:${groupTipId}`)
        .setLabel("Claim Share")
        .setStyle(ButtonStyle.Success)
        .setEmoji("🎁")
        .setDisabled(disabled) // 🔑 allow disabling
    );
}
