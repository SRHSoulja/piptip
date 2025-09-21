const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log('🤖 Discord client ready - simulating tip creation...');

  // Simulate the Discord tip creation flow by directly calling processTip
  (async () => {
    try {
      const { processTip } = await import('./dist/services/tip_processor.js');

      console.log('📝 Creating group tip via processTip (simulating Discord command flow)...');

      const tipData = {
        amount: 25,
        tipType: "group",
        note: "Test timer scheduling via Discord simulation",
        tokenId: 1, // PENGU
        duration: 1, // 1 minute for quick testing
        userId: "403807194308673537",
        guildId: "1074882281841360926",
        channelId: "1074882281841360929"
      };

      const result = await processTip(tipData, client);

      if (result.success) {
        console.log('✅ Group tip created successfully via Discord simulation');
        console.log('🔍 Now checking if timer scheduling logs appeared...');

        // Wait a bit for any async logging
        setTimeout(() => {
          console.log('🏁 Test completed - check the main bot logs for timer scheduling messages');
          process.exit(0);
        }, 2000);
      } else {
        console.log('❌ Failed to create group tip:', result.message);
        console.log('Details:', result.details);
        process.exit(1);
      }

    } catch (error) {
      console.error('💥 Error during tip creation:', error.message);
      process.exit(1);
    }
  })();
});

client.login(process.env.DISCORD_TOKEN);