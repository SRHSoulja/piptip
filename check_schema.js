import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSchema() {
  console.log('Checking database schema...\n');

  try {
    // Check if UserStreak table exists
    const streakCount = await prisma.userStreak.count();
    console.log(`✅ UserStreak table exists (${streakCount} records)`);
  } catch (error) {
    console.log('❌ UserStreak table missing or error:', error.message);
  }

  try {
    // Check if Achievement table exists
    const achievementCount = await prisma.achievement.count();
    console.log(`✅ Achievement table exists (${achievementCount} records)`);
  } catch (error) {
    console.log('❌ Achievement table missing or error:', error.message);
  }

  try {
    // Check if AchievementDefinition table exists
    const defCount = await prisma.achievementDefinition.count();
    console.log(`✅ AchievementDefinition table exists (${defCount} records)`);
  } catch (error) {
    console.log('❌ AchievementDefinition table missing or error:', error.message);
  }

  try {
    // Test the problematic query
    const user = await prisma.user.findFirst({
      include: {
        streak: true
      }
    });
    console.log(`✅ User.streak relation works`);
  } catch (error) {
    console.log('❌ User.streak relation error:', error.message);
  }

  console.log('\nDatabase URL:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@'));

  await prisma.$disconnect();
}

checkSchema().catch(console.error);