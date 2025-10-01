import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
function secretPickRow(matchId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pip:pick:${matchId}:penguin`).setLabel("\u{1F427} Penguin").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pip:pick:${matchId}:ice`).setLabel("\u{1F9CA} Ice").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pip:pick:${matchId}:pebble`).setLabel("\u{1FAA8} Pebble").setStyle(ButtonStyle.Primary)
  );
}
function publicJoinRow(matchId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pip:join:${matchId}:penguin`).setLabel("\u{1F427} Penguin").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pip:join:${matchId}:ice`).setLabel("\u{1F9CA} Ice").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`pip:join:${matchId}:pebble`).setLabel("\u{1FAA8} Pebble").setStyle(ButtonStyle.Success)
  );
}
function cancelRow(matchId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pip:cancel:${matchId}`).setLabel("Cancel").setStyle(ButtonStyle.Danger)
  );
}
function groupTipClaimRow(groupTipId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`grouptip:claim:${groupTipId}`).setLabel("\u{1F427} Grab My Fish!").setStyle(ButtonStyle.Success).setEmoji("\u{1F381}").setDisabled(disabled),
    new ButtonBuilder().setCustomId(`grouptip:add:${groupTipId}`).setLabel("\u{1F41F} Add More Fish!").setStyle(ButtonStyle.Primary).setEmoji("\u2795").setDisabled(disabled)
  );
}
export {
  cancelRow,
  groupTipClaimRow,
  publicJoinRow,
  secretPickRow
};
//# sourceMappingURL=components.js.map
