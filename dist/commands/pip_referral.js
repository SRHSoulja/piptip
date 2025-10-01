import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../services/db.js";
import { findOrCreateUser } from "../services/user_helpers.js";
import { createReferralCode, useReferralCode, getReferralStats } from "../services/referrals.js";
import { getConfig } from "../config.js";
const data = new SlashCommandBuilder().setName("pip_referral").setDescription("Manage your referral code and see your referral stats").addSubcommand(
  (subcommand) => subcommand.setName("code").setDescription("Get your referral code to share with friends")
).addSubcommand(
  (subcommand) => subcommand.setName("use").setDescription("Use a friend's referral code").addStringOption(
    (option) => option.setName("code").setDescription("The referral code from your friend").setRequired(true).setMaxLength(20)
  )
).addSubcommand(
  (subcommand) => subcommand.setName("stats").setDescription("View your referral statistics and rewards")
);
async function execute(i) {
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
async function handleGetReferralCode(i) {
  await i.deferReply({ ephemeral: true });
  try {
    const user = await findOrCreateUser(i.user.id);
    let referral = await prisma.referral.findFirst({
      where: { referrerId: user.id }
    });
    let referralCode;
    if (referral) {
      referralCode = referral.referralCode;
    } else {
      referralCode = await createReferralCode(i.user.id);
    }
    const stats = await getReferralStats(i.user.id);
    const config = await getConfig();
    const rewardInterval = config.referralRewardInterval;
    const embed = new EmbedBuilder().setTitle("\u{1F517} Your Referral Code").setDescription(
      `Share this code with friends to earn rewards when they join and tip!

**Your Referral Code:** \`${referralCode}\`

\u{1F4CA} **Your Stats:**
\u2022 **Referrals:** ${stats.totalReferrals}
\u2022 **Verified Referrals:** ${stats.verifiedReferrals}
\u2022 **Pending Referrals:** ${stats.pendingReferrals.length}

\u{1F4B0} **Benefits:**
\u2022 Earn 1-week tax-free membership every ${rewardInterval} verified referrals
\u2022 Achievement badges for referral milestones
\u2022 Help grow the PIPtip community!`
    ).setColor(65280).setFooter({ text: "Friends can use your code with /pip_referral use" }).setTimestamp();
    const shareButton = new ButtonBuilder().setCustomId("referral:share").setLabel("\u{1F4CB} Copy Code").setStyle(ButtonStyle.Secondary);
    const actionRow = new ActionRowBuilder().addComponents(shareButton);
    await i.editReply({
      embeds: [embed],
      components: [actionRow]
    });
  } catch (error) {
    console.error("Referral code error:", error);
    await i.editReply({
      content: `\u274C **Failed to get referral code**
${error?.message || String(error)}`
    });
  }
}
async function handleUseReferralCode(i) {
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
      const embed = new EmbedBuilder().setTitle("\u{1F389} Referral Code Applied!").setDescription(
        `Welcome to the PIPtip family! You've successfully used referral code: \`${code}\`

\u{1F381} **Benefits Unlocked:**
` + (Number(taxReductionPercent) > 0 ? `\u2022 ${taxReductionPercent}% tip fee reduction for your first ${verificationThreshold} tokens tipped
` : "") + (Number(rakeReductionPercent) > 0 ? `\u2022 ${rakeReductionPercent}% game rake reduction for your first ${verificationThreshold} tokens tipped
` : "") + (welcomeBonus > 0 ? `\u2022 ${welcomeBonus} token welcome bonus on your first tip
` : "") + `\u2022 Access to exclusive referral rewards

\u{1F4A1} **Next Steps:**
\u2022 Try your first tip with \`/pip_tip\`
\u2022 Get your own referral code with \`/pip_referral code\``
      ).setColor(65280).setFooter({ text: "Start tipping to activate your benefits!" }).setTimestamp();
      await i.editReply({ embeds: [embed] });
    } else {
      await i.editReply({
        content: `\u274C **${result.message}**`
      });
    }
  } catch (error) {
    console.error("Use referral code error:", error);
    await i.editReply({
      content: `\u274C **Failed to use referral code**
${error?.message || String(error)}`
    });
  }
}
async function handleReferralStats(i) {
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
      description = `**Your Referral Code:** \`${detailedStats.referralCode}\`

\u{1F4C8} **Statistics:**
\u2022 **Total Referrals:** ${stats.totalReferrals}
\u2022 **Verified Referrals:** ${stats.verifiedReferrals}
\u2022 **Pending Referrals:** ${stats.pendingReferrals.length}
\u2022 **Code Created:** <t:${Math.floor(detailedStats.createdAt.getTime() / 1e3)}:R>

\u{1F4B0} **Progress:**
\u2022 **Until Next Tax-Free Week:** ${stats.referralsUntilTaxFree} referrals
\u2022 **Tax-Free Weeks Earned:** ${stats.taxFreeWeeksEarned}

`;
      if (stats.pendingReferrals.length > 0) {
        description += `\u23F3 **Pending Referrals:**
`;
        stats.pendingReferrals.forEach((pending, index) => {
          description += `${index + 1}. Progress: ${pending.progress}/${pending.needed + pending.progress} tokens (joined ${pending.joinedAt.toLocaleDateString()})
`;
        });
      } else {
        description += `\u{1F4A1} **Get Started:** Share your code to earn rewards!`;
      }
    }
    const embed = new EmbedBuilder().setTitle("\u{1F4CA} Your Referral Statistics").setDescription(description).setColor(39423).setFooter({ text: "Keep sharing to earn more rewards!" }).setTimestamp();
    const buttons = [];
    if (detailedStats) {
      buttons.push(
        new ButtonBuilder().setCustomId("referral:share").setLabel("\u{1F4CB} Copy Code").setStyle(ButtonStyle.Secondary)
      );
    }
    buttons.push(
      new ButtonBuilder().setCustomId("referral:leaderboard").setLabel("\u{1F3C6} Leaderboard").setStyle(ButtonStyle.Primary)
    );
    const actionRow = new ActionRowBuilder().addComponents(...buttons);
    await i.editReply({
      embeds: [embed],
      components: [actionRow]
    });
  } catch (error) {
    console.error("Referral stats error:", error);
    await i.editReply({
      content: `\u274C **Failed to get referral stats**
${error?.message || String(error)}`
    });
  }
}
export {
  data,
  execute as default
};
//# sourceMappingURL=pip_referral.js.map
