const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasourceUrl: "postgresql://neondb_owner:npg_jk3fVNRPhD4Q@ep-lingering-wildflower-afwekf33.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10&statement_timeout=5000&query_timeout=5000"
});

async function testTimerScheduling() {
  console.log('🧪 Testing timer scheduling for new group tips...');

  try {
    // Get or create the Discord client that's already running
    const { getDiscordClient } = await import('./dist/services/discord_users.js');
    const client = await getDiscordClient();

    if (!client) {
      console.log('❌ No Discord client available');
      return;
    }

    // Call processTip directly (this simulates the Discord command flow)
    const { processTip } = await import('./dist/services/tip_processor.js');

    console.log('📝 Creating group tip via processTip (simulating Discord command)...');
    console.log('👀 Watch for "🎯 ATTEMPTING TO SCHEDULE TIMER" logs in the main bot output...');

    const tipData = {
      amount: 30,
      tipType: "group",
      note: "Testing timer scheduling - should see scheduling logs",
      tokenId: 1, // PENGU
      duration: 1, // 1 minute for quick testing
      userId: "403807194308673537",
      guildId: "1074882281841360926",
      channelId: "1074882281841360929"
    };

    console.log('🚀 Calling processTip...');
    const result = await processTip(tipData, client);

    if (result.success) {
      console.log('✅ Group tip created successfully!');
      console.log('🔍 Check the main bot logs for these messages:');
      console.log('   - "🎯 ATTEMPTING TO SCHEDULE TIMER for group tip X..."');
      console.log('   - "✅ TIMER SCHEDULING COMPLETED for group tip X"');
      console.log('   - "⏱️ Scheduling timer for tip X: expires at..."');
    } else {
      console.log('❌ Failed to create group tip:', result.message);
      console.log('Details:', result.details);
    }

  } catch (error) {
    console.error('💥 Error during test:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testTimerScheduling();