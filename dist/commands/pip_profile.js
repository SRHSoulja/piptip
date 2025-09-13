import { activeProfileRequests, generateProfileData, createProfileButtons, createProfileEmbed, trackProfileRequest, releaseProfileRequest } from "../services/profile.js";
export default async function pipProfile(i) {
    const userId = i.user.id;
    // Check if user already has a profile request processing
    if (activeProfileRequests.has(userId)) {
        return await i.reply({
            content: "⏳ Your profile is already loading! Please wait for it to complete before requesting another.",
            flags: 64 // Ephemeral
        });
    }
    // Add user to active requests with timeout
    trackProfileRequest(userId);
    // Reply immediately with a enhanced loading response
    await i.reply({
        content: "🔄 **Loading your profile...** \n⏳ *This may take a moment while we gather your stats*",
        flags: 64 // Ephemeral flag
    });
    try {
        // Generate comprehensive profile data
        const profileData = await generateProfileData(userId, i.user);
        // Create profile components
        const hasLinkedWallet = !!profileData.user.agwAddress;
        const profileButtons = createProfileButtons(profileData.activeMemberships, hasLinkedWallet, profileData.hasBio);
        const embed = createProfileEmbed(profileData);
        // Update the reply with the full profile
        await i.editReply({
            content: null, // Clear the loading message
            embeds: [embed],
            components: profileButtons
        });
    }
    catch (error) {
        console.error("Profile command error:", error);
        const errorMessage = `❌ **Error loading profile**\n${error?.message || String(error)}\n\n*You can try the command again in a moment.*`;
        // Since we already replied, use editReply for errors
        await i.editReply({
            content: errorMessage,
            embeds: [],
            components: []
        }).catch(() => { });
    }
    finally {
        // Always remove user from active requests
        releaseProfileRequest(userId);
    }
}
