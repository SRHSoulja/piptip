// Test script to verify P/I/P match unlocking behavior
// Ensures matches don't get permanently locked when users lack funds

import { prisma } from './src/services/db.js';

async function testMatchUnlockBehavior() {
  console.log('🧪 Testing P/I/P match unlock behavior...');

  try {
    // Create a test user with insufficient balance
    const testUser = await prisma.user.create({
      data: {
        discordId: 'test_poor_user_' + Date.now()
      }
    });

    // Create a test match in OFFERED status
    const testMatch = await prisma.match.create({
      data: {
        challengerId: 1, // Assuming user ID 1 exists
        tokenId: 1, // Assuming token ID 1 exists
        wagerAtomic: "1000000000000000000", // 1 token (large amount)
        status: "OFFERED",
        challengerMove: "ROCK",
        offerDeadline: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    console.log(`Created test match ${testMatch.id} for user with no balance`);

    // Verify match starts as OFFERED
    let matchStatus = await prisma.match.findUnique({
      where: { id: testMatch.id },
      select: { status: true }
    });
    console.log(`✅ Initial match status: ${matchStatus?.status}`);

    // Simulate the atomic lock operation that would happen in handleJoin
    const lockResult = await prisma.$transaction(async (tx) => {
      // This simulates the exact atomic lock logic
      const lockAttempt = await tx.match.updateMany({
        where: {
          id: testMatch.id,
          status: "OFFERED"
        },
        data: { status: "LOCKED" }
      });

      if (lockAttempt.count === 0) {
        throw new Error("Could not lock match");
      }

      console.log(`🔒 Match locked successfully`);

      // Simulate insufficient funds error and unlock
      try {
        // This would be where debitTokenTx fails
        throw new Error("Insufficient balance for wager");
      } catch (balanceError) {
        // UNLOCK THE MATCH immediately if user lacks funds
        await tx.match.update({
          where: { id: testMatch.id },
          data: { status: "OFFERED" }
        });
        console.log(`🔓 Match unlocked due to insufficient funds`);
        throw balanceError;
      }
    }).catch(err => {
      console.log(`Expected transaction error: ${err.message}`);
      return null;
    });

    // Verify match is back to OFFERED status
    matchStatus = await prisma.match.findUnique({
      where: { id: testMatch.id },
      select: { status: true }
    });

    console.log(`✅ Final match status: ${matchStatus?.status}`);

    if (matchStatus?.status === "OFFERED") {
      console.log('🎉 MATCH UNLOCK TEST SUCCESSFUL!');
      console.log('   ✅ Match properly unlocks when user lacks funds');
      console.log('   ✅ Other users can now join the match');
    } else {
      console.log('❌ MATCH UNLOCK TEST FAILED!');
      console.log(`   Expected status: OFFERED, got: ${matchStatus?.status}`);
    }

    // Test rapid clicking scenario
    console.log('\n🏃 Testing rapid clicking scenario...');

    const rapidPromises = Array.from({ length: 5 }, async (_, i) => {
      try {
        return await prisma.$transaction(async (tx) => {
          const lockAttempt = await tx.match.updateMany({
            where: { id: testMatch.id, status: "OFFERED" },
            data: { status: "LOCKED" }
          });

          if (lockAttempt.count === 0) {
            return { user: i, result: 'already_locked' };
          }

          // Simulate some processing time
          await new Promise(resolve => setTimeout(resolve, 10));

          // Simulate failure and unlock
          await tx.match.update({
            where: { id: testMatch.id },
            data: { status: "OFFERED" }
          });

          return { user: i, result: 'unlocked' };
        });
      } catch (error) {
        return { user: i, result: 'error', error: error };
      }
    });

    const rapidResults = await Promise.allSettled(rapidPromises);
    console.log('Rapid click results:', rapidResults.map(r =>
      r.status === 'fulfilled' ? r.value : { error: r.reason }
    ));

    // Cleanup
    await prisma.match.delete({ where: { id: testMatch.id } });
    await prisma.user.delete({ where: { id: testUser.id } });

    console.log('🧹 Test cleanup completed');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run test if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testMatchUnlockBehavior().catch(console.error);
}

export { testMatchUnlockBehavior };