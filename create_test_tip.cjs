// Create a fresh tip for testing timer and claim functionality
const { prisma } = require('./dist/services/db.js');

async function createTestTip() {
  console.log('🧪 Creating fresh test tip...\n');

  try {
    const creatorId = 1; // Assuming user ID 1 exists
    const tokenId = 1; // Assuming token ID 1 exists (probably $PENGUIN)
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes from now

    const tip = await prisma.groupTip.create({
      data: {
        creatorId: creatorId,
        tokenId: tokenId,
        totalAmount: 1000,
        status: 'ACTIVE',
        expiresAt: expiresAt,
        duration: 2, // 2 minutes duration
        channelId: '1074882281841360929', // Test channel
        messageId: null
      },
      include: {
        Creator: true,
        Token: true
      }
    });

    console.log(`✅ Created test tip ${tip.id}:`);
    console.log(`   - Total: ${tip.totalAmount} ${tip.Token.symbol}`);
    console.log(`   - Expires: ${tip.expiresAt.toISOString()}`);
    console.log(`   - Status: ${tip.status}`);
    console.log(`   - Creator: ${tip.Creator.discordId}`);
    console.log(`\n🔧 You can now test claims with tip ID: ${tip.id}`);

    return tip.id;
  } catch (error) {
    console.error('❌ Failed to create test tip:', error.message);
  }
}

createTestTip();