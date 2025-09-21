// Check what users exist in the database
const { prisma } = require('./dist/services/db.js');

async function checkUsers() {
  console.log('🔍 Checking users in database...\n');

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        discordId: true
      },
      take: 10
    });

    const tokens = await prisma.token.findMany({
      select: {
        id: true,
        symbol: true
      }
    });

    console.log('👥 Users:');
    users.forEach(user => {
      console.log(`   ${user.id}: ${user.discordId}`);
    });

    console.log('\n🪙 Tokens:');
    tokens.forEach(token => {
      console.log(`   ${token.id}: ${token.symbol}`);
    });

    if (users.length > 0) {
      return { userId: users[0].id, tokenId: tokens[0]?.id || 1 };
    }
    return null;
  } catch (error) {
    console.error('❌ Failed to check users:', error.message);
  }
}

checkUsers().then(result => {
  if (result) {
    console.log(`\n✅ Can use userId: ${result.userId}, tokenId: ${result.tokenId}`);
  }
});