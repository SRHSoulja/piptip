// scripts/rebuild_user_stats.ts - Rebuild user statistics from source data
import { rebuildUserStats } from '../src/services/stats_aggregator.js';
import { prisma } from '../src/services/db.js';

async function rebuildStats() {
  console.log('🔧 Starting user statistics rebuild...');

  try {
    const userCount = await prisma.user.count();
    console.log(`Found ${userCount} users to process`);

    if (userCount === 0) {
      console.log('No users found, skipping rebuild');
      return true;
    }

    // Rebuild all user stats
    await rebuildUserStats();
    console.log('✅ User statistics rebuild completed');

    // Verify the rebuild
    const statsCount = await prisma.userStats.count();
    console.log(`Created/updated ${statsCount} user statistics records`);

    console.log('🎉 Statistics rebuild completed successfully');
    return true;

  } catch (error) {
    console.error('❌ Statistics rebuild failed:', error);
    return false;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  rebuildStats()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Script error:', error);
      process.exit(1);
    });
}

export { rebuildStats };