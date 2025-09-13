// src/services/referrals.ts - Referral system with tax reduction benefits
import { prisma } from "./db.js";
import { findOrCreateUser } from "./user_helpers.js";
// Generate unique referral code
export function generateReferralCode(userId) {
    // Create a unique code using user ID and random string
    const timestamp = Date.now().toString(36);
    const userHash = userId.slice(-4);
    const random = Math.random().toString(36).substring(2, 6);
    return `PIP${userHash}${timestamp}${random}`.toUpperCase();
}
// Create referral code for a user
export async function createReferralCode(discordId) {
    const user = await findOrCreateUser(discordId);
    // Check if user already has an active referral code
    const existingReferral = await prisma.referral.findFirst({
        where: { referrerId: user.id }
    });
    if (existingReferral) {
        return existingReferral.referralCode;
    }
    // Generate new referral code
    let referralCode = generateReferralCode(discordId);
    // Ensure uniqueness
    while (await prisma.referral.findUnique({ where: { referralCode } })) {
        referralCode = generateReferralCode(discordId);
    }
    // Create referral entry for tracking
    await prisma.referral.create({
        data: {
            referrerId: user.id,
            referredId: user.id, // Self-referral for code generation
            referralCode,
            isVerified: false
        }
    });
    return referralCode;
}
// Process referral signup
export async function processReferralSignup(referralCode, newUserDiscordId) {
    try {
        // Find referral by code
        const referralEntry = await prisma.referral.findUnique({
            where: { referralCode },
            include: { referrer: true }
        });
        if (!referralEntry) {
            return false; // Invalid referral code
        }
        // Create new user
        const newUser = await findOrCreateUser(newUserDiscordId);
        // Check if user is already referred
        const existingReferral = await prisma.referral.findFirst({
            where: { referredId: newUser.id }
        });
        if (existingReferral) {
            return false; // User already referred
        }
        // Create referral relationship
        await prisma.referral.create({
            data: {
                referrerId: referralEntry.referrerId,
                referredId: newUser.id,
                referralCode,
                isVerified: false,
                totalTipped: 0
            }
        });
        return true;
    }
    catch (error) {
        console.error("Error processing referral signup:", error);
        return false;
    }
}
// Update referral progress when user tips
export async function updateReferralProgress(userDiscordId, tipAmount) {
    try {
        const user = await findOrCreateUser(userDiscordId);
        // Find if this user was referred
        const referral = await prisma.referral.findFirst({
            where: { referredId: user.id, isVerified: false }
        });
        if (!referral)
            return; // User wasn't referred or already verified
        // Update total tipped amount
        const newTotal = Number(referral.totalTipped) + tipAmount;
        await prisma.referral.update({
            where: { id: referral.id },
            data: { totalTipped: newTotal }
        });
        // Check if they've reached verification threshold (20 tokens)
        if (newTotal >= 20 && !referral.isVerified) {
            await verifyReferral(referral.id);
        }
    }
    catch (error) {
        console.error("Error updating referral progress:", error);
    }
}
// Verify referral and grant benefits
async function verifyReferral(referralId) {
    await prisma.referral.update({
        where: { id: referralId },
        data: {
            isVerified: true,
            verifiedAt: new Date()
        }
    });
    // Check if referrer has reached 10 verified referrals for tax-free membership
    const referral = await prisma.referral.findUnique({
        where: { id: referralId },
        include: { referrer: true }
    });
    if (!referral)
        return;
    const verifiedCount = await prisma.referral.count({
        where: {
            referrerId: referral.referrerId,
            isVerified: true
        }
    });
    // Grant 1-week tax-free membership for every 10 verified referrals
    if (verifiedCount > 0 && verifiedCount % 10 === 0) {
        await grantTaxFreeWeek(referral.referrerId);
    }
    // Create achievement for referral milestone
    await createAchievement(referral.referrerId, "referral_count", Math.floor(verifiedCount / 5) + 1);
}
// Grant 1 week tax-free membership
async function grantTaxFreeWeek(userId) {
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7); // 1 week from now
    // Find a suitable tier for tax-free benefits (assuming tier ID 1 has tax-free benefits)
    const taxFreeTier = await prisma.tier.findFirst({
        where: { tipTaxFree: true, active: true }
    });
    if (!taxFreeTier) {
        console.warn("No tax-free tier found for referral reward");
        return;
    }
    // Create membership
    await prisma.tierMembership.create({
        data: {
            userId,
            tierId: taxFreeTier.id,
            startedAt: startDate,
            expiresAt: endDate,
            status: "ACTIVE"
        }
    });
}
// Get referral stats for a user
export async function getReferralStats(discordId) {
    const user = await findOrCreateUser(discordId);
    const [totalReferrals, verifiedReferrals, referralCode] = await Promise.all([
        prisma.referral.count({
            where: { referrerId: user.id, referredId: { not: user.id } }
        }),
        prisma.referral.count({
            where: { referrerId: user.id, isVerified: true, referredId: { not: user.id } }
        }),
        prisma.referral.findFirst({
            where: { referrerId: user.id },
            select: { referralCode: true }
        })
    ]);
    const pendingReferrals = await prisma.referral.findMany({
        where: {
            referrerId: user.id,
            isVerified: false,
            referredId: { not: user.id }
        },
        select: {
            totalTipped: true,
            createdAt: true
        }
    });
    const nextTaxFreeAt = Math.ceil(verifiedReferrals / 10) * 10;
    const referralsUntilTaxFree = nextTaxFreeAt - verifiedReferrals;
    return {
        referralCode: referralCode?.referralCode,
        totalReferrals,
        verifiedReferrals,
        pendingReferrals: pendingReferrals.map(r => ({
            progress: Number(r.totalTipped),
            needed: 20 - Number(r.totalTipped),
            joinedAt: r.createdAt
        })),
        referralsUntilTaxFree,
        taxFreeWeeksEarned: Math.floor(verifiedReferrals / 10)
    };
}
// Create achievement
async function createAchievement(userId, type, level, data) {
    try {
        await prisma.achievement.create({
            data: {
                userId,
                type,
                level,
                data: data || undefined
            }
        });
    }
    catch (error) {
        // Achievement might already exist (unique constraint)
        console.log(`Achievement ${type} level ${level} already exists for user ${userId}`);
    }
}
