#!/usr/bin/env node

// test_button_creation.js - Test button creation to find issues

async function testButtonCreation() {
  try {
    console.log('🔍 Testing button creation...');

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');

    console.log('✅ Discord.js imported successfully');

    // Test creating the duration buttons exactly like the code does
    const durationButtons = [
      { label: "1 min", value: 1, emoji: "⚡" },
      { label: "3 min", value: 3, emoji: "💨" },
      { label: "5 min", value: 5, emoji: "🔥" },
      { label: "10 min", value: 10, emoji: "⏰" },
      { label: "15 min", value: 15, emoji: "🕐" }
    ].map(d =>
      new ButtonBuilder()
        .setCustomId(`pip:select_duration:50:test:1:${d.value}`)
        .setLabel(d.label)
        .setStyle(ButtonStyle.Primary)
        .setEmoji(d.emoji)
    );

    console.log(`✅ Created ${durationButtons.length} primary duration buttons`);

    const extendedDurationButtons = [
      { label: "30 min", value: 30, emoji: "🕕" },
      { label: "1 hour", value: 60, emoji: "🕒" },
      { label: "2 hours", value: 120, emoji: "🕓" },
      { label: "6 hours", value: 360, emoji: "🕕" },
      { label: "24 hours", value: 1440, emoji: "📅" }
    ].map(d =>
      new ButtonBuilder()
        .setCustomId(`pip:select_duration:50:test:1:${d.value}`)
        .setLabel(d.label)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(d.emoji)
    );

    console.log(`✅ Created ${extendedDurationButtons.length} extended duration buttons`);

    // Test creating action rows
    const actionRow1 = new ActionRowBuilder().addComponents(durationButtons);
    const actionRow2 = new ActionRowBuilder().addComponents(extendedDurationButtons);

    console.log('✅ Created action rows successfully');
    console.log(`📊 Row 1: ${actionRow1.components.length} buttons`);
    console.log(`📊 Row 2: ${actionRow2.components.length} buttons`);

    // Test the components array
    const components = [actionRow1, actionRow2];
    console.log(`📊 Total action rows: ${components.length}`);

    console.log('🎉 Button creation test passed! The issue must be elsewhere.');

    // Check if the function exists
    const { showDurationSelection } = await import('./dist/interactions/buttons/tips.js');
    console.log('✅ showDurationSelection function exists');

  } catch (error) {
    console.error('❌ Error during button creation test:', error);
    console.error('Stack trace:', error.stack);
  }
}

testButtonCreation();