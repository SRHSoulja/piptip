// scripts/maintain_daily_stats.ts - Daily statistics maintenance
import { updateDailyStats } from '../src/services/stats_aggregator.js';
import { maintainCache } from '../src/services/achievement_cache.js';

async function runDailyMaintenance() {
  console.log('🔄 Starting daily statistics maintenance...');

  try {
    // Update daily aggregated statistics
    await updateDailyStats();
    console.log('✅ Daily stats updated');

    // Maintain cache (clean old entries, warm new ones)
    await maintainCache();
    console.log('✅ Cache maintenance completed');

    console.log('🎉 Daily maintenance completed successfully');
    return true;

  } catch (error) {
    console.error('❌ Daily maintenance failed:', error);
    return false;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyMaintenance()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Script error:', error);
      process.exit(1);
    });
}

export { runDailyMaintenance };