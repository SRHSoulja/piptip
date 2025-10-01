import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { ensureUser, getCachedUserBalanceByDiscord, getTokenByAddress } from "../services/balances.js";
import { prisma } from "../services/db.js";
async function pipBuyChips(i) {
  try {
    const amount = i.options.getInteger("amount", true);
    const token = i.options.getString("token", true);
    await i.deferReply({ ephemeral: true });
    await ensureUser(i.user.id);
    const packages = await prisma.pipchipsPackage.findMany({
      where: {
        isActive: true,
        tokenSymbol: token.toUpperCase()
      },
      orderBy: { pipchipsAmount: "asc" }
    });
    if (packages.length === 0) {
      const embed2 = new EmbedBuilder().setTitle("\u274C No Packages Available").setDescription(`No PIPChips packages are currently available for ${token.toUpperCase()}.`).setColor(15680580).addFields({
        name: "\u{1F4A1} Alternative Options",
        value: [
          "\u2022 Try a different token",
          "\u2022 Claim your daily bonus with `/pip_daily`",
          "\u2022 Check back later for new packages"
        ].join("\n")
      });
      return i.editReply({ embeds: [embed2] });
    }
    const matchingPackage = packages.find((pkg) => pkg.pipchipsAmount === BigInt(amount));
    if (matchingPackage) {
      const tokenInfo2 = await getTokenByAddress(token.toUpperCase());
      const userBalance2 = await getCachedUserBalanceByDiscord(i.user.id, tokenInfo2.id);
      const canPurchase = userBalance2 >= Number(matchingPackage.tokenCost);
      const embed2 = new EmbedBuilder().setTitle("\u{1F4B0} PIPChips Package").setDescription(`Ready to purchase **${amount.toLocaleString()}** PIPChips?`).setColor(canPurchase ? 1096065 : 15680580).addFields(
        {
          name: "\u{1F4E6} Package Details",
          value: [
            `**PIPChips:** ${matchingPackage.pipchipsAmount.toLocaleString()}`,
            `**Cost:** ${Number(matchingPackage.tokenCost)} ${token.toUpperCase()}`,
            `**Bonus:** ${matchingPackage.bonusPercentage}% extra chips`,
            `**Total Value:** ${(matchingPackage.pipchipsAmount * BigInt(100 + matchingPackage.bonusPercentage) / BigInt(100)).toLocaleString()} PIPChips`
          ].join("\n"),
          inline: true
        },
        {
          name: "\u{1F4B3} Your Balance",
          value: [
            `**Available:** ${userBalance2} ${token.toUpperCase()}`,
            `**After Purchase:** ${Math.max(0, userBalance2 - Number(matchingPackage.tokenCost))} ${token.toUpperCase()}`
          ].join("\n"),
          inline: true
        }
      );
      if (!canPurchase) {
        embed2.addFields({
          name: "\u274C Insufficient Funds",
          value: `You need ${Number(matchingPackage.tokenCost) - userBalance2} more ${token.toUpperCase()} to purchase this package.`,
          inline: false
        });
      }
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`purchase_chips:${matchingPackage.id}`).setLabel(canPurchase ? "Confirm Purchase" : "Insufficient Funds").setStyle(canPurchase ? ButtonStyle.Success : ButtonStyle.Danger).setEmoji(canPurchase ? "\u2705" : "\u274C").setDisabled(!canPurchase),
        new ButtonBuilder().setCustomId("view_all_packages").setLabel("View All Packages").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4E6}"),
        new ButtonBuilder().setCustomId("deposit_funds").setLabel("Add Funds").setStyle(ButtonStyle.Primary).setEmoji("\u{1F4B0}")
      );
      return i.editReply({ embeds: [embed2], components: [row2] });
    }
    const embed = new EmbedBuilder().setTitle(`\u{1F4B0} PIPChips Packages - ${token.toUpperCase()}`).setDescription("Choose a package to purchase PIPChips with your tokens!").setColor(3900150);
    const displayPackages = packages.slice(0, 5);
    for (const pkg of displayPackages) {
      const totalValue = pkg.pipchipsAmount * BigInt(100 + pkg.bonusPercentage) / BigInt(100);
      const savings = pkg.bonusPercentage > 0 ? ` (+${pkg.bonusPercentage}% bonus!)` : "";
      embed.addFields({
        name: `${pkg.pipchipsAmount.toLocaleString()} PIPChips${savings}`,
        value: [
          `**Cost:** ${Number(pkg.tokenCost)} ${token.toUpperCase()}`,
          `**Total Value:** ${totalValue.toLocaleString()} PIPChips`,
          `**Package ID:** \`${pkg.id}\``
        ].join("\n"),
        inline: true
      });
    }
    if (packages.length > 5) {
      embed.setFooter({ text: `Showing 5 of ${packages.length} packages. Use /buy_chips amount:X to see specific packages.` });
    }
    const tokenInfo = await getTokenByAddress(token.toUpperCase());
    const userBalance = await getCachedUserBalanceByDiscord(i.user.id, tokenInfo.id);
    embed.addFields({
      name: "\u{1F4B3} Your Balance",
      value: `**${userBalance}** ${token.toUpperCase()}`,
      inline: false
    });
    const buttons = [];
    if (displayPackages.length > 0) {
      for (let i2 = 0; i2 < Math.min(3, displayPackages.length); i2++) {
        const pkg = displayPackages[i2];
        const canAfford = userBalance >= Number(pkg.tokenCost);
        buttons.push(
          new ButtonBuilder().setCustomId(`purchase_chips:${pkg.id}`).setLabel(`${pkg.pipchipsAmount.toLocaleString()} Chips`).setStyle(canAfford ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!canAfford)
        );
      }
    }
    buttons.push(
      new ButtonBuilder().setCustomId("deposit_funds").setLabel("Add Funds").setStyle(ButtonStyle.Primary).setEmoji("\u{1F4B0}")
    );
    const row = new ActionRowBuilder().addComponents(...buttons);
    await i.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    console.error("Buy chips command error:", error);
    if (i.deferred) {
      await i.editReply({
        content: `\u274C **Error loading PIPChips packages**
${error?.message || String(error)}`
      });
    } else {
      await i.reply({
        content: `\u274C **Error loading PIPChips packages**
${error?.message || String(error)}`,
        ephemeral: true
      });
    }
  }
}
export {
  pipBuyChips as default
};
//# sourceMappingURL=pip_buy_chips.js.map
