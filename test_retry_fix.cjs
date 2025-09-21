// Test the retry logic fix for stuck pending claims
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

async function testRetryLogic() {
  console.log('🧪 Testing retry logic for stuck pending claims...\n');

  try {
    // First claim - should work normally
    console.log('🔥 First claim attempt (should process normally)...');
    handleGroupTipClaim(mockInteraction, 81).catch(e => console.log('First claim result:', e.message));

    // Wait 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Second claim immediately - should be blocked
    console.log('\n🔥 Second claim attempt (should be blocked)...');
    handleGroupTipClaim(mockInteraction, 81).catch(e => console.log('Second claim result:', e.message));

    // Wait 6 seconds for retry logic to kick in
    console.log('\n⏳ Waiting 6 seconds for retry logic...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Third claim after timeout - should be allowed to retry
    console.log('\n🔧 Third claim attempt (should be allowed to retry)...');
    await handleGroupTipClaim(mockInteraction, 81);

    console.log('\n✅ Retry logic test completed');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testRetryLogic();