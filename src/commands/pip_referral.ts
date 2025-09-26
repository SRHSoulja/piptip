// src/commands/pip_referral.ts - Referral system commands
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../services/db.js";
import { findOrCreateUser } from "../services/user_helpers.js";
import { createReferralCode, useReferralCode, getReferralStats } from "../services/referrals.js";
import { getConfig } from "../config.js";

export const data = new SlashCommandBuilder()
  .setName("pip_referral")
  .setDescription("Manage your referral code and see your referral stats")
  .addSubcommand(subcommand =>
    subcommand
      .setName("code")
      .setDescription("Get your referral code to share with friends")
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName("use")
      .setDescription("Use a friend's referral code")
      .addStringOption(option =>
        option
          .setName("code")
          .setDescription("The referral code from your friend")
          .setRequired(true)
          .setMaxLength(20)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName("stats")
      .setDescription("View your referral statistics and rewards")
  );

export default async function execute(i: ChatInputCommandInteraction) {
  const subcommand = i.options.getSubcommand();

  switch (subcommand) {
    case "code":
      await handleGetReferralCode(i);
      break;
    case "use":
      await handleUseReferralCode(i);
      break;
    case "stats":
      await handleReferralStats(i);
      break;
  }
}

async function handleGetReferralCode(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });

  try {
    const user = await findOrCreateUser(i.user.id);

    // Check if user already has a referral code
    let referral = await prisma.referral.findFirst({
      where: { referrerId: user.id }
    });

    let referralCode: string;
    if (referral) {
      referralCode = referral.referralCode;
    } else {
      // Create new referral code
      referralCode = await createReferralCode(i.user.id);
    }

    // Get current stats and config
    const stats = await getReferralStats(i.user.id);
    const config = await getConfig();
    const rewardInterval = config.referralRewardInterval;

    const embed = new EmbedBuilder()
      .setTitle("🔗 Your Referral Code")
      .setDescription(
        `Share this code with friends to earn rewards when they join and tip!\n\n` +
        `**Your Referral Code:** \`${referralCode}\`\n\n` +
        `📊 **Your Stats:**\n` +
        `• **Referrals:** ${stats.totalReferrals}\n` +
        `• **Verified Referrals:** ${stats.verifiedReferrals}\n` +
        `• **Pending Referrals:** ${stats.pendingReferrals.length}\n\n` +
        `💰 **Benefits:**\n` +
        `• Earn 1-week tax-free membership every ${rewardInterval} verified referrals\n` +
        `• Achievement badges for referral milestones\n` +
        `• Help grow the PIPtip community!`
      )
      .setColor(0x00FF00)
      .setFooter({ text: "Friends can use your code with /pip_referral use" })
      .setTimestamp();

    const shareButton = new ButtonBuilder()
      .setCustomId("referral:share")
      .setLabel("📋 Copy Code")
      .setStyle(ButtonStyle.Secondary);

    const actionRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(shareButton);

    await i.editReply({
      embeds: [embed],
      components: [actionRow]
    });

  } catch (error: any) {
    console.error("Referral code error:", error);
    await i.editReply({
      content: `❌ **Failed to get referral code**\n${error?.message || String(error)}`
    });
  }
}

async function handleUseReferralCode(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });

  try {
    const code = i.options.getString("code", true).trim().toUpperCase();
    const result = await useReferralCode(i.user.id, code);

    if (result.success) {
      const config = await getConfig();
      const taxReductionPercent = (config.referralTaxReductionBps / 100).toFixed(1);
      const rakeReductionPercent = (config.referralRakeReductionBps / 100).toFixed(1);
      const verificationThreshold = Number(config.referralVerificationThreshold);
      const welcomeBonus = Number(config.referralWelcomeBonus);

      const embed = new EmbedBuilder()
        .setTitle("🎉 Referral Code Applied!")
        .setDescription(
          `Welcome to the PIPtip family! You've successfully used referral code: \`${code}\`\n\n` +
          `🎁 **Benefits Unlocked:**\n` +
          (Number(taxReductionPercent) > 0 ? `• ${taxReductionPercent}% tip fee reduction for your first ${verificationThreshold} tokens tipped\n` : '') +
          (Number(rakeReductionPercent) > 0 ? `• ${rakeReductionPercent}% game rake reduction for your first ${verificationThreshold} tokens tipped\n` : '') +
          (welcomeBonus > 0 ? `• ${welcomeBonus} token welcome bonus on your first tip\n` : '') +
          `• Access to exclusive referral rewards\n\n` +
          `💡 **Next Steps:**\n` +
          `• Try your first tip with \`/pip_tip\`\n` +
          `• Get your own referral code with \`/pip_referral code\``
        )
        .setColor(0x00FF00)
        .setFooter({ text: "Start tipping to activate your benefits!" })
        .setTimestamp();

      await i.editReply({ embeds: [embed] });
    } else {
      await i.editReply({
        content: `❌ **${result.message}**`
      });
    }

  } catch (error: any) {
    console.error("Use referral code error:", error);
    await i.editReply({
      content: `❌ **Failed to use referral code**\n${error?.message || String(error)}`
    });
  }
}

async function handleReferralStats(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });

  try {
    const stats = await getReferralStats(i.user.id);
    const detailedStats = await prisma.referral.findFirst({
      where: { referrerId: (await findOrCreateUser(i.user.id)).id }
    });

    let description = "";

    if (!detailedStats) {
      description = "You haven't created a referral code yet!\nUse `/pip_referral code` to get started.";
    } else {
      description =
        `**Your Referral Code:** \`${detailedStats.referralCode}\`\n\n` +
        `📈 **Statistics:**\n` +
        `• **Total Referrals:** ${stats.totalReferrals}\n` +
        `• **Verified Referrals:** ${stats.verifiedReferrals}\n` +
        `• **Pending Referrals:** ${stats.pendingReferrals.length}\n` +
        `• **Code Created:** <t:${Math.floor(detailedStats.createdAt.getTime() / 1000)}:R>\n\n` +
        `💰 **Progress:**\n` +
        `• **Until Next Tax-Free Week:** ${stats.referralsUntilTaxFree} referrals\n` +
        `• **Tax-Free Weeks Earned:** ${stats.taxFreeWeeksEarned}\n\n`;

      if (stats.pendingReferrals.length > 0) {
        description += `⏳ **Pending Referrals:**\n`;
        stats.pendingReferrals.forEach((pending, index) => {
          description += `${index + 1}. Progress: ${pending.progress}/${pending.needed + pending.progress} tokens (joined ${pending.joinedAt.toLocaleDateString()})\n`;
        });
      } else {
        description += `💡 **Get Started:** Share your code to earn rewards!`;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("📊 Your Referral Statistics")
      .setDescription(description)
      .setColor(0x0099FF)
      .setFooter({ text: "Keep sharing to earn more rewards!" })
      .setTimestamp();

    const buttons = [];

    if (detailedStats) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId("referral:share")
          .setLabel("📋 Copy Code")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    buttons.push(
      new ButtonBuilder()
        .setCustomId("referral:leaderboard")
        .setLabel("🏆 Leaderboard")
        .setStyle(ButtonStyle.Primary)
    );

    const actionRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(...buttons);

    await i.editReply({
      embeds: [embed],
      components: [actionRow]
    });

  } catch (error: any) {
    console.error("Referral stats error:", error);
    await i.editReply({
      content: `❌ **Failed to get referral stats**\n${error?.message || String(error)}`
    });
  }
}