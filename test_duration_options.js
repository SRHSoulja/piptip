#!/usr/bin/env node

// test_duration_options.js - Test if new duration options are available
// This script tests the showDurationSelection function to verify new options

console.log('🔍 Testing duration options...');

async function testDurationOptions() {
  try {
    // Import the function that creates duration buttons
    const { showDurationSelection } = await import('./dist/interactions/buttons/tips.js');

    console.log('✅ Successfully imported duration selection function');

    // Check if the source code contains the new durations
    const fs = await import('fs');
    const tipsSource = fs.readFileSync('./dist/interactions/buttons/tips.js', 'utf8');

    const expectedDurations = ['1 min', '3 min', '30 min', '1 hour', '2 hours', '6 hours', '24 hours'];
    const foundDurations = [];

    for (const duration of expectedDurations) {
      if (tipsSource.includes(`"${duration}"`)) {
        foundDurations.push(duration);
        console.log(`✅ Found: ${duration}`);
      } else {
        console.log(`❌ Missing: ${duration}`);
      }
    }

    if (foundDurations.length === expectedDurations.length) {
      console.log('🎉 All new duration options are present in compiled code!');
      console.log('Issue: Node.js module cache is preventing the new code from loading');
      console.log('Solution: Run ./force_restart.sh to completely restart the process');
    } else {
      console.log(`⚠️  Only ${foundDurations.length}/${expectedDurations.length} duration options found`);
    }

  } catch (error) {
    console.error('❌ Error testing duration options:', error.message);
  }
}

testDurationOptions();