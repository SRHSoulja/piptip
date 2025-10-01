import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../../services/db.js";
import { parseUnits } from "ethers";
import { formatDecimal } from "../../services/token.js";
import { PENGUIN_ERRORS, createPenguinSuccess } from "../../utils/penguin_messages.js";
async function handleBuyTier(i, tierId) {
  await i.deferReply({ ephemeral: true }).catch(() => {
  });
  try {
    const tier = await prisma.tier.findUnique({
      where: { id: tierId, active: true },
      include: {
        prices: {
          include: { token: true }
        }
      }
    });
    if (!tier) {
      return i.editReply({
        content: PENGUIN_ERRORS.membershipNotAvailable()
      });
    }
    if (tier.prices.length === 0) {
      return i.editReply({
        content: PENGUIN_ERRORS.noPricingConfigured()
      });
    }
    const paymentButtons = tier.prices.map((price) => {
      return new ButtonBuilder().setCustomId(`pip:confirm_purchase:${tier.id}:${price.tokenId}`).setLabel(`\u{1F427} Pay ${formatDecimal(price.amount, price.token.symbol)}`).setStyle(ButtonStyle.Primary).setEmoji("\u{1F41F}");
    });
    const paymentRow = new ActionRowBuilder().addComponents(paymentButtons.slice(0, 5));
    const benefits = tier.tipTaxFree ? "\u{1F389} Tax-free fish sharing" : "\u{1F427} Standard colony benefits";
    await i.editReply({
      content: `**\u{1F427} Join the ${tier.name} Colony!**

\u23F1\uFE0F **Duration:** ${tier.durationDays} days of premium penguin life
\u2728 **Benefits:** ${benefits}
` + (tier.description ? `\u{1F4DD} **Description:** ${tier.description}
` : "") + `
**\u{1F41F} Choose your fish payment method:**`,
      components: [paymentRow]
    });
  } catch (err) {
    console.error("Buy tier error:", err);
    await i.editReply({
      content: `Error processing purchase: ${err?.message || String(err)}`
    }).catch(() => {
    });
  }
}
async function handleConfirmPurchase(i, tierId, tokenId) {
  await i.deferReply({ ephemeral: true }).catch(() => {
  });
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { discordId: i.user.id },
        update: {},
        create: { discordId: i.user.id }
      });
      const tierPrice = await tx.tierPrice.findUnique({
        where: {
          tierId_tokenId: { tierId, tokenId }
        },
        include: {
          tier: true,
          token: true
        }
      });
      if (!tierPrice || !tierPrice.tier.active) {
        throw new Error("\u{1F614} This colony membership is no longer available, fellow penguin!");
      }
      const userBalance = await tx.userBalance.findUnique({
        where: {
          userId_tokenId: { userId: user.id, tokenId }
        }
      });
      const currentBalance = Number(userBalance?.amount || 0);
      const requiredAmount = Number(tierPrice.amount);
      if (currentBalance < requiredAmount) {
        throw new Error(`\u{1F41F} Not enough fish! You have ${formatDecimal(currentBalance, tierPrice.token.symbol)}, but need ${formatDecimal(requiredAmount, tierPrice.token.symbol)} to join this colony tier.`);
      }
      const existingMembership2 = await tx.tierMembership.findFirst({
        where: {
          userId: user.id,
          tierId,
          status: "ACTIVE",
          expiresAt: { gt: /* @__PURE__ */ new Date() }
        }
      });
      if (existingMembership2) {
        throw new Error(`\u{1F427} You're already a proud member of the ${tierPrice.tier.name} colony! Your membership is still active.`);
      }
      const expiresAt = /* @__PURE__ */ new Date();
      expiresAt.setDate(expiresAt.getDate() + tierPrice.tier.durationDays);
      await tx.tierMembership.create({
        data: {
          userId: user.id,
          tierId,
          expiresAt,
          status: "ACTIVE"
        }
      });
      const { logCompleteTransaction } = await import("../../services/tx_logger.js");
      const priceAtomic = parseUnits(tierPrice.amount.toString(), token.decimals);
      await logCompleteTransaction(tx, {
        source: "BOT",
        operation: "TIER_PURCHASE",
        userId: user.id,
        guildId: i.guildId ?? null,
        idempotencyKey: `tier_purchase_${user.id}_${tierId}_${Date.now()}`,
        opRef: `tier_${tierId}`,
        metadata: {
          tierId,
          tierName: tierPrice.tier.name,
          cost: tierPrice.amount.toString(),
          tokenSymbol: token.symbol,
          durationDays: tierPrice.tier.durationDays
        },
        balanceChanges: [
          {
            tokenId,
            userId: user.id,
            amountDelta: -priceAtomic,
            // Negative (debit)
            reason: "tier_purchase"
          }
        ]
      });
    });
    const existingMembership = await prisma.tierMembership.findFirst({
      where: {
        userId: (await prisma.user.findUnique({ where: { discordId: i.user.id } }))?.id,
        tierId,
        status: "ACTIVE"
      },
      include: { tier: true }
    });
    const isExtension = existingMembership ? true : false;
    const successMessage = isExtension ? createPenguinSuccess(
      "Colony Membership Extended!",
      "Your penguin colony membership has been extended! Check your profile to see your updated expiry date and enjoy those premium perks! \u{1F427}\u2728",
      { personality: "excited", emoji: "\u{1F389}" }
    ) : createPenguinSuccess(
      "Welcome to the Premium Colony!",
      "You're now a premium penguin! Access your exclusive features and check your new status in your profile. Time to make some waves! \u{1F427}\u{1F451}",
      { personality: "excited", emoji: "\u{1F389}" }
    );
    try {
      const { tierRoleManager } = await import("../../services/tier_role_manager.js");
      await tierRoleManager.onMembershipPurchased(i.user.id, tierId);
    } catch (roleError) {
      console.warn("Failed to assign Discord role for tier membership:", roleError);
    }
    await i.editReply({
      content: successMessage
    });
  } catch (err) {
    console.error("Confirm purchase error:", err);
    await i.editReply({
      content: PENGUIN_ERRORS.purchaseFailed(err?.message || String(err))
    }).catch(() => {
    });
  }
}
async function handlePurchaseMembership(i) {
  await i.deferReply({ ephemeral: true }).catch(() => {
  });
  try {
    const activeTiers = await prisma.tier.findMany({
      where: { active: true },
      include: {
        prices: {
          include: { token: true }
        }
      },
      orderBy: { priceAmount: "asc" }
    });
    if (activeTiers.length === 0) {
      return i.editReply({
        content: PENGUIN_ERRORS.noMembershipTiers()
      });
    }
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
      include: {
        tierMemberships: {
          where: {
            status: "ACTIVE",
            expiresAt: { gt: /* @__PURE__ */ new Date() }
          },
          include: { tier: true }
        }
      }
    });
    const hasActiveMemberships = user?.tierMemberships && user.tierMemberships.length > 0;
    const tiersList = activeTiers.map((tier, index) => {
      const prices = tier.prices.map(
        (p) => `${formatDecimal(p.amount, p.token.symbol)}`
      ).join(" or ");
      const benefits = tier.tipTaxFree ? "\u{1F389} Tax-free fish sharing" : "\u{1F427} Standard colony benefits";
      return `**${index + 1}. ${tier.name}** (${tier.durationDays} days)
\u{1F4B0} Cost: ${prices}
\u2728 Benefits: ${benefits}` + (tier.description ? `
\u{1F4DD} ${tier.description}` : "");
    }).join("\n\n");
    const tierButtons = activeTiers.slice(0, 5).map((tier, index) => {
      const buttonLabel = hasActiveMemberships ? `\u{1F427} Extend ${tier.name}` : `\u{1F427} Join ${tier.name}`;
      return new ButtonBuilder().setCustomId(`pip:buy_tier:${tier.id}`).setLabel(buttonLabel).setStyle(ButtonStyle.Secondary).setEmoji("\u{1F41F}");
    });
    const actionRows = [];
    for (let i2 = 0; i2 < tierButtons.length; i2 += 5) {
      const row = new ActionRowBuilder().addComponents(tierButtons.slice(i2, i2 + 5));
      actionRows.push(row);
    }
    const actionText = hasActiveMemberships ? `\u{1F41F} Waddle over and extend your colony membership:` : `\u{1F41F} Choose your penguin colony tier:`;
    const titleText = hasActiveMemberships ? `**\u{1F427} Extend Your Colony Membership**

${tiersList}

${actionText}` : `**\u{1F427} Join the Premium Penguin Colony!**

${tiersList}

${actionText}`;
    await i.editReply({
      content: titleText,
      components: actionRows
    });
  } catch (err) {
    console.error("Purchase membership error:", err);
    await i.editReply({
      content: PENGUIN_ERRORS.membershipLoadError(err?.message || String(err))
    }).catch(() => {
    });
  }
}
export {
  handleBuyTier,
  handleConfirmPurchase,
  handlePurchaseMembership
};
//# sourceMappingURL=tiers.js.map
