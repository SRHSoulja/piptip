// Test the fixed group tip expiry functionality
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

async function testFixedExpiry() {
  console.log('🧪 Testing fixed expiry functionality...\n');

  try {
    // Get test user
    const user = await prisma.user.findFirst({
      where: { discordId: '843340896518406154' }
    });

    if (!user) {
      console.log('❌ Test user not found');
      return;
    }

    // Get any available token
    const token = await prisma.token.findFirst({
      where: { active: true }
    });

    if (!token) {
      console.log('❌ No active tokens found');
      return;
    }

    console.log(`✅ Found test user: ${user.discordId}`);
    console.log(`✅ Found token: ${token.symbol}`);

    // Create a short 90-second group tip for testing
    const expiresAt = new Date(Date.now() + 90000); // 90 seconds from now

    const groupTip = await prisma.groupTip.create({
      data: {
        creatorId: user.id,
        tokenId: token.id,
        totalAmount: '50',
        channelId: '1074882290397315224',
        messageId: 'test-message-' + Date.now(),
        expiresAt: expiresAt,
        status: 'ACTIVE',
        duration: 90000  // 90 seconds in milliseconds
      }
    });

    console.log(`\n🎯 Created test group tip: ${groupTip.id}`);
    console.log(`   Amount: ${groupTip.totalAmount} ${token.symbol}`);
    console.log(`   Expires: ${expiresAt.toISOString()}`);
    console.log(`   In ${Math.ceil((expiresAt.getTime() - Date.now()) / 1000)} seconds`);

    console.log('\n📊 What to expect:');
    console.log('1. Bot should schedule a timer for this tip');
    console.log('2. After 90 seconds, the timer should fire');
    console.log('3. Tip should be finalized automatically');
    console.log('4. Attempts to claim expired tip should show early expiry message');

    console.log('\n🔍 Watch the bot logs for:');
    console.log(`   - "⏱️ Scheduling timer for tip ${groupTip.id}"`);
    console.log(`   - "⏰ Group tip ${groupTip.id} timer FIRED!"`);
    console.log(`   - "✅ Group tip ${groupTip.id} expiry processing COMPLETED"`);

    console.log('\n💡 To test claim handling:');
    console.log('   - Try claiming BEFORE expiry (should work if you have balance)');
    console.log('   - Try claiming AFTER expiry (should show "⏰ This group tip has expired!")');

    // Show current timer status
    const response = await fetch('http://localhost:3000/health/monitoring');
    const status = await response.json();

    if (status.timers) {
      console.log('\n⏲️ Current active timers:');
      status.timers.forEach(timer => {
        console.log(`   Tip ${timer.tipId}: expires in ${Math.ceil(timer.expiresIn / 1000)}s`);
      });
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testFixedExpiry();