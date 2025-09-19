import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../services/db.js";
import { findOrCreateUser } from "../services/user_helpers.js";
import { fetchMultipleUsernames, fetchMultipleUserData, getDiscordClient } from "../services/discord_users.js";

const PROFILES_PER_PAGE = 1; // One profile per page for better readability

export default async function pipPenguBook(i: ChatInputCommandInteraction) {
  const mode = i.options.getString("mode", false) || "recent";
  const page = Math.max(1, i.options.getInteger("page", false) || 1);
  
  await i.reply({
    content: "📖 **Loading PenguBook...** \n⏳ *Gathering profiles for you*",
    flags: 64
  });
  
  try {
    let profiles: any[] = [];
    let totalCount = 0;
    
    // Get total count of profiles
    totalCount = await prisma.user.count({
      where: {
        bio: { not: null },
        showInPenguBook: true
      }
    });
    
    if (totalCount === 0) {
      return i.editReply({
        content: "📖 **PenguBook is empty!** \nBe the first to create a profile with `/pip_bio set`"
      });
    }
    
    const totalPages = Math.ceil(totalCount / PROFILES_PER_PAGE);
    const offset = (page - 1) * PROFILES_PER_PAGE;
    
    // Fetch profiles based on mode
    switch (mode) {
      case "recent":
        profiles = await prisma.user.findMany({
          where: {
            bio: { not: null },
            showInPenguBook: true
          },
          select: {
            discordId: true,
            bio: true,
            xUsername: true,
            bioViewCount: true,
            bioLastUpdated: true,
            allowTipsFromBook: true,
            _count: {
              select: {
                tipsSent: true,
                tipsReceived: true
              }
            }
          },
          orderBy: { bioLastUpdated: "desc" },
          skip: offset,
          take: PROFILES_PER_PAGE
        });
        break;
        
      case "popular":
        profiles = await prisma.user.findMany({
          where: {
            bio: { not: null },
            showInPenguBook: true
          },
          select: {
            discordId: true,
            bio: true,
            xUsername: true,
            bioViewCount: true,
            bioLastUpdated: true,
            allowTipsFromBook: true,
            _count: {
              select: {
                tipsSent: true,
                tipsReceived: true
              }
            }
          },
          orderBy: { bioViewCount: "desc" },
          skip: offset,
          take: PROFILES_PER_PAGE
        });
        break;
        
      case "random":
        // For random, we'll get a random offset
        const randomOffset = Math.floor(Math.random() * Math.max(1, totalCount - PROFILES_PER_PAGE + 1));
        profiles = await prisma.user.findMany({
          where: {
            bio: { not: null },
            showInPenguBook: true
          },
          select: {
            discordId: true,
            bio: true,
            xUsername: true,
            bioViewCount: true,
            bioLastUpdated: true,
            allowTipsFromBook: true,
            _count: {
              select: {
                tipsSent: true,
                tipsReceived: true
              }
            }
          },
          skip: randomOffset,
          take: PROFILES_PER_PAGE
        });
        break;
    }
    
    if (profiles.length === 0) {
      return i.editReply({
        content: `📖 **No profiles found on page ${page}!** \nTry a different page or mode.`
      });
    }
    
    // Fetch Discord usernames and avatars
    const discordIds = profiles.map(p => p.discordId);
    let userData = new Map<string, { username: string, avatarURL: string }>();
    
    try {
      const client = getDiscordClient();
      if (client) {
        userData = await fetchMultipleUserData(client, discordIds);
      }
    } catch (error) {
      console.warn("Failed to fetch user data for PenguBook:", error);
    }
    
    // Create embed for the current profile
    const profile = profiles[0];
    const userInfo = userData.get(profile.discordId) || { 
      username: `User ${profile.discordId.slice(0, 8)}...`,
      avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(profile.discordId.slice(-1)) % 6}.png`
    };
    
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("<a:NerdPengu:1415469352660107324> PenguBook")
      .setAuthor({ 
        name: `<a:Pengu_Chatting:1415469907835097161> ${userInfo.username}`,
        iconURL: userInfo.avatarURL
      })
      .setThumbnail(userInfo.avatarURL) // Also add as thumbnail for larger display
      .setDescription(profile.bio)
      .addFields(
        { name: "👀 Profile Views", value: profile.bioViewCount.toString(), inline: true },
        { name: "💌 Tips Sent", value: profile._count.tipsSent.toString(), inline: true },
        { name: "🎁 Tips Received", value: profile._count.tipsReceived.toString(), inline: true },
        ...(profile.xUsername ? [{ name: "🐦 X/Twitter", value: `[@${profile.xUsername}](https://x.com/${profile.xUsername})`, inline: true }] : []),
        ...(profile.bioLastUpdated ? [{ name: "📅 Last Updated", value: `<t:${Math.floor(profile.bioLastUpdated.getTime() / 1000)}:R>`, inline: true }] : [])
      )
      .setFooter({ 
        text: `Page ${page} of ${totalPages} • ${totalCount} profiles • Mode: ${mode}` 
      });
    
    // Create navigation and action buttons
    const navButtons = new ActionRowBuilder<ButtonBuilder>();
    const actionButtons = new ActionRowBuilder<ButtonBuilder>();
    
    // Navigation buttons
    if (page > 1) {
      navButtons.addComponents(
        new ButtonBuilder()
          .setCustomId(`pip:pengubook_nav:${mode}:${page - 1}`)
          .setLabel("← Previous")
          .setStyle(ButtonStyle.Secondary)
      );
    }
    
    if (page < totalPages) {
      navButtons.addComponents(
        new ButtonBuilder()
          .setCustomId(`pip:pengubook_nav:${mode}:${page + 1}`)
          .setLabel("Next →")
          .setStyle(ButtonStyle.Secondary)
      );
    }
    
    navButtons.addComponents(
      new ButtonBuilder()
        .setCustomId(`pip:pengubook_nav:random:1`)
        .setLabel("🎲 Random")
        .setStyle(ButtonStyle.Primary)
    );
    
    // Action buttons
    if (profile.allowTipsFromBook && profile.discordId !== i.user.id) {
      actionButtons.addComponents(
        new ButtonBuilder()
          .setCustomId(`pip:tip_from_book:${profile.discordId}`)
          .setLabel("Send Tip")
          .setStyle(ButtonStyle.Success)
          .setEmoji("<a:PenguSipJuice:1415470745491996673>")
      );
    }
    
    actionButtons.addComponents(
      new ButtonBuilder()
        .setCustomId(`pip:pengubook_profile:${profile.discordId}`)
        .setLabel("👀 View Full Profile")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setURL(`${process.env.WEB_BASE_URL || 'http://localhost:3000'}/pengubook`)
        .setLabel("🌐 Open in Browser")
        .setStyle(ButtonStyle.Link)
        .setEmoji("💻"),
      new ButtonBuilder()
        .setCustomId("pip:pengubook_modes")
        .setLabel("Browse Modes")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("<a:Pengu_Jamming:1415471056881455314>")
    );
    
    // Track that user is browsing (if viewing someone else's profile)
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
      } catch (error) {
        console.warn("Failed to track PenguBook browsing:", error);
      }
    }
    
    const components = [actionButtons];
    if (navButtons.components.length > 0) {
      components.unshift(navButtons);
    }
    
    return i.editReply({
      content: null,
      embeds: [embed],
      components
    });
    
  } catch (error) {
    console.error("Error loading PenguBook:", error);
    return i.editReply({
      content: "❌ Failed to load PenguBook. Please try again later."
    });
  }
}