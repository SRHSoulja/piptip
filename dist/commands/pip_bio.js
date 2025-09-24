import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../services/db.js";
import { findOrCreateUser } from "../services/user_helpers.js";
export default async function pipBio(i) {
    const subcommand = i.options.getSubcommand();
    switch (subcommand) {
        case "set":
            return handleSetBio(i);
        case "view":
            return handleViewBio(i);
        case "clear":
            return handleClearBio(i);
        case "settings":
            return handleBioSettings(i);
        default:
            return i.reply({ content: "Unknown bio command!", flags: 64 });
    }
}
async function handleSetBio(i) {
    const bio = i.options.getString("bio", true);
    const xUsername = i.options.getString("x_username", false);
    // Validate bio length
    if (bio.length > 500) {
        return i.reply({
            content: "❌ Bio too long! Maximum 500 characters allowed.",
            flags: 64
        });
    }
    // Validate X username format (optional)
    let cleanXUsername = null;
    if (xUsername) {
        // Remove @ if present and validate format
        cleanXUsername = xUsername.replace(/^@/, "");
        if (!/^[A-Za-z0-9_]{1,15}$/.test(cleanXUsername)) {
            return i.reply({
                content: "❌ Invalid X username format! Use only letters, numbers, and underscores (max 15 chars).",
                flags: 64
            });
        }
    }
    try {
        // Find or create user
        const user = await findOrCreateUser(i.user.id);
        // Check if this is their first time joining PenguBook
        const wasInPenguBook = user.showInPenguBook;
        // Update bio and X username
        await prisma.user.update({
            where: { id: user.id },
            data: {
                bio,
                xUsername: cleanXUsername,
                bioLastUpdated: new Date(),
                showInPenguBook: true // Auto-enable when setting bio
            }
        });
        // Create activity feed item if this is their first time joining PenguBook
        if (!wasInPenguBook) {
            try {
                await prisma.activityFeedItem.create({
                    data: {
                        userId: user.id,
                        type: 'join',
                        data: {
                            userHandle: `User#${i.user.id.slice(-4)}`,
                            firstBio: bio.substring(0, 50) + (bio.length > 50 ? '...' : '')
                        },
                        visibility: 'public'
                    }
                });
            }
            catch (error) {
                console.error("Failed to create activity feed item for new user join:", error);
                // Don't fail the bio update if activity feed creation fails
            }
        }
        const embed = new EmbedBuilder()
            .setColor(0x00ff88)
            .setTitle("✅ Bio Updated!")
            .setDescription(`Your PenguBook profile has been updated!`)
            .addFields({ name: "📝 Bio", value: bio, inline: false }, ...(cleanXUsername ? [{ name: "🐦 X/Twitter", value: `@${cleanXUsername}`, inline: true }] : []))
            .setFooter({ text: "Your profile is now visible in PenguBook!" });
        const buttons = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId("pip_pengubook_browse")
            .setLabel("📖 Browse PenguBook")
            .setStyle(ButtonStyle.Primary), new ButtonBuilder()
            .setCustomId("pip_bio_view_own")
            .setLabel("👀 View My Profile")
            .setStyle(ButtonStyle.Secondary));
        return i.reply({ embeds: [embed], components: [buttons], flags: 64 });
    }
    catch (error) {
        console.error("Error setting bio:", error);
        return i.reply({
            content: "❌ Failed to update bio. Please try again later.",
            flags: 64
        });
    }
}
async function handleViewBio(i) {
    const targetUser = i.options.getUser("user", false);
    const userId = targetUser ? targetUser.id : i.user.id;
    try {
        const user = await prisma.user.findUnique({
            where: { discordId: userId },
            select: {
                bio: true,
                xUsername: true,
                bioViewCount: true,
                bioLastUpdated: true,
                showInPenguBook: true,
                allowTipsFromBook: true
            }
        });
        if (!user || !user.bio) {
            const isOwnProfile = userId === i.user.id;
            return i.reply({
                content: isOwnProfile
                    ? "📝 You haven't set a bio yet! Use `/pip_bio set` to create your PenguBook profile."
                    : "📝 This user hasn't set up their PenguBook profile yet.",
                flags: 64
            });
        }
        if (!user.showInPenguBook && userId !== i.user.id) {
            return i.reply({
                content: "🔒 This user has disabled their PenguBook profile.",
                flags: 64
            });
        }
        // If viewing someone else's profile, increment view count and track browse
        const isOwnProfile = userId === i.user.id;
        if (!isOwnProfile) {
            const viewerUser = await findOrCreateUser(i.user.id);
            const profileUser = await findOrCreateUser(userId);
            // Increment view count
            await prisma.user.update({
                where: { discordId: userId },
                data: { bioViewCount: { increment: 1 } }
            });
            // Track browsing (upsert to prevent duplicates)
            await prisma.bioBrowse.upsert({
                where: {
                    viewerId_profileId: {
                        viewerId: viewerUser.id,
                        profileId: profileUser.id
                    }
                },
                create: {
                    viewerId: viewerUser.id,
                    profileId: profileUser.id
                },
                update: {
                    createdAt: new Date() // Update timestamp for recent view
                }
            });
        }
        const displayName = targetUser ? targetUser.username : i.user.username;
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`📖 ${displayName}'s PenguBook Profile`)
            .setDescription(user.bio)
            .addFields({ name: "👀 Profile Views", value: user.bioViewCount.toString(), inline: true }, ...(user.xUsername ? [{ name: "🐦 X/Twitter", value: `[@${user.xUsername}](https://x.com/${user.xUsername})`, inline: true }] : []), ...(user.bioLastUpdated ? [{ name: "📅 Last Updated", value: `<t:${Math.floor(user.bioLastUpdated.getTime() / 1000)}:R>`, inline: true }] : []));
        const buttons = new ActionRowBuilder();
        if (!isOwnProfile && user.allowTipsFromBook) {
            buttons.addComponents(new ButtonBuilder()
                .setCustomId(`pip_tip_from_book:${userId}`)
                .setLabel("💰 Send Tip")
                .setStyle(ButtonStyle.Success));
        }
        buttons.addComponents(new ButtonBuilder()
            .setCustomId("pip_pengubook_browse")
            .setLabel("📖 Browse More Profiles")
            .setStyle(ButtonStyle.Primary));
        return i.reply({ embeds: [embed], components: [buttons], flags: 64 });
    }
    catch (error) {
        console.error("Error viewing bio:", error);
        return i.reply({
            content: "❌ Failed to load profile. Please try again later.",
            flags: 64
        });
    }
}
async function handleClearBio(i) {
    try {
        const user = await findOrCreateUser(i.user.id);
        await prisma.user.update({
            where: { id: user.id },
            data: {
                bio: null,
                xUsername: null,
                bioLastUpdated: null,
                showInPenguBook: false
            }
        });
        return i.reply({
            content: "✅ Your bio has been cleared and you've been removed from PenguBook.",
            flags: 64
        });
    }
    catch (error) {
        console.error("Error clearing bio:", error);
        return i.reply({
            content: "❌ Failed to clear bio. Please try again later.",
            flags: 64
        });
    }
}
async function handleBioSettings(i) {
    try {
        const user = await prisma.user.findUnique({
            where: { discordId: i.user.id },
            select: {
                bio: true,
                showInPenguBook: true,
                allowTipsFromBook: true
            }
        });
        if (!user || !user.bio) {
            return i.reply({
                content: "📝 You need to set a bio first! Use `/pip_bio set` to create your profile.",
                flags: 64
            });
        }
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("⚙️ PenguBook Settings")
            .setDescription("Manage your PenguBook profile settings:")
            .addFields({ name: "📖 Show in PenguBook", value: user.showInPenguBook ? "✅ Enabled" : "❌ Disabled", inline: true }, { name: "💰 Allow Tips from Book", value: user.allowTipsFromBook ? "✅ Enabled" : "❌ Disabled", inline: true });
        const buttons = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId(`pip_bio_toggle:showInPenguBook:${!user.showInPenguBook}`)
            .setLabel(user.showInPenguBook ? "Hide from PenguBook" : "Show in PenguBook")
            .setStyle(user.showInPenguBook ? ButtonStyle.Danger : ButtonStyle.Success), new ButtonBuilder()
            .setCustomId(`pip_bio_toggle:allowTipsFromBook:${!user.allowTipsFromBook}`)
            .setLabel(user.allowTipsFromBook ? "Disable Tips" : "Enable Tips")
            .setStyle(user.allowTipsFromBook ? ButtonStyle.Danger : ButtonStyle.Success));
        return i.reply({ embeds: [embed], components: [buttons], flags: 64 });
    }
    catch (error) {
        console.error("Error showing bio settings:", error);
        return i.reply({
            content: "❌ Failed to load settings. Please try again later.",
            flags: 64
        });
    }
}
