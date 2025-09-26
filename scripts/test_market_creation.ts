// Test automatic market creation
import { marketAutomationScheduler } from '../src/services/market_automation_scheduler.js';

async function testMarkets() {
  console.log('🧪 Testing automatic market creation...\n');

  // Get status first
  const status = marketAutomationScheduler.getStatus();
  console.log('📊 Current status:', {
    enabled: status.enabled,
    dailyCreated: status.dailyCreated,
    dailyLimit: status.dailyLimit,
    scheduledJobs: status.scheduledJobs
  });

  // Execute market creation
  console.log('\n🚀 Executing market creation...\n');
  await marketAutomationScheduler.executeMarketCreation();

  // Check status after
  const newStatus = marketAutomationScheduler.getStatus();
  console.log('\n📊 Status after execution:', {
    dailyCreated: newStatus.dailyCreated,
    todaysLogs: newStatus.todaysLogs.length
  });

  console.log('\n✅ Market creation test complete!');
  process.exit(0);
}

testMarkets().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});