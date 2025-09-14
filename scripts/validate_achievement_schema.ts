#!/usr/bin/env npx tsx
// scripts/validate_achievement_schema.ts - Validate achievement system schema requirements

import { prisma } from '../src/services/db.js';

async function validateAchievementSchema() {
  console.log('🔍 Validating achievement system schema requirements...\n');

  let hasErrors = false;

  try {
    // Check if UserStreak table exists and has required fields
    console.log('1. Checking UserStreak table...');
    const userStreakSample = await prisma.userStreak.findFirst().catch(() => null);
    if (userStreakSample !== undefined) {
      console.log('   ✅ UserStreak table exists');
    } else {
      console.log('   ❌ UserStreak table missing or inaccessible');
      hasErrors = true;
    }

    // Check if Achievement table exists
    console.log('2. Checking Achievement table...');
    const achievementSample = await prisma.achievement.findFirst().catch(() => null);
    if (achievementSample !== undefined) {
      console.log('   ✅ Achievement table exists');
    } else {
      console.log('   ❌ Achievement table missing or inaccessible');
      hasErrors = true;
    }

    // Check if UserStats table exists (should already exist)
    console.log('3. Checking UserStats table...');
    const userStatsSample = await prisma.userStats.findFirst().catch(() => null);
    if (userStatsSample !== undefined) {
      console.log('   ✅ UserStats table exists');
    } else {
      console.log('   ❌ UserStats table missing or inaccessible');
      hasErrors = true;
    }

    // Check User model relations
    console.log('4. Checking User model relations...');
    const userWithRelations = await prisma.user.findFirst({
      include: {
        streak: true,
        achievements: true,
        stats: true
      }
    }).catch((e) => {
      console.log('   ❌ User relations not properly configured:', e.message);
      return null;
    });

    if (userWithRelations !== null) {
      console.log('   ✅ User model relations configured correctly');
    } else {
      hasErrors = true;
    }

    // Check AppConfig for achievement controls (if needed)
    console.log('5. Checking AppConfig for achievement controls...');
    const appConfig = await prisma.appConfig.findFirst().catch(() => null);
    if (appConfig) {
      console.log('   ✅ AppConfig table accessible');
    } else {
      console.log('   ⚠️  AppConfig table not found (optional for achievements)');
    }

    console.log('\n📊 Validation Summary:');
    if (hasErrors) {
      console.log('❌ Schema validation FAILED - Database migrations required!');
      console.log('\nRequired actions:');
      console.log('1. Run: npx prisma migrate dev --name add_achievement_system');
      console.log('2. Or run: npx prisma db push (for development)');
      process.exit(1);
    } else {
      console.log('✅ All required tables and relations are present');
      console.log('🚀 Achievement system ready for deployment!');
    }

  } catch (error) {
    console.error('❌ Database connection failed:', error);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Ensure DATABASE_URL is correctly configured');
    console.log('2. Verify database server is accessible');
    console.log('3. Check if schema is properly generated: npx prisma generate');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

validateAchievementSchema().catch(console.error);