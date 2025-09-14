#!/usr/bin/env npx tsx
// scripts/seed_dynamic_achievements.ts - Seed dynamic achievement definitions

import { prisma } from '../src/services/db.js';
import { invalidateDefinitionCache } from '../src/services/dynamic_achievements.js';

const achievementSeeds = [
  // Streak Achievements
  {
    name: "First Victory",
    description: "Win your first match",
    category: "streaks",
    criteriaType: "streak",
    criteriaData: { field: "current_wins" },
    threshold: 1,
    iconEmoji: "🎉",
    badgeColor: "#4CAF50",
    rarity: "common",
    tier: 1,
    sortOrder: 1
  },
  {
    name: "Hot Streak",
    description: "Win 3 matches in a row",
    category: "streaks",
    criteriaType: "streak",
    criteriaData: { field: "current_wins" },
    threshold: 3,
    iconEmoji: "🔥",
    badgeColor: "#FF9800",
    rarity: "common",
    tier: 1,
    sortOrder: 2
  },
  {
    name: "Unstoppable",
    description: "Win 10 matches in a row",
    category: "streaks",
    criteriaType: "streak",
    criteriaData: { field: "current_wins" },
    threshold: 10,
    iconEmoji: "🚀",
    badgeColor: "#E91E63",
    rarity: "rare",
    tier: 2,
    sortOrder: 3
  },
  {
    name: "Legendary Streak",
    description: "Win 25 matches in a row",
    category: "streaks",
    criteriaType: "streak",
    criteriaData: { field: "current_wins" },
    threshold: 25,
    iconEmoji: "👑",
    badgeColor: "#9C27B0",
    rarity: "legendary",
    tier: 4,
    sortOrder: 4
  },

  // Tip Achievements
  {
    name: "First Tip",
    description: "Send your first tip",
    category: "tips",
    criteriaType: "count",
    criteriaData: { field: "sent" },
    threshold: 1,
    iconEmoji: "💝",
    badgeColor: "#2196F3",
    rarity: "common",
    tier: 1,
    sortOrder: 10
  },
  {
    name: "Generous Tipper",
    description: "Send 50 tips",
    category: "tips",
    criteriaType: "count",
    criteriaData: { field: "sent" },
    threshold: 50,
    iconEmoji: "💎",
    badgeColor: "#00BCD4",
    rarity: "rare",
    tier: 2,
    sortOrder: 11
  },
  {
    name: "Tip Master",
    description: "Send 500 tips",
    category: "tips",
    criteriaType: "count",
    criteriaData: { field: "sent" },
    threshold: 500,
    iconEmoji: "🏆",
    badgeColor: "#FFD700",
    rarity: "epic",
    tier: 3,
    sortOrder: 12
  },
  {
    name: "Popular Recipient",
    description: "Receive 100 tips",
    category: "tips",
    criteriaType: "count",
    criteriaData: { field: "received" },
    threshold: 100,
    iconEmoji: "⭐",
    badgeColor: "#FFC107",
    rarity: "rare",
    tier: 2,
    sortOrder: 13
  },

  // Deposit Achievements (Responsible Design)
  {
    name: "First Deposit",
    description: "Make your first deposit",
    category: "deposits",
    criteriaType: "count",
    criteriaData: { field: "deposits_made" },
    threshold: 1,
    iconEmoji: "💰",
    badgeColor: "#4CAF50",
    rarity: "common",
    tier: 1,
    sortOrder: 20,
    cooldownHours: 168 // 1 week cooldown
  },
  {
    name: "Deposit Milestone",
    description: "Reach $1000 total deposited",
    category: "deposits",
    criteriaType: "sum",
    criteriaData: { field: "total_deposited" },
    threshold: 1000,
    iconEmoji: "📈",
    badgeColor: "#795548",
    rarity: "rare",
    tier: 2,
    sortOrder: 21,
    cooldownHours: 168 // 1 week cooldown
  },

  // Referral Achievements
  {
    name: "First Referral",
    description: "Successfully refer a friend",
    category: "referrals",
    criteriaType: "count",
    criteriaData: { field: "verified_referrals" },
    threshold: 1,
    iconEmoji: "👫",
    badgeColor: "#3F51B5",
    rarity: "common",
    tier: 1,
    sortOrder: 30
  },
  {
    name: "Social Butterfly",
    description: "Refer 10 friends",
    category: "referrals",
    criteriaType: "count",
    criteriaData: { field: "verified_referrals" },
    threshold: 10,
    iconEmoji: "🦋",
    badgeColor: "#E91E63",
    rarity: "epic",
    tier: 3,
    sortOrder: 31
  },

  // Special/Custom Achievements
  {
    name: "Daily Tipper",
    description: "Send tips on 7 consecutive days",
    category: "special",
    criteriaType: "custom",
    criteriaData: {
      function: "consecutiveDaysTipping",
      params: { days: 7 }
    },
    threshold: 7,
    iconEmoji: "📅",
    badgeColor: "#607D8B",
    rarity: "rare",
    tier: 2,
    sortOrder: 40
  },
  {
    name: "Token Explorer",
    description: "Use 5 different tokens for tipping",
    category: "special",
    criteriaType: "unique",
    criteriaData: { field: "tip_tokens" },
    threshold: 5,
    iconEmoji: "🎨",
    badgeColor: "#9E9E9E",
    rarity: "rare",
    tier: 2,
    sortOrder: 41
  },

  // Veteran Status
  {
    name: "7-Day Veteran",
    description: "Member for 7 days",
    category: "veteran",
    criteriaType: "custom",
    criteriaData: {
      function: "daysSinceJoined",
      params: {}
    },
    threshold: 7,
    iconEmoji: "🗓️",
    badgeColor: "#8BC34A",
    rarity: "common",
    tier: 1,
    sortOrder: 50
  },
  {
    name: "30-Day Veteran",
    description: "Member for 30 days",
    category: "veteran",
    criteriaType: "custom",
    criteriaData: {
      function: "daysSinceJoined",
      params: {}
    },
    threshold: 30,
    iconEmoji: "📆",
    badgeColor: "#689F38",
    rarity: "common",
    tier: 1,
    sortOrder: 51
  },
  {
    name: "1-Year Veteran",
    description: "Member for 365 days",
    category: "veteran",
    criteriaType: "custom",
    criteriaData: {
      function: "daysSinceJoined",
      params: {}
    },
    threshold: 365,
    iconEmoji: "🎂",
    badgeColor: "#388E3C",
    rarity: "legendary",
    tier: 4,
    sortOrder: 52
  }
];

async function seedAchievements() {
  console.log('🌱 Seeding dynamic achievement definitions...');

  try {
    let created = 0;
    let skipped = 0;

    for (const achievement of achievementSeeds) {
      // Check if achievement already exists
      const existing = await prisma.achievementDefinition.findFirst({
        where: { name: achievement.name }
      });

      if (existing) {
        console.log(`⏭️  Skipping existing achievement: ${achievement.name}`);
        skipped++;
        continue;
      }

      // Create the achievement
      await prisma.achievementDefinition.create({
        data: achievement
      });

      console.log(`✅ Created achievement: ${achievement.name} (${achievement.category})`);
      created++;
    }

    // Invalidate cache to pick up new definitions
    invalidateDefinitionCache();

    console.log(`\n🎉 Seeding complete:`);
    console.log(`   Created: ${created} achievements`);
    console.log(`   Skipped: ${skipped} existing achievements`);
    console.log(`   Total definitions: ${achievementSeeds.length}`);

    // Show category breakdown
    const categories = achievementSeeds.reduce((acc, achievement) => {
      acc[achievement.category] = (acc[achievement.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`\n📊 Categories created:`);
    Object.entries(categories).forEach(([category, count]) => {
      console.log(`   ${category}: ${count} achievements`);
    });

  } catch (error) {
    console.error('❌ Error seeding achievements:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Add AppConfig update for achievement system
async function updateAppConfig() {
  console.log('⚙️  Updating AppConfig for achievement system...');

  try {
    // Ensure AppConfig exists and has achievement controls
    await prisma.appConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        minDeposit: 50,
        minWithdraw: 50,
        withdrawMaxPerTx: 50,
        withdrawDailyCap: 500,
        houseFeeBps: 200,
        tipFeeBps: 100,
        emergencyMode: false,
        withdrawalsPaused: false,
        tippingPaused: false,
        achievementsEnabled: true,
        streakProtectionEnabled: true
      },
      update: {
        achievementsEnabled: true,
        streakProtectionEnabled: true
      }
    });

    console.log('✅ AppConfig updated with achievement controls');

  } catch (error) {
    console.error('❌ Error updating AppConfig:', error);
  }
}

// Run seeding
async function main() {
  console.log('🚀 Starting dynamic achievement system setup...\n');

  await updateAppConfig();
  await seedAchievements();

  console.log('\n🎯 Next steps:');
  console.log('1. Run: npx prisma generate');
  console.log('2. Run: npx prisma db push');
  console.log('3. Restart the bot to pick up new schema');
  console.log('4. Test with /pip_achievements command');
  console.log('5. Access admin panel at /admin/achievements');
}

main().catch((error) => {
  console.error('💥 Seeding failed:', error);
  process.exit(1);
});