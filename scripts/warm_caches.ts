// scripts/warm_caches.ts - Warm up Redis caches
import { warmLeaderboardCache, cacheHealthCheck } from '../src/services/achievement_cache.js';

async function warmCaches() {
  console.log('🔥 Warming up caches...');

  try {
    // Check Redis connection
    const isHealthy = await cacheHealthCheck();
    if (!isHealthy) {
      console.warn('⚠️ Redis not available, skipping cache warming');
      return false;
    }

    // Warm up leaderboard caches
    await warmLeaderboardCache();
    console.log('✅ Leaderboard caches warmed');

    console.log('🎉 Cache warming completed');
    return true;

  } catch (error) {
    console.error('❌ Cache warming failed:', error);
    return false;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  warmCaches()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Script error:', error);
      process.exit(1);
    });
}

export { warmCaches };