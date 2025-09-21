const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasourceUrl: "postgresql://neondb_owner:npg_jk3fVNRPhD4Q@ep-lingering-wildflower-afwekf33.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10&statement_timeout=5000&query_timeout=5000"
});

// Mock Discord client for testing
const mockClient = {
  isReady: () => true,
  user: { username: 'MockBot' },
  channels: {
    fetch: async (channelId) => ({
      isTextBased: () => true,
      send: async (content) => {
        console.log('📤 Mock Discord send:', content.embeds?.[0]?.title || content.content);
        return {
          id: 'mock-message-id',
          channelId: channelId,
          edit: async () => {}
        };
      }
    })
  }
};

async function testProcessTip() {
  console.log('🧪 Testing processTip function directly...');
  console.log('🔍 This should trigger all the timer scheduling debug logs');

  try {
    // Import the processTip function
    const { processTip } = await import('./dist/services/tip_processor.js');

    console.log('📝 Calling processTip with mock client...');

    const tipData = {
      amount: 35,
      tipType: "group",
      note: "Direct processTip test - should see detailed logs",
      tokenId: 1, // PENGU
      duration: 1, // 1 minute for quick testing
      userId: "403807194308673537",
      guildId: "1074882281841360926",
      channelId: "1074882281841360929"
    };

    console.log('🚀 Processing tip...');
    const result = await processTip(tipData, mockClient);

    if (result.success) {
      console.log('✅ ProcessTip completed successfully!');
      console.log('🔍 Expected logs in this order:');
      console.log('   1. "🎯 ATTEMPTING TO SCHEDULE TIMER for group tip X..."');
      console.log('   2. "   📊 Tip details: expires=..."');
      console.log('   3. "   🤖 Client available: true, clientReady: true"');
      console.log('   4. "🔧 scheduleGroupTipExpiry called for tip X"');
      console.log('   5. "   🤖 Client status: ready=true, user=MockBot"');
      console.log('   6. "⏱️ Scheduling timer for tip X: expires at..."');
      console.log('   7. "✅ Timer scheduled for tip X, will fire in Y seconds"');
      console.log('   8. "✅ TIMER SCHEDULING COMPLETED for group tip X"');
    } else {
      console.log('❌ ProcessTip failed:', result.message);
      console.log('Details:', result.details);
    }

  } catch (error) {
    console.error('💥 Error during processTip test:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testProcessTip();