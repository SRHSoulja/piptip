import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../../services/db.js";
import { parseUnits } from "ethers";
import { formatDecimal } from "../../services/token.js";
import { PENGUIN_ERRORS, createPenguinSuccess } from "../../utils/penguin_messages.js";
/** Handle tier purchase button */
export async function handleBuyTier(i, tierId) {
    await i.deferReply({ ephemeral: true }).catch(() => { });
    try {
        // Get the specific tier with pricing
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
        // Create payment method selection buttons
        const paymentButtons = tier.prices.map(price => {
            return new ButtonBuilder()
                .setCustomId(`pip:confirm_purchase:${tier.id}:${price.tokenId}`)
                .setLabel(`🐧 Pay ${formatDecimal(price.amount, price.token.symbol)}`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji("🐟");
        });
        const paymentRow = new ActionRowBuilder()
            .addComponents(paymentButtons.slice(0, 5)); // Max 5 buttons per row
        const benefits = tier.tipTaxFree ? "🎉 Tax-free fish sharing" : "🐧 Standard colony benefits";
        await i.editReply({
            content: `**🐧 Join the ${tier.name} Colony!**\n\n` +
                `⏱️ **Duration:** ${tier.durationDays} days of premium penguin life\n` +
                `✨ **Benefits:** ${benefits}\n` +
                (tier.description ? `📝 **Description:** ${tier.description}\n` : '') +
                `\n**🐟 Choose your fish payment method:**`,
            components: [paymentRow]
        });
    }
    catch (err) {
        console.error("Buy tier error:", err);
        await i.editReply({
            content: `Error processing purchase: ${err?.message || String(err)}`
        }).catch(() => { });
    }
}
/** Handle purchase confirmation */
export async function handleConfirmPurchase(i, tierId, tokenId) {
    await i.deferReply({ ephemeral: true }).catch(() => { });
    try {
        await prisma.$transaction(async (tx) => {
            // Get user
            const user = await tx.user.upsert({
                where: { discordId: i.user.id },
                update: {},
                create: { discordId: i.user.id }
            });
            // Get tier and pricing
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
                throw new Error("😔 This colony membership is no longer available, fellow penguin!");
            }
            // Check user balance
            const userBalance = await tx.userBalance.findUnique({
                where: {
                    userId_tokenId: { userId: user.id, tokenId }
                }
            });
            const currentBalance = Number(userBalance?.amount || 0);
            const requiredAmount = Number(tierPrice.amount);
            if (currentBalance < requiredAmount) {
                throw new Error(`🐟 Not enough fish! You have ${formatDecimal(currentBalance, tierPrice.token.symbol)}, but need ${formatDecimal(requiredAmount, tierPrice.token.symbol)} to join this colony tier.`);
            }
            // Check for existing active membership of the same tier
            const existingMembership = await tx.tierMembership.findFirst({
                where: {
                    userId: user.id,
                    tierId,
                    status: 'ACTIVE',
                    expiresAt: { gt: new Date() }
                }
            });
            if (existingMembership) {
                throw new Error(`🐧 You're already a proud member of the ${tierPrice.tier.name} colony! Your membership is still active.`);
            }
            // Create membership
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + tierPrice.tier.durationDays);
            await tx.tierMembership.create({
                data: {
                    userId: user.id,
                    tierId,
                    expiresAt,
                    status: 'ACTIVE'
                }
            });
            // Deduct payment and log with BalanceDelta
            const { logCompleteTransaction } = await import("../../services/tx_logger.js");
            const priceAtomic = parseUnits(tierPrice.amount.toString(), token.decimals);
            await logCompleteTransaction(tx, {
                source: 'BOT',
                operation: 'TIER_PURCHASE',
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
                        amountDelta: -priceAtomic, // Negative (debit)
                        reason: 'tier_purchase'
                    }
                ]
            });
        });
        // Check if this was an extension (user already had this tier)
        const existingMembership = await prisma.tierMembership.findFirst({
            where: {
                userId: (await prisma.user.findUnique({ where: { discordId: i.user.id } }))?.id,
                tierId,
                status: 'ACTIVE'
            },
            include: { tier: true }
        });
        const isExtension = existingMembership ? true : false;
        const successMessage = isExtension
            ? createPenguinSuccess("Colony Membership Extended!", "Your penguin colony membership has been extended! Check your profile to see your updated expiry date and enjoy those premium perks! 🐧✨", { personality: 'excited', emoji: '🎉' })
            : createPenguinSuccess("Welcome to the Premium Colony!", "You're now a premium penguin! Access your exclusive features and check your new status in your profile. Time to make some waves! 🐧👑", { personality: 'excited', emoji: '🎉' });
        // Assign Discord role for the purchased tier
        try {
            const { tierRoleManager } = await import("../../services/tier_role_manager.js");
            await tierRoleManager.onMembershipPurchased(i.user.id, tierId);
        }
        catch (roleError) {
            console.warn("Failed to assign Discord role for tier membership:", roleError);
            // Don't fail the purchase if role assignment fails
        }
        await i.editReply({
            content: successMessage
        });
    }
    catch (err) {
        console.error("Confirm purchase error:", err);
        await i.editReply({
            content: PENGUIN_ERRORS.purchaseFailed(err?.message || String(err))
        }).catch(() => { });
    }
}
/** Handle membership purchase button */
export async function handlePurchaseMembership(i) {
    await i.deferReply({ ephemeral: true }).catch(() => { });
    try {
        // Get available tiers
        const activeTiers = await prisma.tier.findMany({
            where: { active: true },
            include: {
                prices: {
                    include: { token: true }
                }
            },
            orderBy: { priceAmount: 'asc' }
        });
        if (activeTiers.length === 0) {
            return i.editReply({
                content: PENGUIN_ERRORS.noMembershipTiers()
            });
        }
        // Check if user has any active memberships to customize messaging
        const user = await prisma.user.findUnique({
            where: { discordId: i.user.id },
            include: {
                tierMemberships: {
                    where: {
                        status: 'ACTIVE',
                        expiresAt: { gt: new Date() }
                    },
                    include: { tier: true }
                }
            }
        });
        const hasActiveMemberships = user?.tierMemberships && user.tierMemberships.length > 0;
        // Create tier selection embed
        const tiersList = activeTiers.map((tier, index) => {
            const prices = tier.prices.map(p => `${formatDecimal(p.amount, p.token.symbol)}`).join(" or ");
            const benefits = tier.tipTaxFree ? "🎉 Tax-free fish sharing" : "🐧 Standard colony benefits";
            return `**${index + 1}. ${tier.name}** (${tier.durationDays} days)\n` +
                `💰 Cost: ${prices}\n` +
                `✨ Benefits: ${benefits}` +
                (tier.description ? `\n📝 ${tier.description}` : "");
        }).join("\n\n");
        // Create tier selection buttons for actual purchase
        const tierButtons = activeTiers.slice(0, 5).map((tier, index) => {
            const buttonLabel = hasActiveMemberships ? `🐧 Extend ${tier.name}` : `🐧 Join ${tier.name}`;
            return new ButtonBuilder()
                .setCustomId(`pip:buy_tier:${tier.id}`)
                .setLabel(buttonLabel)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("🐟");
        });
        const actionRows = [];
        // Split buttons into rows (max 5 per row)
        for (let i = 0; i < tierButtons.length; i += 5) {
            const row = new ActionRowBuilder()
                .addComponents(tierButtons.slice(i, i + 5));
            actionRows.push(row);
        }
        const actionText = hasActiveMemberships ?
            `🐟 Waddle over and extend your colony membership:` :
            `🐟 Choose your penguin colony tier:`;
        const titleText = hasActiveMemberships ?
            `**🐧 Extend Your Colony Membership**\n\n${tiersList}\n\n${actionText}` :
            `**🐧 Join the Premium Penguin Colony!**\n\n${tiersList}\n\n${actionText}`;
        await i.editReply({
            content: titleText,
            components: actionRows
        });
    }
    catch (err) {
        console.error("Purchase membership error:", err);
        await i.editReply({
            content: PENGUIN_ERRORS.membershipLoadError(err?.message || String(err))
        }).catch(() => { });
    }
}
