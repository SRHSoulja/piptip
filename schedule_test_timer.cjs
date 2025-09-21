// Manual timer scheduling for test tip 81
const { scheduleGroupTipExpiry } = require('./dist/features/group_tip_expiry.js');

// Mock client object for testing
const mockClient = {
  isReady: () => true,
  user: { username: 'PIPtip#7983' },
  client: true
};

async function scheduleTestTimer() {
  console.log('🔧 Manually scheduling timer for test tip 81...');

  try {
    await scheduleGroupTipExpiry(mockClient, 81);
    console.log('✅ Timer scheduled successfully');
  } catch (error) {
    console.error('❌ Timer scheduling failed:', error.message);
  }
}

scheduleTestTimer();