// src/services/referrals.ts - Referral system with tax reduction benefits
import { prisma } from "./db.js";
import { findOrCreateUser } from "./user_helpers.js";
import { getConfig } from "../config.js";
import crypto from "crypto";

// Generate unique referral code
export function generateReferralCode(userId: string): string {
  // Create a unique code using user ID and cryptographically secure random string
  const timestamp = Date.now().toString(36);
  const userHash = userId.slice(-4);
  const randomBytes = crypto.randomBytes(3);
  const random = randomBytes.toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4);
  return `PIP${userHash}${timestamp}${random}`.toUpperCase();
}

// Create referral code for a user
export async function createReferralCode(discordId: string): Promise<string> {
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
export async function processReferralSignup(referralCode: string, newUserDiscordId: string): Promise<boolean> {
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
  } catch (error) {
    console.error("Error processing referral signup:", error);
    return false;
  }
}

// Update referral progress when user tips
export async function updateReferralProgress(userDiscordId: string, tipAmount: number, tokenId?: number): Promise<void> {
  try {
    const user = await findOrCreateUser(userDiscordId);

    // Find if this user was referred
    const referral = await prisma.referral.findFirst({
      where: { referredId: user.id, isVerified: false }
    });

    if (!referral) return; // User wasn't referred or already verified

    const config = await getConfig();

    // Grant welcome bonus on first tip if configured and not already granted
    if (!referral.welcomeBonusGranted && Number(config.referralWelcomeBonus) > 0 && tokenId) {
      await grantWelcomeBonus(user.id, tokenId, Number(config.referralWelcomeBonus));
      await prisma.referral.update({
        where: { id: referral.id },
        data: { welcomeBonusGranted: true }
      });
    }

    // Update total tipped amount
    const newTotal = Number(referral.totalTipped) + tipAmount;

    await prisma.referral.update({
      where: { id: referral.id },
      data: { totalTipped: newTotal }
    });

    // Check if they've reached verification threshold
    if (newTotal >= Number(config.referralVerificationThreshold) && !referral.isVerified) {
      await verifyReferral(referral.id);
    }
  } catch (error) {
    console.error("Error updating referral progress:", error);
  }
}

// Verify referral and grant benefits
async function verifyReferral(referralId: number): Promise<void> {
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

  if (!referral) return;

  const verifiedCount = await prisma.referral.count({
    where: {
      referrerId: referral.referrerId,
      isVerified: true
    }
  });

  // Grant 1-week tax-free membership based on config
  const config = await getConfig();
  const rewardInterval = config.referralRewardInterval;
  if (verifiedCount > 0 && verifiedCount % rewardInterval === 0) {
    await grantTaxFreeWeek(referral.referrerId);
  }

  // Create achievement for referral milestone
  await createAchievement(referral.referrerId, "referral_count", Math.floor(verifiedCount / 5) + 1);
}

// Grant welcome bonus to referred user
async function grantWelcomeBonus(userId: number, tokenId: number, bonusAmount: number): Promise<void> {
  try {
    // Add balance to user's account
    await prisma.userBalance.upsert({
      where: {
        userId_tokenId: {
          userId: userId,
          tokenId: tokenId
        }
      },
      update: {
        amount: {
          increment: bonusAmount // Amount is already in correct decimal format
        }
      },
      create: {
        userId: userId,
        tokenId: tokenId,
        amount: bonusAmount
      }
    });

    console.log(`Granted welcome bonus of ${bonusAmount} tokens (ID: ${tokenId}) to user ${userId}`);
  } catch (error) {
    console.error("Error granting welcome bonus:", error);
  }
}

// Grant 1 week tax-free membership
async function grantTaxFreeWeek(userId: number): Promise<void> {
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
export async function getReferralStats(discordId: string) {
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

// Use referral code (for new users)
export async function useReferralCode(discordId: string, code: string): Promise<{ success: boolean; message: string }> {
  const user = await findOrCreateUser(discordId);

  // Check if user already used a referral code
  const existingReferral = await prisma.referral.findFirst({
    where: { referredId: user.id, isVerified: false }
  });

  if (existingReferral) {
    return { success: false, message: "You have already used a referral code" };
  }

  // Find the referral code
  const referralEntry = await prisma.referral.findFirst({
    where: {
      referralCode: code.toUpperCase(),
      referrer: { discordId: { not: discordId } } // Can't refer yourself
    },
    include: { referrer: true }
  });

  if (!referralEntry) {
    return { success: false, message: "Invalid or expired referral code" };
  }

  // Create referral relationship
  await prisma.referral.create({
    data: {
      referrerId: referralEntry.referrerId,
      referredId: user.id,
      referralCode: code.toUpperCase(),
      isVerified: false
    }
  });

  return { success: true, message: "Referral code applied successfully!" };
}


// Create achievement
async function createAchievement(userId: number, type: string, level: number, data?: any): Promise<void> {
  try {
    await prisma.achievement.create({
      data: {
        userId,
        type,
        level,
        data: data || undefined
      }
    });
  } catch (error) {
    // Achievement might already exist (unique constraint)
    console.log(`Achievement ${type} level ${level} already exists for user ${userId}`);
  }
}