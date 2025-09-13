/** Handle profile refresh button */
export async function handleRefreshProfile(i) {
    await i.deferUpdate().catch(() => { });
    try {
        // Import the shared profile service
        const { generateProfileData, createProfileButtons, createProfileEmbed, activeProfileRequests, trackProfileRequest, releaseProfileRequest } = await import("../../services/profile.js");
        const userId = i.user.id;
        // Check if user already has a profile request processing
        if (activeProfileRequests.has(userId)) {
            return await i.editReply({
                content: "⏳ Profile refresh already in progress! Please wait.",
                embeds: [],
                components: []
            });
        }
        // Add user to active requests with timeout
        trackProfileRequest(userId);
        // Generate fresh profile data
        const profileData = await generateProfileData(userId, i.user);
        const profileButtons = createProfileButtons(profileData.activeMemberships);
        const embed = createProfileEmbed(profileData);
        // Update with fresh profile
        await i.editReply({
            content: null,
            embeds: [embed],
            components: profileButtons
        });
    }
    catch (error) {
        console.error("Profile refresh error:", error);
        await i.editReply({
            content: `❌ **Failed to refresh profile**\n${error?.message || String(error)}\n\n*Please try using the /profile command instead.*`,
            embeds: [],
            components: []
        }).catch(() => { });
    }
    finally {
        // Always remove user from active requests
        const { releaseProfileRequest: release } = await import("../../services/profile.js");
        release(i.user.id);
    }
}
/** Handle profile dismiss button */
export async function handleDismissProfile(i) {
    await i.deferUpdate().catch(() => { });
    try {
        await i.editReply({
            content: "👋 **Profile dismissed**\n*Use the `/profile` command to view your profile again.*",
            embeds: [],
            components: []
        });
    }
    catch (error) {
        console.error("Profile dismiss error:", error);
        // If edit fails, try to reply with a simple message
        await i.followUp({
            content: "Profile dismissed.",
            flags: 64
        }).catch(() => { });
    }
}
/** Handle view profile button */
export async function handleViewProfile(i) {
    await i.deferReply({ ephemeral: true }).catch(() => { });
    try {
        // Import profile functionality
        const { generateProfileData, createProfileButtons, createProfileEmbed } = await import("../../services/profile.js");
        const profileData = await generateProfileData(i.user.id, i.user);
        const hasLinkedWallet = !!profileData.user.agwAddress;
        const profileButtons = createProfileButtons(profileData.activeMemberships, hasLinkedWallet);
        const embed = createProfileEmbed(profileData);
        await i.editReply({
            embeds: [embed],
            components: profileButtons
        });
    }
    catch (error) {
        console.error("View profile error:", error);
        await i.editReply({
            content: `❌ **Error loading profile**\n${error?.message || String(error)}`
        });
    }
}
