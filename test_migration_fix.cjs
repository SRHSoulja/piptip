// Test if the totalXP column migration was successful
const { prisma } = require('./dist/services/db.js');

async function testMigrationFix() {
  console.log('🧪 Testing database migration fix for totalXP column...\n');

  try {
    // Test the exact operation that was failing before
    const testUserId = 7; // Using existing user ID from previous tests

    console.log('1️⃣ Testing user.upsert operation that previously failed...');

    const user = await prisma.user.upsert({
      where: { id: testUserId },
      update: {
        totalXP: 100  // This should work now that totalXP column exists
      },
      create: {
        discordId: '123456789', // Won't be used since user exists
        totalXP: 100
      }
    });

    console.log('✅ Success! User upsert operation completed:');
    console.log(`   - User ID: ${user.id}`);
    console.log(`   - Discord ID: ${user.discordId}`);
    console.log(`   - Total XP: ${user.totalXP}`);

    console.log('\n2️⃣ Testing direct totalXP column access...');

    const userWithXP = await prisma.user.findUnique({
      where: { id: testUserId },
      select: {
        id: true,
        discordId: true,
        totalXP: true
      }
    });

    console.log('✅ Success! Direct totalXP access works:');
    console.log(`   - User ID: ${userWithXP.id}`);
    console.log(`   - Discord ID: ${userWithXP.discordId}`);
    console.log(`   - Total XP: ${userWithXP.totalXP}`);

    console.log('\n✅ All tests passed! The totalXP migration was successful.');
    console.log('🎉 Bot should now work properly without "column does not exist" errors.');

  } catch (error) {
    console.error('❌ Migration test failed:', error.message);

    if (error.message.includes('totalXP does not exist')) {
      console.error('💡 The migration did not complete successfully.');
      console.error('   Railway might need more time or the build failed.');
    }
  }
}

testMigrationFix();