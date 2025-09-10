// seed-ads.mjs - ES Module version
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedAds() {
  console.log("🎯 Seeding test ads...");
  
  const testAds = [
    {
      text: "🚀 Trade crypto with zero fees on AbstractSwap!",
      url: "https://abstractswap.com", 
      weight: 10,
      active: true,
    },
    {
      text: "🎮 Join the largest Web3 gaming community!",
      url: "https://discord.gg/abstract",
      weight: 5,
      active: true,
    },
    {
      text: "💎 Stake your tokens and earn rewards!",
      url: "https://example-staking.com",
      weight: 8,
      active: true,
    },
    {
      text: "🏆 Test your skills in PvP battles!",
      weight: 3,
      active: true,
    }
  ];

  try {
    // Clear existing ads (optional)
    console.log("Clearing existing ads...");
    await prisma.ad.deleteMany({});
    
    // Insert new ads
    console.log("Creating new ads...");
    const created = await prisma.ad.createMany({
      data: testAds,
      skipDuplicates: true
    });
    
    console.log(`✅ Created ${created.count} ads!`);
    
    // Verify
    const allAds = await prisma.ad.findMany();
    console.log("Current ads in database:");
    allAds.forEach(ad => {
      console.log(`- [${ad.active ? '✅' : '❌'}] "${ad.text.substring(0, 40)}..." (weight: ${ad.weight})`);
    });
    
  } catch (error) {
    console.error("Error seeding ads:", error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

seedAds();