// Create a 30-second tip for testing the timeout fix
const { prisma } = require('./dist/services/db.js');

async function createTestTip() {
  console.log('🧪 Creating 30-second test tip for timeout testing...\n');

  try {
    const creatorId = 7; // Using existing user ID 7
    const tokenId = 1; // Assuming token ID 1 exists (probably $PENGUIN)
    const expiresAt = new Date(Date.now() + 30 * 1000); // 30 seconds from now

    const tip = await prisma.groupTip.create({
      data: {
        creatorId: creatorId,
        tokenId: tokenId,
        totalAmount: 1000,
        status: 'ACTIVE',
        expiresAt: expiresAt,
        duration: 0.5, // 30 seconds duration
        channelId: '1074882281841360929', // Test channel
        messageId: null
      },
      include: {
        Creator: true,
        Token: true
      }
    });

    console.log(`✅ Created 30-second test tip ${tip.id}:`);
    console.log(`   - Total: ${tip.totalAmount} ${tip.Token.symbol}`);
    console.log(`   - Expires: ${tip.expiresAt.toISOString()}`);
    console.log(`   - Status: ${tip.status}`);
    console.log(`   - Creator: ${tip.Creator.discordId}`);
    console.log(`\n🔧 You can test claims with tip ID: ${tip.id}`);
    console.log(`⏰ This tip will expire in 30 seconds - perfect for testing the timeout fix!`);

    return tip.id;
  } catch (error) {
    console.error('❌ Failed to create test tip:', error.message);
  }
}

createTestTip();