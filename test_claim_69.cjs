// Test claiming group tip 69
const { resilientDb } = require('./dist/services/resilient_db.js');

async function testClaim() {
  console.log('Testing claim functionality for group tip 69...');

  // Check group tip status first
  const groupTip = await resilientDb.findGroupTip(69);
  if (!groupTip) {
    console.log('❌ Group tip 69 not found');
    return;
  }

  console.log('Group tip status:', {
    id: groupTip.id,
    status: groupTip.status,
    expiresAt: groupTip.expiresAt,
    totalAmount: groupTip.totalAmount,
    Creator: groupTip.Creator ? { discordId: groupTip.Creator.discordId } : null
  });

  const timeRemaining = Math.max(0, (groupTip.expiresAt.getTime() - Date.now()) / 1000);
  console.log(`⏰ Time remaining: ${timeRemaining} seconds`);

  if (timeRemaining <= 0) {
    console.log('❌ Group tip has expired');
    return;
  }

  if (groupTip.status !== 'ACTIVE') {
    console.log('❌ Group tip is not active');
    return;
  }

  // Attempt to claim
  console.log('🎯 Attempting to claim...');
  try {
    const result = await resilientDb.processGroupTipClaim(69, '843340896518406154'); // Test user
    console.log('✅ Claim result:', result);
  } catch (error) {
    console.log('❌ Claim failed:', error.message);
  }
}

testClaim().catch(console.error).finally(() => process.exit(0));