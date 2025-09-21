// Test the early expiry check functionality for tip 81
const { handleGroupTipClaim } = require('./dist/interactions/group_tip_buttons.js');

// Mock Discord interaction
const mockInteraction = {
  user: { id: '843340896518406154' },
  deferReply: () => Promise.resolve(),
  editReply: (content) => {
    console.log('📱 Bot response:', content.content || content);
    return Promise.resolve();
  }
};

async function testExpiredClaim() {
  console.log('🧪 Testing early expiry check for tip 81...\n');

  try {
    console.log('🔥 Simulating claim attempt on expired tip 81...');
    await handleGroupTipClaim(mockInteraction, 81);
    console.log('\n✅ Test completed successfully');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testExpiredClaim();