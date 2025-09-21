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

async function testAggressiveRetryLogic() {
  console.log('🧪 Testing aggressive retry logic...');

  try {
    // Create a 5-second group tip that will expire quickly
    const { processTip } = await import('./dist/services/tip_processor.js');

    console.log('📝 Creating short-lived group tip to test retry logic...');

    const tipData = {
      amount: 10,
      tipType: "group",
      note: "Test retry logic - 5 second tip",
      tokenId: 1, // PENGU
      duration: 1, // 1 minute for testing
      userId: "403807194308673537",
      guildId: "1074882281841360926",
      channelId: "1074882281841360929"
    };

    console.log('🚀 Processing tip...');
    const result = await processTip(tipData, mockClient);

    if (result.success) {
      console.log(`✅ Created group tip ${result.id} that expires in 5 seconds`);
      console.log('⏳ Waiting for timer to fire and testing aggressive retry logic...');
      console.log('🔍 Expected retry logs:');
      console.log('   1. "📊 Database finalization attempt 1/3"');
      console.log('   2. "🔄 Discord update attempt 1/5"');
      console.log('   3. Multiple retry attempts if Discord update fails');
      console.log('   4. "🚨 Final desperate attempt" if all retries fail');

      // Wait for the tip to expire and see the retry logic in action
      await new Promise(resolve => setTimeout(resolve, 8000));

      console.log('✅ Test completed - check logs above for aggressive retry behavior');
    } else {
      console.log('❌ Failed to create test tip:', result.message);
    }

  } catch (error) {
    console.error('💥 Error during retry test:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testAggressiveRetryLogic();