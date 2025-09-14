#!/usr/bin/env npx tsx
// scripts/migrate_to_dynamic_achievements.ts - Migrate from static to dynamic achievement system

import { prisma } from '../src/services/db.js';
import { invalidateDefinitionCache } from '../src/services/dynamic_achievements.js';

// Mapping from legacy achievement types to new dynamic definitions
const legacyMapping = {
  'win_streak': {
    levels: [3, 5, 10, 15, 25, 50, 100],
    definitionNames: [
      'Hot Streak', 'Win Streak 5', 'Win Streak 10',
      'Win Streak 15', 'Unstoppable', 'Win Streak 50',
      'Legendary Streak'
    ]
  },
  'total_tips': {
    levels: [1, 10, 50, 100, 500],
    definitionNames: [
      'First Tip', 'Tipper 10', 'Generous Tipper',
      'Tipper 100', 'Tip Master'
    ]
  },
  'deposit_milestone': {
    levels: [100, 250, 500, 1000, 2500, 5000],
    definitionNames: [
      'First Deposit', 'Deposit 250', 'Deposit 500',
      'Deposit Milestone', 'Big Deposit', 'Whale Deposit'
    ]
  },
  'referral_count': {
    levels: [1, 5, 10, 25],
    definitionNames: [
      'First Referral', 'Referrer 5', 'Social Butterfly', 'Referral Champion'
    ]
  }
};

async function migrateLegacyAchievements() {
  console.log('🔄 Starting migration from static to dynamic achievement system...\n');

  try {
    // Step 1: Get all legacy achievements
    const legacyAchievements = await prisma.achievement.findMany({
      include: {
        user: { select: { id: true, discordId: true } }
      },
      orderBy: [{ userId: 'asc' }, { type: 'asc' }, { level: 'asc' }]
    });

    console.log(`📊 Found ${legacyAchievements.length} legacy achievements to migrate`);

    if (legacyAchievements.length === 0) {
      console.log('✅ No legacy achievements found. Migration not needed.');
      return;
    }

    // Step 2: Ensure dynamic definitions exist
    const definitions = await prisma.achievementDefinition.findMany();
    const definitionsByName = new Map(definitions.map(def => [def.name, def]));

    console.log(`📋 Found ${definitions.length} dynamic achievement definitions`);

    // Step 3: Migrate achievements
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const legacy of legacyAchievements) {
      try {
        // Find corresponding dynamic definition
        const mapping = (legacyMapping as any)[legacy.type];
        if (!mapping) {
          console.log(`⚠️  No mapping found for legacy type: ${legacy.type} (level ${legacy.level})`);
          skipped++;
          continue;
        }

        const levelIndex = mapping.levels.indexOf(legacy.level);
        if (levelIndex === -1) {
          console.log(`⚠️  No mapping found for ${legacy.type} level ${legacy.level}`);
          skipped++;
          continue;
        }

        const definitionName = mapping.definitionNames[levelIndex];
        const definition = definitionsByName.get(definitionName);

        if (!definition) {
          console.log(`❌ Dynamic definition not found: ${definitionName}`);
          errors++;
          continue;
        }

        // Check if already migrated
        const existing = await prisma.userAchievement.findUnique({
          where: {
            userId_definitionId: {
              userId: legacy.userId,
              definitionId: definition.id
            }
          }
        });

        if (existing) {
          console.log(`⏭️  Already migrated: ${legacy.user.discordId} → ${definition.name}`);
          skipped++;
          continue;
        }

        // Create new dynamic achievement
        await prisma.userAchievement.create({
          data: {
            userId: legacy.userId,
            definitionId: definition.id,
            currentProgress: Number(definition.threshold),
            targetProgress: Number(definition.threshold),
            unlockedAt: legacy.unlockedAt,
            lastUnlockedAt: legacy.unlockedAt,
            unlockCount: 1,
            data: {
              migratedFrom: {
                type: legacy.type,
                level: legacy.level,
                originalId: legacy.id,
                originalData: legacy.data
              },
              migrationDate: new Date().toISOString()
            }
          }
        });

        // Create/update progress tracking
        await prisma.userAchievementProgress.upsert({
          where: {
            userId_definitionId: {
              userId: legacy.userId,
              definitionId: definition.id
            }
          },
          create: {
            userId: legacy.userId,
            definitionId: definition.id,
            currentProgress: Number(definition.threshold),
            lastProgressAt: legacy.unlockedAt,
            lastCheckedAt: new Date(),
            progressData: {
              migratedFrom: legacy.type,
              migrationDate: new Date().toISOString()
            }
          },
          update: {
            currentProgress: Number(definition.threshold),
            lastProgressAt: legacy.unlockedAt,
            lastCheckedAt: new Date()
          }
        });

        migrated++;
        console.log(`✅ Migrated: ${legacy.user.discordId} → ${definition.name}`);

      } catch (error) {
        errors++;
        console.error(`❌ Error migrating ${legacy.user.discordId} ${legacy.type}:${legacy.level}:`, error);
      }
    }

    // Step 4: Update user stats
    console.log('\\n📈 Updating user achievement counts...');
    const userAchievementCounts = await prisma.userAchievement.groupBy({
      by: ['userId'],
      _count: { id: true }
    });

    for (const userCount of userAchievementCounts) {
      await prisma.userStats.upsert({
        where: { userId: userCount.userId },
        create: {
          userId: userCount.userId,
          achievementCount: userCount._count.id
        },
        update: {
          achievementCount: userCount._count.id
        }
      });
    }

    // Step 5: Invalidate caches
    invalidateDefinitionCache();

    // Results
    console.log('\\n🎉 Migration Summary:');
    console.log(`   ✅ Migrated: ${migrated} achievements`);
    console.log(`   ⏭️  Skipped: ${skipped} achievements`);
    console.log(`   ❌ Errors: ${errors} achievements`);
    console.log(`   📊 Total processed: ${legacyAchievements.length} achievements`);

    // Step 6: Optional cleanup prompt
    if (migrated > 0 && errors === 0) {
      console.log('\\n🗑️  Legacy Cleanup:');
      console.log('   To remove legacy achievements after verifying migration:');
      console.log('   npx tsx scripts/migrate_to_dynamic_achievements.ts --cleanup');
      console.log('');
      console.log('⚠️  IMPORTANT: Test the dynamic system thoroughly before cleanup!');
    }

  } catch (error) {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  }
}

async function cleanupLegacyAchievements() {
  console.log('🗑️  Starting legacy achievement cleanup...');

  const confirmed = process.argv.includes('--confirm');

  if (!confirmed) {
    console.log('⚠️  This will permanently delete all legacy achievements!');
    console.log('   Add --confirm flag to proceed: --cleanup --confirm');
    return;
  }

  try {
    const result = await prisma.achievement.deleteMany({});
    console.log(`✅ Deleted ${result.count} legacy achievements`);

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    throw error;
  }
}

async function main() {
  const isCleanup = process.argv.includes('--cleanup');

  if (isCleanup) {
    await cleanupLegacyAchievements();
  } else {
    await migrateLegacyAchievements();
  }

  console.log('\\n🎯 Next Steps:');
  console.log('1. Test achievement commands: /pip_achievements');
  console.log('2. Check admin panel: /admin/achievements');
  console.log('3. Monitor real-time activity');
  console.log('4. Run batch processing if needed');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});