// Test finalizing group tip 69 after expiry
const { resilientDb } = require('./dist/services/resilient_db.js');

async function testFinalization() {
  console.log('Testing finalization for group tip 69...');

  // Check group tip status first
  const groupTip = await resilientDb.findGroupTip(69);
  if (!groupTip) {
    console.log('❌ Group tip 69 not found');
    return;
  }

  console.log('Group tip status before finalization:', {
    id: groupTip.id,
    status: groupTip.status,
    expiresAt: groupTip.expiresAt,
    totalAmount: groupTip.totalAmount,
    claims: groupTip.claims.map(c => ({
      userId: c.User?.discordId,
      status: c.status,
      createdAt: c.createdAt
    }))
  });

  const timeRemaining = Math.max(0, (groupTip.expiresAt.getTime() - Date.now()) / 1000);
  console.log(`⏰ Time until expiry: ${timeRemaining} seconds`);

  if (timeRemaining > 0) {
    console.log('⏳ Waiting for expiry...');
    await new Promise(resolve => setTimeout(resolve, (timeRemaining + 1) * 1000));
  }

  console.log('🏁 Triggering finalization...');
  try {
    const result = await resilientDb.finalizeGroupTip(69);
    console.log('✅ Finalization result:', result);
  } catch (error) {
    console.log('❌ Finalization failed:', error.message);
  }

  // Check final status
  const finalTip = await resilientDb.findGroupTip(69);
  console.log('Group tip status after finalization:', {
    id: finalTip.id,
    status: finalTip.status,
    claims: finalTip.claims.map(c => ({
      userId: c.User?.discordId,
      status: c.status,
      createdAt: c.createdAt,
      claimedAt: c.claimedAt
    }))
  });
}

testFinalization().catch(console.error).finally(() => process.exit(0));