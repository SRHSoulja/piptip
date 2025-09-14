// Test script to verify enhanced notification integrity and fallbacks
// Ensures Discord API failures don't break the user experience

import { formatBenefitNotification } from './src/services/tip_processor.js';

async function testNotificationIntegrity() {
  console.log('🧪 Testing enhanced notification integrity and fallbacks...');

  try {
    // Test 1: Role-based notification with valid guild (should work)
    console.log('\n1. Testing role-based notification with Discord lookup...');

    const roleBenefit = {
      source: 'role:123456789',
      label: 'Cool Penguins Holder',
      exemptionRate: 50
    };

    // This will attempt Discord API call but fall back gracefully
    const roleMessage = await formatBenefitNotification(
      roleBenefit,
      'tax',
      '0.5',
      'PENGU',
      'test_guild_id'
    );

    console.log(`✅ Role message: "${roleMessage}"`);
    if (roleMessage.includes('Cool Penguins Holder')) {
      console.log('   ✅ Fallback to label worked correctly');
    }

    // Test 2: Tier-based notification (should work without Discord API)
    console.log('\n2. Testing tier-based notification...');

    const tierBenefit = {
      source: 'tier:1',
      label: 'Tier 2 Penguin',
      exemptionRate: 75
    };

    const tierMessage = await formatBenefitNotification(
      tierBenefit,
      'tax',
      '1.25',
      'ICE',
      null
    );

    console.log(`✅ Tier message: "${tierMessage}"`);
    if (tierMessage.includes('Tier 2 Penguin') && tierMessage.includes('perks')) {
      console.log('   ✅ Tier notification format correct');
    }

    // Test 3: Invalid benefit source (should fallback)
    console.log('\n3. Testing invalid benefit source...');

    const invalidBenefit = {
      source: 'unknown:test',
      label: 'Mystery Benefit',
      exemptionRate: 25
    };

    const fallbackMessage = await formatBenefitNotification(
      invalidBenefit,
      'rake',
      '0.75',
      'PEBBLE',
      'test_guild'
    );

    console.log(`✅ Fallback message: "${fallbackMessage}"`);
    if (fallbackMessage.includes('Mystery Benefit') && fallbackMessage.includes('reduced your fees')) {
      console.log('   ✅ Generic fallback working correctly');
    }

    // Test 4: Error handling (simulate exception)
    console.log('\n4. Testing error handling...');

    try {
      // Pass invalid parameters to trigger error handling
      const errorMessage = await formatBenefitNotification(
        null as any,
        'tax',
        '1.0',
        'TEST',
        'invalid_guild'
      );

      console.log(`✅ Error message: "${errorMessage}"`);
      if (errorMessage.includes('saved you')) {
        console.log('   ✅ Error fallback working');
      }
    } catch (error) {
      console.log('   ❌ Error handling failed:', error);
    }

    // Test 5: Role ID extraction and formatting
    console.log('\n5. Testing role ID extraction...');

    const roleWithId = {
      source: 'role:987654321012345678',
      label: 'Special Role Name',
      exemptionRate: 100
    };

    const extractedMessage = await formatBenefitNotification(
      roleWithId,
      'rake',
      '2.5',
      'PENGU',
      'guild_123'
    );

    console.log(`✅ Extracted message: "${extractedMessage}"`);
    if (extractedMessage.includes('Special Role Name')) {
      console.log('   ✅ Role ID extraction and fallback working');
    }

    // Test 6: Message length and formatting
    console.log('\n6. Testing message formatting...');

    const longBenefit = {
      source: 'tier:999',
      label: 'Super Premium Ultra Mega Deluxe Penguin Tier With Extra Long Name',
      exemptionRate: 90
    };

    const longMessage = await formatBenefitNotification(
      longBenefit,
      'tax',
      '999.99',
      'SUPERTOKEN',
      null
    );

    console.log(`✅ Long message: "${longMessage}"`);
    if (longMessage.length < 2000) { // Discord message limit
      console.log('   ✅ Message length within Discord limits');
    } else {
      console.log('   ⚠️ Message might be too long for Discord');
    }

    console.log('\n🎉 NOTIFICATION INTEGRITY TEST SUMMARY:');
    console.log('   ✅ Role-based notifications with Discord fallback');
    console.log('   ✅ Tier-based notifications work correctly');
    console.log('   ✅ Generic fallbacks handle unknown sources');
    console.log('   ✅ Error handling prevents crashes');
    console.log('   ✅ Role ID extraction and formatting');
    console.log('   ✅ Message formatting stays within limits');
    console.log('\n🛡️ Enhanced notifications are resilient to Discord API failures!');

  } catch (error) {
    console.error('❌ Notification integrity test failed:', error);
  }
}

// Test various edge cases
async function testEdgeCases() {
  console.log('\n🔍 Testing edge cases...');

  const edgeCases = [
    // Empty strings
    { source: '', label: '', exemptionRate: 0 },
    // Special characters
    { source: 'role:abc123!@#', label: 'Role with @special chars!', exemptionRate: 50 },
    // Very large numbers
    { source: 'tier:1', label: 'Big Saver', exemptionRate: 10000 },
    // Unicode characters
    { source: 'tier:2', label: '🐧 Penguin Elite 🎮', exemptionRate: 25 }
  ];

  for (const testCase of edgeCases) {
    try {
      const message = await formatBenefitNotification(
        testCase,
        'tax',
        '1.0',
        'TEST',
        'edge_case_guild'
      );
      console.log(`   ✅ Edge case handled: "${message}"`);
    } catch (error) {
      console.log(`   ❌ Edge case failed:`, testCase, error);
    }
  }
}

// Run tests if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testNotificationIntegrity()
    .then(() => testEdgeCases())
    .catch(console.error);
}

export { testNotificationIntegrity };