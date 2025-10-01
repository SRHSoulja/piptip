import { PENGUIN_LOADING } from "../../utils/penguin_messages.js";
async function handleRefreshProfile(i) {
  await i.deferUpdate().catch(() => {
  });
  try {
    const { generateProfileData, createProfileButtons, createProfileEmbed, activeProfileRequests, trackProfileRequest, releaseProfileRequest } = await import("../../services/profile.js");
    const userId = i.user.id;
    if (activeProfileRequests.has(userId)) {
      return await i.editReply({
        content: PENGUIN_LOADING.profile(),
        embeds: [],
        components: []
      });
    }
    trackProfileRequest(userId);
    const profileData = await generateProfileData(userId, i.user);
    const hasLinkedWallet = !!profileData.user.agwAddress;
    const hasInboxMessages = profileData.unreadMessageCount > 0;
    const profileButtons = createProfileButtons(profileData.activeMemberships, hasLinkedWallet, profileData.hasBio, hasInboxMessages);
    const embed = await createProfileEmbed(profileData);
    await i.editReply({
      content: null,
      embeds: [embed],
      components: profileButtons
    });
  } catch (error) {
    console.error("Profile refresh error:", error);
    await i.editReply({
      content: `\u274C **Failed to refresh profile**
${error?.message || String(error)}

*Please try using the /profile command instead.*`,
      embeds: [],
      components: []
    }).catch(() => {
    });
  } finally {
    const { releaseProfileRequest: release } = await import("../../services/profile.js");
    release(i.user.id);
  }
}
async function handleDismissProfile(i) {
  await i.deferUpdate().catch(() => {
  });
  try {
    await i.editReply({
      content: "\u{1F44B} **Profile dismissed**\n*Use the `/profile` command to view your profile again.*",
      embeds: [],
      components: []
    });
  } catch (error) {
    console.error("Profile dismiss error:", error);
    await i.followUp({
      content: "Profile dismissed.",
      flags: 64
    }).catch(() => {
    });
  }
}
async function handleViewProfile(i) {
  const fromPenguBook = i.customId.includes("back_to_profile");
  if (fromPenguBook) {
    await i.deferUpdate().catch(() => {
    });
  } else {
    await i.deferReply({ ephemeral: true }).catch(() => {
    });
  }
  try {
    const { generateProfileData, createProfileButtons, createProfileEmbed } = await import("../../services/profile.js");
    const profileData = await generateProfileData(i.user.id, i.user);
    const hasLinkedWallet = !!profileData.user.agwAddress;
    const hasInboxMessages = profileData.unreadMessageCount > 0;
    const profileButtons = createProfileButtons(profileData.activeMemberships, hasLinkedWallet, profileData.hasBio, hasInboxMessages);
    const embed = await createProfileEmbed(profileData);
    await i.editReply({
      content: null,
      // Clear any existing content
      embeds: [embed],
      components: profileButtons
    });
  } catch (error) {
    console.error("View profile error:", error);
    await i.editReply({
      content: `\u274C **Error loading profile**
${error?.message || String(error)}`,
      embeds: [],
      components: []
    });
  }
}
export {
  handleDismissProfile,
  handleRefreshProfile,
  handleViewProfile
};
//# sourceMappingURL=profile.js.map
