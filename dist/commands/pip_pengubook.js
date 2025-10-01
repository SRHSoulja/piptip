import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../services/db.js";
import { findOrCreateUser } from "../services/user_helpers.js";
import { fetchMultipleUserData, getDiscordClient } from "../services/discord_users.js";
const PROFILES_PER_PAGE = 1;
async function pipPenguBook(i) {
  const mode = i.options.getString("mode", false) || "recent";
  const page = Math.max(1, i.options.getInteger("page", false) || 1);
  await i.reply({
    content: "\u{1F4D6} **Loading PenguBook...** \n\u23F3 *Gathering profiles for you*",
    flags: 64
  });
  try {
    let profiles = [];
    let totalCount = 0;
    totalCount = await prisma.user.count({
      where: {
        bio: { not: null },
        showInPenguBook: true
      }
    });
    if (totalCount === 0) {
      return i.editReply({
        content: "\u{1F4D6} **PenguBook is empty!** \nBe the first to create a profile with `/pip_bio set`"
      });
    }
    const totalPages = Math.ceil(totalCount / PROFILES_PER_PAGE);
    const offset = (page - 1) * PROFILES_PER_PAGE;
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
        content: `\u{1F4D6} **No profiles found on page ${page}!** 
Try a different page or mode.`
      });
    }
    const discordIds = profiles.map((p) => p.discordId);
    let userData = /* @__PURE__ */ new Map();
    try {
      const client = getDiscordClient();
      if (client) {
        userData = await fetchMultipleUserData(client, discordIds);
      }
    } catch (error) {
      console.warn("Failed to fetch user data for PenguBook:", error);
    }
    const profile = profiles[0];
    const userInfo = userData.get(profile.discordId) || {
      username: `User ${profile.discordId.slice(0, 8)}...`,
      avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(profile.discordId.slice(-1)) % 6}.png`
    };
    const embed = new EmbedBuilder().setColor(5793266).setTitle("<a:NerdPengu:1415469352660107324> PenguBook").setAuthor({
      name: `<a:Pengu_Chatting:1415469907835097161> ${userInfo.username}`,
      iconURL: userInfo.avatarURL
    }).setThumbnail(userInfo.avatarURL).setDescription(profile.bio).addFields(
      { name: "\u{1F440} Profile Views", value: profile.bioViewCount.toString(), inline: true },
      { name: "\u{1F48C} Tips Sent", value: profile._count.tipsSent.toString(), inline: true },
      { name: "\u{1F381} Tips Received", value: profile._count.tipsReceived.toString(), inline: true },
      ...profile.xUsername ? [{ name: "\u{1F426} X/Twitter", value: `[@${profile.xUsername}](https://x.com/${profile.xUsername})`, inline: true }] : [],
      ...profile.bioLastUpdated ? [{ name: "\u{1F4C5} Last Updated", value: `<t:${Math.floor(profile.bioLastUpdated.getTime() / 1e3)}:R>`, inline: true }] : []
    ).setFooter({
      text: `Page ${page} of ${totalPages} \u2022 ${totalCount} profiles \u2022 Mode: ${mode}`
    });
    const navButtons = new ActionRowBuilder();
    const actionButtons = new ActionRowBuilder();
    if (page > 1) {
      navButtons.addComponents(
        new ButtonBuilder().setCustomId(`pip:pengubook_nav:${mode}:${page - 1}`).setLabel("\u2190 Previous").setStyle(ButtonStyle.Secondary)
      );
    }
    if (page < totalPages) {
      navButtons.addComponents(
        new ButtonBuilder().setCustomId(`pip:pengubook_nav:${mode}:${page + 1}`).setLabel("Next \u2192").setStyle(ButtonStyle.Secondary)
      );
    }
    navButtons.addComponents(
      new ButtonBuilder().setCustomId(`pip:pengubook_nav:random:1`).setLabel("\u{1F3B2} Random").setStyle(ButtonStyle.Primary)
    );
    if (profile.allowTipsFromBook && profile.discordId !== i.user.id) {
      actionButtons.addComponents(
        new ButtonBuilder().setCustomId(`pip:tip_from_book:${profile.discordId}`).setLabel("Send Tip").setStyle(ButtonStyle.Success).setEmoji("<a:PenguSipJuice:1415470745491996673>")
      );
    }
    actionButtons.addComponents(
      new ButtonBuilder().setCustomId(`pip:pengubook_profile:${profile.discordId}`).setLabel("\u{1F440} View Full Profile").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setURL(`${process.env.PUBLIC_BASE_URL || "http://localhost:3000"}/pengubook`).setLabel("Open in Browser").setStyle(ButtonStyle.Link).setEmoji("<a:NerdPengu:1415469352660107324>"),
      new ButtonBuilder().setCustomId("pip:pengubook_modes").setLabel("Browse Modes").setStyle(ButtonStyle.Primary).setEmoji("<a:Pengu_Jamming:1415471056881455314>"),
      new ButtonBuilder().setCustomId("pip:back_to_profile").setLabel("\u{1F464} Back to Profile").setStyle(ButtonStyle.Secondary)
    );
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
          create: {
            viewerId: viewerUser.id,
            profileId: profileUser.id
          },
          update: {
            createdAt: /* @__PURE__ */ new Date()
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
      content: "\u274C Failed to load PenguBook. Please try again later."
    });
  }
}
export {
  pipPenguBook as default
};
//# sourceMappingURL=pip_pengubook.js.map
