import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../services/db.js";
import { findOrCreateUser } from "../services/user_helpers.js";
async function pipBio(i) {
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
  if (bio.length > 500) {
    return i.reply({
      content: "\u274C Bio too long! Maximum 500 characters allowed.",
      flags: 64
    });
  }
  let cleanXUsername = null;
  if (xUsername) {
    cleanXUsername = xUsername.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,15}$/.test(cleanXUsername)) {
      return i.reply({
        content: "\u274C Invalid X username format! Use only letters, numbers, and underscores (max 15 chars).",
        flags: 64
      });
    }
  }
  try {
    const user = await findOrCreateUser(i.user.id);
    const wasInPenguBook = user.showInPenguBook;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        bio,
        xUsername: cleanXUsername,
        bioLastUpdated: /* @__PURE__ */ new Date(),
        showInPenguBook: true
        // Auto-enable when setting bio
      }
    });
    if (!wasInPenguBook) {
      try {
        await prisma.activityFeedItem.create({
          data: {
            userId: user.id,
            type: "join",
            data: {
              userHandle: `User#${i.user.id.slice(-4)}`,
              firstBio: bio.substring(0, 50) + (bio.length > 50 ? "..." : "")
            },
            visibility: "public"
          }
        });
      } catch (error) {
        console.error("Failed to create activity feed item for new user join:", error);
      }
    }
    const embed = new EmbedBuilder().setColor(65416).setTitle("\u2705 Bio Updated!").setDescription(`Your PenguBook profile has been updated!`).addFields(
      { name: "\u{1F4DD} Bio", value: bio, inline: false },
      ...cleanXUsername ? [{ name: "\u{1F426} X/Twitter", value: `@${cleanXUsername}`, inline: true }] : []
    ).setFooter({ text: "Your profile is now visible in PenguBook!" });
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pip_pengubook_browse").setLabel("\u{1F4D6} Browse PenguBook").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("pip_bio_view_own").setLabel("\u{1F440} View My Profile").setStyle(ButtonStyle.Secondary)
    );
    return i.reply({ embeds: [embed], components: [buttons], flags: 64 });
  } catch (error) {
    console.error("Error setting bio:", error);
    return i.reply({
      content: "\u274C Failed to update bio. Please try again later.",
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
      const isOwnProfile2 = userId === i.user.id;
      return i.reply({
        content: isOwnProfile2 ? "\u{1F4DD} You haven't set a bio yet! Use `/pip_bio set` to create your PenguBook profile." : "\u{1F4DD} This user hasn't set up their PenguBook profile yet.",
        flags: 64
      });
    }
    if (!user.showInPenguBook && userId !== i.user.id) {
      return i.reply({
        content: "\u{1F512} This user has disabled their PenguBook profile.",
        flags: 64
      });
    }
    const isOwnProfile = userId === i.user.id;
    if (!isOwnProfile) {
      const viewerUser = await findOrCreateUser(i.user.id);
      const profileUser = await findOrCreateUser(userId);
      await prisma.user.update({
        where: { discordId: userId },
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
          // Update timestamp for recent view
        }
      });
    }
    const displayName = targetUser ? targetUser.username : i.user.username;
    const embed = new EmbedBuilder().setColor(5793266).setTitle(`\u{1F4D6} ${displayName}'s PenguBook Profile`).setDescription(user.bio).addFields(
      { name: "\u{1F440} Profile Views", value: user.bioViewCount.toString(), inline: true },
      ...user.xUsername ? [{ name: "\u{1F426} X/Twitter", value: `[@${user.xUsername}](https://x.com/${user.xUsername})`, inline: true }] : [],
      ...user.bioLastUpdated ? [{ name: "\u{1F4C5} Last Updated", value: `<t:${Math.floor(user.bioLastUpdated.getTime() / 1e3)}:R>`, inline: true }] : []
    );
    const buttons = new ActionRowBuilder();
    if (!isOwnProfile && user.allowTipsFromBook) {
      buttons.addComponents(
        new ButtonBuilder().setCustomId(`pip_tip_from_book:${userId}`).setLabel("\u{1F4B0} Send Tip").setStyle(ButtonStyle.Success)
      );
    }
    buttons.addComponents(
      new ButtonBuilder().setCustomId("pip_pengubook_browse").setLabel("\u{1F4D6} Browse More Profiles").setStyle(ButtonStyle.Primary)
    );
    return i.reply({ embeds: [embed], components: [buttons], flags: 64 });
  } catch (error) {
    console.error("Error viewing bio:", error);
    return i.reply({
      content: "\u274C Failed to load profile. Please try again later.",
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
      content: "\u2705 Your bio has been cleared and you've been removed from PenguBook.",
      flags: 64
    });
  } catch (error) {
    console.error("Error clearing bio:", error);
    return i.reply({
      content: "\u274C Failed to clear bio. Please try again later.",
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
        content: "\u{1F4DD} You need to set a bio first! Use `/pip_bio set` to create your profile.",
        flags: 64
      });
    }
    const embed = new EmbedBuilder().setColor(5793266).setTitle("\u2699\uFE0F PenguBook Settings").setDescription("Manage your PenguBook profile settings:").addFields(
      { name: "\u{1F4D6} Show in PenguBook", value: user.showInPenguBook ? "\u2705 Enabled" : "\u274C Disabled", inline: true },
      { name: "\u{1F4B0} Allow Tips from Book", value: user.allowTipsFromBook ? "\u2705 Enabled" : "\u274C Disabled", inline: true }
    );
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pip_bio_toggle:showInPenguBook:${!user.showInPenguBook}`).setLabel(user.showInPenguBook ? "Hide from PenguBook" : "Show in PenguBook").setStyle(user.showInPenguBook ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`pip_bio_toggle:allowTipsFromBook:${!user.allowTipsFromBook}`).setLabel(user.allowTipsFromBook ? "Disable Tips" : "Enable Tips").setStyle(user.allowTipsFromBook ? ButtonStyle.Danger : ButtonStyle.Success)
    );
    return i.reply({ embeds: [embed], components: [buttons], flags: 64 });
  } catch (error) {
    console.error("Error showing bio settings:", error);
    return i.reply({
      content: "\u274C Failed to load settings. Please try again later.",
      flags: 64
    });
  }
}
export {
  pipBio as default
};
//# sourceMappingURL=pip_bio.js.map
