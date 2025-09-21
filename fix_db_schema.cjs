// Quick database schema fix - add totalXP column via direct connection
const { execSync } = require('child_process');

async function fixDatabaseSchema() {
  console.log('🔧 Fixing database schema using DIRECT_URL...\n');

  try {
    console.log('1️⃣ Generating Prisma client...');
    execSync('npx prisma generate', { stdio: 'inherit' });

    console.log('\n2️⃣ Pushing schema to database using direct connection...');
    // Use DIRECT_URL for the migration
    const env = { ...process.env, DATABASE_URL: process.env.DIRECT_URL };
    execSync('npx prisma db push', {
      stdio: 'inherit',
      timeout: 30000, // 30 second timeout
      env: env
    });

    console.log('\n✅ Database schema fixed successfully!');
    console.log('🎉 Bot should now work without totalXP errors.');

  } catch (error) {
    console.error('\n❌ Schema fix failed:', error.message);
    process.exit(1);
  }
}

fixDatabaseSchema();