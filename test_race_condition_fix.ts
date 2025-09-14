// Test script to verify P/I/P race condition fix
// This will simulate 100 concurrent join attempts to ensure only one succeeds

import { prisma } from './src/services/db.js';
import { handleJoin } from './src/interactions/buttons/matches.js';
import type { ButtonInteraction } from 'discord.js';

async function testRaceConditionFix() {
  console.log('🧪 Testing P/I/P race condition fix...');

  // Create a test match in OFFERED status
  const testMatch = await prisma.match.create({
    data: {
      challengerId: 1, // Assuming user ID 1 exists
      tokenId: 1, // Assuming token ID 1 exists
      wagerAtomic: "1000000000000000000", // 1 token
      status: "OFFERED",
      challengerMove: "ROCK",
      offerDeadline: new Date(Date.now() + 10 * 60 * 1000)
    }
  });

  console.log(`Created test match ${testMatch.id}`);

  // Mock interaction objects for 100 different users
  const mockInteractions = Array.from({ length: 100 }, (_, i) => ({
    deferReply: () => Promise.resolve(),
    followUp: (opts: any) => Promise.resolve(),
    user: { id: `user_${i + 2}` }, // Different users (not challenger)
    guildId: 'test_guild',
    channelId: 'test_channel'
  })) as unknown as ButtonInteraction[];

  // Attempt to join simultaneously
  const promises = mockInteractions.map(interaction =>
    handleJoin(interaction, testMatch.id, 'PAPER').catch(err => err.message)
  );

  const results = await Promise.allSettled(promises);

  // Count successes and failures
  const successes = results.filter(r => r.status === 'fulfilled' && typeof r.value !== 'string').length;
  const failures = results.filter(r => r.status === 'fulfilled' && typeof r.value === 'string').length;
  const errors = results.filter(r => r.status === 'rejected').length;

  console.log(`✅ Results:`);
  console.log(`   Successful joins: ${successes}`);
  console.log(`   Failed joins: ${failures}`);
  console.log(`   Errors: ${errors}`);

  // Check final match status
  const finalMatch = await prisma.match.findUnique({
    where: { id: testMatch.id },
    select: { status: true, joinerId: true }
  });

  console.log(`   Final match status: ${finalMatch?.status}`);
  console.log(`   Joiner assigned: ${finalMatch?.joinerId ? 'Yes' : 'No'}`);

  // Verify exactly one success
  if (successes === 1 && finalMatch?.status === 'SETTLED') {
    console.log('🎉 RACE CONDITION FIX SUCCESSFUL!');
    console.log('   ✅ Only one user could join');
    console.log('   ✅ Match properly settled');
  } else {
    console.log('❌ RACE CONDITION FIX FAILED!');
    console.log(`   Expected 1 success, got ${successes}`);
  }

  // Cleanup
  await prisma.match.delete({ where: { id: testMatch.id } });
}

// Run test if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testRaceConditionFix().catch(console.error);
}