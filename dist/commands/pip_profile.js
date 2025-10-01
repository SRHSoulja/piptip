import { activeProfileRequests, generateProfileData, createProfileButtons, createProfileEmbed, trackProfileRequest, releaseProfileRequest } from "../services/profile.js";
export default async function pipProfile(i) {
    const userId = i.user.id;
    // Check if user already has a profile request processing
    if (activeProfileRequests.has(userId)) {
        // Check if interaction is already deferred (from middleware)
        if (i.deferred) {
            return await i.editReply({
                content: "⏳ Your profile is already loading! Please wait for it to complete before requesting another."
            });
        }
        else {
            return await i.reply({
                content: "⏳ Your profile is already loading! Please wait for it to complete before requesting another.",
                flags: 64 // Ephemeral
            });
        }
    }
    // Add user to active requests with timeout
    trackProfileRequest(userId);
    // Update deferred reply with loading message (interaction already deferred by middleware)
    await i.editReply({
        content: "🔄 **Loading your profile...** \n⏳ *This may take a moment while we gather your stats*"
    });
    try {
        // Generate comprehensive profile data with timeout
        const profileData = await Promise.race([
            generateProfileData(userId, i.user),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Profile generation timed out after 15 seconds")), 15000))
        ]);
        // Create profile components
        const hasLinkedWallet = !!profileData.user.agwAddress;
        const hasInboxMessages = profileData.unreadMessageCount > 0;
        const profileButtons = createProfileButtons(profileData.activeMemberships, hasLinkedWallet, profileData.hasBio, hasInboxMessages);
        const embed = await createProfileEmbed(profileData);
        // Update the reply with the full profile (with error handling)
        await i.editReply({
            content: null, // Clear the loading message
            embeds: [embed],
            components: profileButtons
        }).catch(async (editError) => {
            console.error("Failed to edit reply with profile data:", editError);
            // Fallback: try to send a simple response
            await i.editReply({
                content: "❌ **Profile loaded but couldn't display properly**\n*The profile data was generated successfully but Discord rejected the response. Try again.*",
                embeds: [],
                components: []
            }).catch(() => { });
        });
    }
    catch (error) {
        console.error("Profile command error:", error);
        let errorMessage = `❌ **Error loading profile**\n`;
        if (error?.message?.includes("timed out")) {
            errorMessage += `Profile generation took too long. This may indicate database connectivity issues.\n\n*Try again in a moment.*`;
        }
        else if (error?.message?.includes("rate limited")) {
            errorMessage += `${error.message}\n\n*Please wait before trying again.*`;
        }
        else {
            errorMessage += `${error?.message || String(error)}\n\n*You can try the command again in a moment.*`;
        }
        // Since we already replied, use editReply for errors
        await i.editReply({
            content: errorMessage,
            embeds: [],
            components: []
        }).catch((editError) => {
            console.error("Failed to edit reply with error message:", editError);
        });
    }
    finally {
        // Always remove user from active requests
        releaseProfileRequest(userId);
    }
}
