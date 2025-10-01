import { activeProfileRequests, generateProfileData, createProfileButtons, createProfileEmbed, trackProfileRequest, releaseProfileRequest } from "../services/profile.js";
async function pipProfile(i) {
  const userId = i.user.id;
  if (activeProfileRequests.has(userId)) {
    return await i.reply({
      content: "\u23F3 Your profile is already loading! Please wait for it to complete before requesting another.",
      flags: 64
      // Ephemeral
    });
  }
  trackProfileRequest(userId);
  await i.deferReply({ flags: 64 });
  await i.editReply({
    content: "\u{1F504} **Loading your profile...** \n\u23F3 *This may take a moment while we gather your stats*"
  });
  try {
    const profileData = await Promise.race([
      generateProfileData(userId, i.user),
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error("Profile generation timed out after 15 seconds")), 15e3)
      )
    ]);
    const hasLinkedWallet = !!profileData.user.agwAddress;
    const hasInboxMessages = profileData.unreadMessageCount > 0;
    const profileButtons = createProfileButtons(profileData.activeMemberships, hasLinkedWallet, profileData.hasBio, hasInboxMessages);
    const embed = await createProfileEmbed(profileData);
    await i.editReply({
      content: null,
      // Clear the loading message
      embeds: [embed],
      components: profileButtons
    }).catch(async (editError) => {
      console.error("Failed to edit reply with profile data:", editError);
      await i.editReply({
        content: "\u274C **Profile loaded but couldn't display properly**\n*The profile data was generated successfully but Discord rejected the response. Try again.*",
        embeds: [],
        components: []
      }).catch(() => {
      });
    });
  } catch (error) {
    console.error("Profile command error:", error);
    let errorMessage = `\u274C **Error loading profile**
`;
    if (error?.message?.includes("timed out")) {
      errorMessage += `Profile generation took too long. This may indicate database connectivity issues.

*Try again in a moment.*`;
    } else if (error?.message?.includes("rate limited")) {
      errorMessage += `${error.message}

*Please wait before trying again.*`;
    } else {
      errorMessage += `${error?.message || String(error)}

*You can try the command again in a moment.*`;
    }
    await i.editReply({
      content: errorMessage,
      embeds: [],
      components: []
    }).catch((editError) => {
      console.error("Failed to edit reply with error message:", editError);
    });
  } finally {
    releaseProfileRequest(userId);
  }
}
export {
  pipProfile as default
};
//# sourceMappingURL=pip_profile.js.map
