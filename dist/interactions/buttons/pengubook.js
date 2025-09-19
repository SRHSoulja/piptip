import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { prisma } from "../../services/db.js";
import { findOrCreateUser } from "../../services/user_helpers.js";
import { fetchMultipleUserData, getDiscordClient } from "../../services/discord_users.js";
// Helper function to get unread message count
export async function getUnreadMessageCount(discordId) {
    try {
        const user = await findOrCreateUser(discordId);
        return await prisma.penguBookMessage.count({
            where: {
                toUserId: user.id,
                read: false
            }
        });
    }
    catch (error) {
        console.warn("Failed to get unread message count:", error);
        return 0;
    }
}
// Handle PenguBook navigation
export async function handlePenguBookNav(i, mode, page) {
    console.log(`📖 PenguBook nav - mode: ${mode}, page: ${page}, user: ${i.user.id}`);
    await i.deferUpdate();
    try {
        const PROFILES_PER_PAGE = 1;
        // Add timeout wrapper around database calls
        const dbTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 3000));
        // Get total count with timeout
        const totalCount = await Promise.race([
            prisma.user.count({
                where: {
                    bio: { not: null },
                    showInPenguBook: true
                }
            }),
            dbTimeout
        ]);
        if (totalCount === 0) {
            return i.editReply({
                content: "📖 **PenguBook is empty!** \nBe the first to create a profile with `/pip_bio set`",
                embeds: [],
                components: []
            });
        }
        const totalPages = Math.ceil(totalCount / PROFILES_PER_PAGE);
        const offset = (page - 1) * PROFILES_PER_PAGE;
        // Fetch profile based on mode
        let profiles = [];
        // Fetch profiles with timeout protection
        const profileQuery = (() => {
            const baseQuery = {
                where: { bio: { not: null }, showInPenguBook: true },
                select: {
                    discordId: true, bio: true, xUsername: true, bioViewCount: true,
                    bioLastUpdated: true, allowTipsFromBook: true,
                    _count: { select: { tipsSent: true, tipsReceived: true } }
                },
                take: PROFILES_PER_PAGE
            };
            switch (mode) {
                case "recent":
                    return prisma.user.findMany({
                        ...baseQuery,
                        orderBy: { bioLastUpdated: "desc" },
                        skip: offset
                    });
                case "popular":
                    return prisma.user.findMany({
                        ...baseQuery,
                        orderBy: { bioViewCount: "desc" },
                        skip: offset
                    });
                case "random":
                    const randomOffset = Math.floor(Math.random() * Math.max(1, totalCount - PROFILES_PER_PAGE + 1));
                    return prisma.user.findMany({
                        ...baseQuery,
                        skip: randomOffset
                    });
                default:
                    return prisma.user.findMany({
                        ...baseQuery,
                        orderBy: { bioLastUpdated: "desc" },
                        skip: offset
                    });
            }
        })();
        profiles = await Promise.race([profileQuery, dbTimeout]);
        if (profiles.length === 0) {
            return i.editReply({
                content: `📖 **No profiles found!** \nTry a different mode.`,
                embeds: [],
                components: []
            });
        }
        // Get user data with avatar
        const profile = profiles[0];
        let userInfo = {
            username: `User ${profile.discordId.slice(0, 8)}...`,
            avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(profile.discordId.slice(-1)) % 6}.png`
        };
        try {
            const client = getDiscordClient();
            if (client) {
                const userData = await fetchMultipleUserData(client, [profile.discordId]);
                userInfo = userData.get(profile.discordId) || userInfo;
            }
        }
        catch (error) {
            console.warn("Failed to fetch user data:", error);
        }
        // Create embed
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("📖 PenguBook")
            .setAuthor({
            name: `🐧 ${userInfo.username}`,
            iconURL: userInfo.avatarURL
        })
            .setThumbnail(userInfo.avatarURL)
            .setDescription(profile.bio)
            .addFields({ name: "👀 Profile Views", value: profile.bioViewCount.toString(), inline: true }, { name: "💌 Tips Sent", value: profile._count.tipsSent.toString(), inline: true }, { name: "🎁 Tips Received", value: profile._count.tipsReceived.toString(), inline: true }, ...(profile.xUsername ? [{ name: "🐦 X/Twitter", value: `[@${profile.xUsername}](https://x.com/${profile.xUsername})`, inline: true }] : []))
            .setFooter({
            text: `Page ${page} of ${totalPages} • ${totalCount} profiles • Mode: ${mode}`
        });
        // Create buttons
        const navButtons = new ActionRowBuilder();
        const actionButtons = new ActionRowBuilder();
        if (page > 1) {
            navButtons.addComponents(new ButtonBuilder()
                .setCustomId(`pip:pengubook_nav:${mode}:${page - 1}`)
                .setLabel("← Previous")
                .setStyle(ButtonStyle.Secondary));
        }
        if (page < totalPages) {
            navButtons.addComponents(new ButtonBuilder()
                .setCustomId(`pip:pengubook_nav:${mode}:${page + 1}`)
                .setLabel("Next →")
                .setStyle(ButtonStyle.Secondary));
        }
        navButtons.addComponents(new ButtonBuilder()
            .setCustomId(`pip:pengubook_nav:random:1`)
            .setLabel("🎲 Random")
            .setStyle(ButtonStyle.Primary));
        if (profile.allowTipsFromBook && profile.discordId !== i.user.id) {
            actionButtons.addComponents(new ButtonBuilder()
                .setCustomId(`pip:tip_from_book:${profile.discordId}`)
                .setLabel("💰 Send Tip")
                .setStyle(ButtonStyle.Success));
        }
        actionButtons.addComponents(new ButtonBuilder()
            .setCustomId("pip:pengubook_modes")
            .setLabel("📊 Browse Modes")
            .setStyle(ButtonStyle.Primary));
        // Track browsing
        if (profile.discordId !== i.user.id) {
            try {
                const viewerUser = await findOrCreateUser(i.user.id);
                const profileUser = await findOrCreateUser(profile.discordId);
                await prisma.user.update({
                    where: { discordId: profile.discordId },
                    data: { bioViewCount: { increment: 1 } }
                });
                await prisma.bioBrowse.upsert({
                    where: {
                        viewerId_profileId: {
                            viewerId: viewerUser.id,
                            profileId: profileUser.id
                        }
                    },
                    create: { viewerId: viewerUser.id, profileId: profileUser.id },
                    update: { createdAt: new Date() }
                });
            }
            catch (error) {
                console.warn("Failed to track browsing:", error);
            }
        }
        const components = [actionButtons];
        if (navButtons.components.length > 0) {
            components.unshift(navButtons);
        }
        return i.editReply({ embeds: [embed], components });
    }
    catch (error) {
        console.error("Error navigating PenguBook:", error);
        return i.editReply({
            content: "❌ Failed to navigate PenguBook. Please try again.",
            embeds: [],
            components: []
        });
    }
}
// Handle showing browse modes
export async function handlePenguBookModes(i) {
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📊 PenguBook Browse Modes")
        .setDescription("Choose how you want to explore profiles:")
        .addFields({ name: "🕒 Recent", value: "Browse profiles by most recently updated", inline: false }, { name: "🔥 Popular", value: "Browse profiles by most profile views", inline: false }, { name: "🎲 Random", value: "Discover profiles randomly", inline: false });
    const buttons = new ActionRowBuilder()
        .addComponents(new ButtonBuilder()
        .setCustomId("pip:pengubook_nav:recent:1")
        .setLabel("🕒 Recent")
        .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId("pip:pengubook_nav:popular:1")
        .setLabel("🔥 Popular")
        .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId("pip:pengubook_nav:random:1")
        .setLabel("🎲 Random")
        .setStyle(ButtonStyle.Primary));
    return i.reply({ embeds: [embed], components: [buttons], flags: 64 });
}
// Handle bio settings toggles
export async function handleBioToggle(i, setting, value) {
    await i.deferUpdate();
    try {
        const user = await findOrCreateUser(i.user.id);
        const updateData = {};
        updateData[setting] = value;
        await prisma.user.update({
            where: { id: user.id },
            data: updateData
        });
        // Refresh the settings embed
        const updatedUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: {
                showInPenguBook: true,
                allowTipsFromBook: true
            }
        });
        const embed = new EmbedBuilder()
            .setColor(0x00ff88)
            .setTitle("⚙️ PenguBook Settings")
            .setDescription("✅ Settings updated! Your preferences:")
            .addFields({ name: "📖 Show in PenguBook", value: updatedUser.showInPenguBook ? "✅ Enabled" : "❌ Disabled", inline: true }, { name: "💰 Allow Tips from Book", value: updatedUser.allowTipsFromBook ? "✅ Enabled" : "❌ Disabled", inline: true });
        const buttons = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId(`pip:bio_toggle:showInPenguBook:${!updatedUser.showInPenguBook}`)
            .setLabel(updatedUser.showInPenguBook ? "Hide from PenguBook" : "Show in PenguBook")
            .setStyle(updatedUser.showInPenguBook ? ButtonStyle.Danger : ButtonStyle.Success), new ButtonBuilder()
            .setCustomId(`pip:bio_toggle:allowTipsFromBook:${!updatedUser.allowTipsFromBook}`)
            .setLabel(updatedUser.allowTipsFromBook ? "Disable Tips" : "Enable Tips")
            .setStyle(updatedUser.allowTipsFromBook ? ButtonStyle.Danger : ButtonStyle.Success));
        return i.editReply({ embeds: [embed], components: [buttons] });
    }
    catch (error) {
        console.error("Error toggling bio setting:", error);
        return i.editReply({
            content: "❌ Failed to update settings. Please try again.",
            embeds: [],
            components: []
        });
    }
}
// Handle tipping from PenguBook
export async function handleTipFromBook(i, targetDiscordId) {
    // This will integrate with existing tip functionality
    // For now, show a modal for quick tip
    const modal = new ModalBuilder()
        .setCustomId(`pip:tip_modal:${targetDiscordId}`)
        .setTitle("💰 Send Tip from PenguBook");
    const amountInput = new TextInputBuilder()
        .setCustomId("amount")
        .setLabel("Amount")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Enter amount (e.g. 10)")
        .setRequired(true);
    const tokenInput = new TextInputBuilder()
        .setCustomId("token")
        .setLabel("Token")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("PENGUIN, ICE, or PEBBLE")
        .setValue("PENGUIN")
        .setRequired(true);
    const noteInput = new TextInputBuilder()
        .setCustomId("note")
        .setLabel("Note (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Leave a nice message...")
        .setRequired(false)
        .setMaxLength(200);
    modal.addComponents(new ActionRowBuilder().addComponents(amountInput), new ActionRowBuilder().addComponents(tokenInput), new ActionRowBuilder().addComponents(noteInput));
    return i.showModal(modal);
}
// Handle viewing own bio from buttons
export async function handleViewOwnBio(i) {
    await i.deferReply({ ephemeral: true });
    try {
        // Add timeout protection for database query
        const dbTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 3000));
        const user = await Promise.race([
            prisma.user.findUnique({
                where: { discordId: i.user.id },
                select: {
                    bio: true,
                    xUsername: true,
                    bioViewCount: true,
                    bioLastUpdated: true
                }
            }),
            dbTimeout
        ]);
        if (!user || !user.bio) {
            return i.editReply({
                content: "📝 You haven't set a bio yet! Use `/pip_bio set` to create your PenguBook profile."
            });
        }
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`📖 Your PenguBook Profile`)
            .setDescription(user.bio)
            .addFields({ name: "👀 Profile Views", value: user.bioViewCount.toString(), inline: true }, ...(user.xUsername ? [{ name: "🐦 X/Twitter", value: `[@${user.xUsername}](https://x.com/${user.xUsername})`, inline: true }] : []), ...(user.bioLastUpdated ? [{ name: "📅 Last Updated", value: `<t:${Math.floor(user.bioLastUpdated.getTime() / 1000)}:R>`, inline: true }] : []));
        // Get unread message count for inbox button
        const unreadCount = await getUnreadMessageCount(i.user.id);
        const inboxLabel = unreadCount > 0 ? `📬 Inbox (${unreadCount})` : "📬 Inbox";
        const buttons = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId("pip:pengubook_nav:recent:1")
            .setLabel("📖 Browse PenguBook")
            .setStyle(ButtonStyle.Primary), new ButtonBuilder()
            .setCustomId("pip:pengubook_inbox")
            .setLabel(inboxLabel)
            .setStyle(unreadCount > 0 ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder()
            .setCustomId("pip:bio_settings")
            .setLabel("⚙️ Settings")
            .setStyle(ButtonStyle.Secondary));
        return i.editReply({ embeds: [embed], components: [buttons] });
    }
    catch (error) {
        console.error("Error viewing own bio:", error);
        return i.editReply({
            content: "❌ Failed to load your profile. Please try again."
        });
    }
}
// Handle PenguBook CTA - show quick bio setup modal (conversion funnel!)
export async function handlePenguBookCTA(i) {
    const modal = new ModalBuilder()
        .setCustomId("pip:pengubook_bio_setup")
        .setTitle("🐧 Join PenguBook - Create Your Profile");
    const bioInput = new TextInputBuilder()
        .setCustomId("bio")
        .setLabel("Your Bio")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Tell the community about yourself! (max 500 characters)")
        .setRequired(true)
        .setMaxLength(500);
    const xInput = new TextInputBuilder()
        .setCustomId("x_username")
        .setLabel("X/Twitter Username (optional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("your_handle (without @)")
        .setRequired(false)
        .setMaxLength(15);
    modal.addComponents(new ActionRowBuilder().addComponents(bioInput), new ActionRowBuilder().addComponents(xInput));
    return i.showModal(modal);
}
// Handle the modal submission for bio setup
export async function handlePenguBookBioSetup(i) {
    await i.deferReply({ ephemeral: true });
    const bio = i.fields.getTextInputValue("bio");
    const xUsername = i.fields.getTextInputValue("x_username") || null;
    // Validate X username format if provided
    let cleanXUsername = null;
    if (xUsername) {
        cleanXUsername = xUsername.replace(/^@/, "");
        if (!/^[A-Za-z0-9_]{1,15}$/.test(cleanXUsername)) {
            return i.editReply({
                content: "❌ Invalid X username format! Use only letters, numbers, and underscores (max 15 chars)."
            });
        }
    }
    try {
        // Add timeout protection for database operations
        const dbTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Database operation timeout')), 3000));
        const user = await Promise.race([
            findOrCreateUser(i.user.id),
            dbTimeout
        ]);
        await Promise.race([
            prisma.user.update({
                where: { id: user.id },
                data: {
                    bio,
                    xUsername: cleanXUsername,
                    bioLastUpdated: new Date(),
                    showInPenguBook: true
                }
            }),
            dbTimeout
        ]);
        const embed = new EmbedBuilder()
            .setColor(0x00ff88)
            .setTitle("<a:PenguHahaha:1415468831425691770> Welcome to PenguBook!")
            .setDescription("<a:Pengu_Chatting:1415469907835097161> Your profile has been created successfully!")
            .addFields({ name: "📝 Your Bio", value: bio, inline: false }, ...(cleanXUsername ? [{ name: "🐦 X/Twitter", value: `@${cleanXUsername}`, inline: true }] : []))
            .setFooter({ text: "Your profile is now discoverable by the community!" });
        const buttons = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId("pip:pengubook_browse")
            .setLabel("📖 Browse PenguBook")
            .setStyle(ButtonStyle.Primary), new ButtonBuilder()
            .setCustomId("pip:bio_view_own")
            .setLabel("👀 View My Profile")
            .setStyle(ButtonStyle.Secondary));
        return i.editReply({ embeds: [embed], components: [buttons] });
    }
    catch (error) {
        console.error("Error in PenguBook bio setup:", error);
        return i.editReply({
            content: "❌ Failed to create your profile. Please try again later."
        });
    }
}
// Handle tip modal submission from PenguBook
export async function handleTipModal(i, parts) {
    const targetDiscordId = parts[2];
    const amount = parseFloat(i.fields.getTextInputValue("amount"));
    const tokenSymbol = i.fields.getTextInputValue("token").toUpperCase();
    const note = i.fields.getTextInputValue("note") || null;
    try {
        // Import the tip processing function and get active tokens
        const { processTip } = await import("../../services/tip_processor.js");
        const { getActiveTokens } = await import("../../services/token.js");
        const { getDiscordClient } = await import("../../services/discord_users.js");
        await i.deferReply({ ephemeral: true });
        // Find the token by symbol
        const tokens = await getActiveTokens();
        const token = tokens.find(t => t.symbol.toUpperCase() === tokenSymbol);
        if (!token) {
            return i.editReply({
                content: `❌ **Invalid token:** ${tokenSymbol}. Available tokens: ${tokens.map(t => t.symbol).join(", ")}`
            });
        }
        // Get Discord client
        const client = getDiscordClient();
        if (!client) {
            return i.editReply({
                content: `❌ **System error:** Discord client not available`
            });
        }
        // Process the tip using existing tip logic with PenguBook context
        const tipData = {
            amount,
            tipType: "direct",
            targetUserId: targetDiscordId,
            note: note || "",
            tokenId: token.id,
            userId: i.user.id,
            guildId: i.guildId,
            channelId: i.channelId,
            // Add context that this is from PenguBook
            fromPenguBook: true
        };
        const result = await processTip(tipData, client);
        if (result.success) {
            return i.editReply({
                content: `✅ **${result.message}**\n${result.details || ""}\n\n💬 *Your message was delivered to their PenguBook inbox!*`
            });
        }
        else {
            return i.editReply({
                content: `❌ **Tip failed:** ${result.message}`
            });
        }
    }
    catch (error) {
        console.error("Error processing tip from PenguBook:", error);
        return i.editReply({
            content: `❌ **Tip failed:** ${error?.message || String(error)}`
        });
    }
}
// Handle viewing a specific user's profile from PenguBook
// Handle PenguBook inbox view
export async function handlePenguBookInbox(i) {
    await i.deferReply({ ephemeral: true });
    try {
        const user = await findOrCreateUser(i.user.id);
        // Get messages with sender info and pagination
        const MESSAGES_PER_PAGE = 5;
        const messages = await prisma.penguBookMessage.findMany({
            where: { toUserId: user.id },
            include: {
                from: { select: { discordId: true } },
                tip: {
                    select: {
                        amountAtomic: true,
                        Token: { select: { symbol: true, decimals: true } }
                    }
                }
            },
            orderBy: { createdAt: "desc" },
            take: MESSAGES_PER_PAGE
        });
        if (messages.length === 0) {
            return i.editReply({
                content: "📬 **Your PenguBook Inbox**\n\n*No messages yet! When someone sends you a tip with a message from PenguBook, it will appear here.*"
            });
        }
        // Get sender usernames
        const senderIds = messages.map(m => m.from.discordId);
        let senderData = new Map();
        try {
            const client = getDiscordClient();
            if (client) {
                senderData = await fetchMultipleUserData(client, senderIds);
            }
        }
        catch (error) {
            console.warn("Failed to fetch sender data for inbox:", error);
        }
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("📬 Your PenguBook Inbox")
            .setDescription(`You have ${messages.length} recent messages`)
            .setTimestamp();
        // Add messages as fields
        for (const message of messages) {
            const senderInfo = senderData.get(message.from.discordId);
            const senderName = senderInfo?.username || `User ${message.from.discordId.slice(0, 8)}...`;
            const isNew = !message.read ? "✨ **NEW** " : "";
            let tipInfo = "";
            if (message.tip) {
                // Simple amount formatting without requiring full TokenRow
                const atomicAmount = BigInt(message.tip.amountAtomic.toString());
                const decimals = message.tip.Token.decimals;
                const divisor = BigInt(10 ** decimals);
                const amount = Number(atomicAmount) / Number(divisor);
                tipInfo = ` (with ${amount} ${message.tip.Token.symbol} tip)`;
            }
            const timeAgo = `<t:${Math.floor(message.createdAt.getTime() / 1000)}:R>`;
            embed.addFields({
                name: `${isNew}💬 From ${senderName}${tipInfo}`,
                value: `"${message.message}"\n*${timeAgo}*`,
                inline: false
            });
        }
        // Mark all displayed messages as read
        if (messages.some(m => !m.read)) {
            await prisma.penguBookMessage.updateMany({
                where: {
                    id: { in: messages.map(m => m.id) },
                    read: false
                },
                data: { read: true }
            });
        }
        const buttons = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId("pip:pengubook_inbox_refresh")
            .setLabel("🔄 Refresh")
            .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
            .setCustomId("pip:pengubook_browse")
            .setLabel("📖 Browse PenguBook")
            .setStyle(ButtonStyle.Primary));
        return i.editReply({
            embeds: [embed],
            components: [buttons]
        });
    }
    catch (error) {
        console.error("Error showing PenguBook inbox:", error);
        return i.editReply({
            content: "❌ Failed to load your inbox. Please try again later."
        });
    }
}
export async function handlePenguBookProfile(i, targetDiscordId) {
    await i.deferReply({ ephemeral: true });
    try {
        // Get the target user's profile
        const profile = await prisma.user.findUnique({
            where: { discordId: targetDiscordId },
            select: {
                discordId: true,
                bio: true,
                xUsername: true,
                bioViewCount: true,
                bioLastUpdated: true,
                allowTipsFromBook: true,
                showInPenguBook: true,
                wins: true,
                losses: true,
                ties: true,
                createdAt: true,
                _count: {
                    select: {
                        tipsSent: true,
                        tipsReceived: true
                    }
                }
            }
        });
        if (!profile || !profile.bio || !profile.showInPenguBook) {
            return i.editReply({
                content: "❌ This profile is not available or has been made private."
            });
        }
        // Fetch Discord user data
        let userInfo = {
            username: `User ${profile.discordId.slice(0, 8)}...`,
            avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(profile.discordId.slice(-1)) % 6}.png`
        };
        try {
            const client = getDiscordClient();
            if (client) {
                const userData = await fetchMultipleUserData(client, [profile.discordId]);
                userInfo = userData.get(profile.discordId) || userInfo;
            }
        }
        catch (error) {
            console.warn("Failed to fetch user data for profile view:", error);
        }
        // Create detailed profile embed
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`👤 ${userInfo.username}'s Profile`)
            .setThumbnail(userInfo.avatarURL)
            .setDescription(profile.bio)
            .addFields({ name: "🎮 Game Record", value: `${profile.wins}W ${profile.losses}L ${profile.ties}T`, inline: true }, { name: "👀 Profile Views", value: profile.bioViewCount.toString(), inline: true }, { name: "💌 Tips Sent", value: profile._count.tipsSent.toString(), inline: true }, { name: "🎁 Tips Received", value: profile._count.tipsReceived.toString(), inline: true }, ...(profile.xUsername ? [{ name: "🐦 X/Twitter", value: `[@${profile.xUsername}](https://x.com/${profile.xUsername})`, inline: true }] : []), ...(profile.bioLastUpdated ? [{ name: "📅 Last Updated", value: `<t:${Math.floor(profile.bioLastUpdated.getTime() / 1000)}:R>`, inline: true }] : []))
            .setFooter({ text: `Member since ${profile.createdAt.toLocaleDateString()}` });
        // Create action buttons
        const buttons = new ActionRowBuilder();
        if (profile.allowTipsFromBook && profile.discordId !== i.user.id) {
            buttons.addComponents(new ButtonBuilder()
                .setCustomId(`pip:tip_from_book:${profile.discordId}`)
                .setLabel("Send Tip")
                .setStyle(ButtonStyle.Success)
                .setEmoji("<a:PenguSipJuice:1415470745491996673>"));
        }
        // Track that user viewed this profile
        if (profile.discordId !== i.user.id) {
            try {
                const viewerUser = await findOrCreateUser(i.user.id);
                const profileUser = await findOrCreateUser(profile.discordId);
                // Increment view count
                await prisma.user.update({
                    where: { discordId: profile.discordId },
                    data: { bioViewCount: { increment: 1 } }
                });
                // Track browsing
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
                        createdAt: new Date()
                    }
                });
            }
            catch (error) {
                console.warn("Failed to track profile view:", error);
            }
        }
        return i.editReply({
            embeds: [embed],
            components: buttons.components.length > 0 ? [buttons] : []
        });
    }
    catch (error) {
        console.error("Error viewing PenguBook profile:", error);
        return i.editReply({
            content: "❌ Failed to load profile. Please try again later."
        });
    }
}
