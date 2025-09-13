import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../../services/db.js";
import { formatDecimal } from "../../services/token.js";
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
            return i.editReply({ content: "This membership tier is no longer available." });
        }
        if (tier.prices.length === 0) {
            return i.editReply({ content: "No pricing configured for this tier. Please contact an administrator." });
        }
        // Create payment method selection buttons
        const paymentButtons = tier.prices.map(price => {
            return new ButtonBuilder()
                .setCustomId(`pip:confirm_purchase:${tier.id}:${price.tokenId}`)
                .setLabel(`Pay with ${formatDecimal(price.amount, price.token.symbol)}`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji("💰");
        });
        const paymentRow = new ActionRowBuilder()
            .addComponents(paymentButtons.slice(0, 5)); // Max 5 buttons per row
        const benefits = tier.tipTaxFree ? "🎉 Tax-free tipping" : "Standard benefits";
        await i.editReply({
            content: `**💳 Purchase ${tier.name}**\n\n` +
                `⏱️ **Duration:** ${tier.durationDays} days\n` +
                `✨ **Benefits:** ${benefits}\n` +
                (tier.description ? `📝 **Description:** ${tier.description}\n` : '') +
                `\n**Choose your payment method:**`,
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
                throw new Error("Membership tier or pricing not available.");
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
                throw new Error(`Insufficient balance. You have ${formatDecimal(currentBalance, tierPrice.token.symbol)}, but need ${formatDecimal(requiredAmount, tierPrice.token.symbol)}.`);
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
                throw new Error(`You already have an active ${tierPrice.tier.name} membership.`);
            }
            // Deduct payment from user balance
            await tx.userBalance.update({
                where: { userId_tokenId: { userId: user.id, tokenId } },
                data: {
                    amount: {
                        decrement: tierPrice.amount
                    }
                }
            });
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
            // Log transaction
            await tx.transaction.create({
                data: {
                    type: 'MEMBERSHIP_PURCHASE',
                    userId: user.id,
                    tokenId,
                    amount: tierPrice.amount,
                    fee: '0',
                    metadata: `${tierPrice.tier.name} membership`
                }
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
            ? `🎉 **Membership Extended Successfully!**\n\nYour membership has been extended. Check your profile to see your updated expiry date.`
            : `🎉 **Membership Purchased Successfully!**\n\nYou now have access to premium features. Check your profile to see your new membership status.`;
        await i.editReply({
            content: successMessage
        });
    }
    catch (err) {
        console.error("Confirm purchase error:", err);
        await i.editReply({
            content: `❌ Purchase failed: ${err?.message || String(err)}`
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
            return i.editReply({ content: "No membership tiers are currently available." });
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
            const benefits = tier.tipTaxFree ? "🎉 Tax-free tipping" : "Standard benefits";
            return `**${index + 1}. ${tier.name}** (${tier.durationDays} days)\n` +
                `💰 Cost: ${prices}\n` +
                `✨ Benefits: ${benefits}` +
                (tier.description ? `\n📝 ${tier.description}` : "");
        }).join("\n\n");
        // Create tier selection buttons for actual purchase
        const tierButtons = activeTiers.slice(0, 5).map((tier, index) => {
            const buttonLabel = hasActiveMemberships ? `Extend ${tier.name}` : `Buy ${tier.name}`;
            return new ButtonBuilder()
                .setCustomId(`pip:buy_tier:${tier.id}`)
                .setLabel(buttonLabel)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("💳");
        });
        const actionRows = [];
        // Split buttons into rows (max 5 per row)
        for (let i = 0; i < tierButtons.length; i += 5) {
            const row = new ActionRowBuilder()
                .addComponents(tierButtons.slice(i, i + 5));
            actionRows.push(row);
        }
        const actionText = hasActiveMemberships ?
            `Click a button below to extend your membership:` :
            `Click a button below to purchase a membership:`;
        const titleText = hasActiveMemberships ?
            `**🌟 Extend Your Membership**\n\n${tiersList}\n\n${actionText}` :
            `**🌟 Available Membership Tiers**\n\n${tiersList}\n\n${actionText}`;
        await i.editReply({
            content: titleText,
            components: actionRows
        });
    }
    catch (err) {
        console.error("Purchase membership error:", err);
        await i.editReply({
            content: `Error loading membership options: ${err?.message || String(err)}`
        }).catch(() => { });
    }
}
