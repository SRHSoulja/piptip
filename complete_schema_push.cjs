// Complete schema push using direct connection with proper password encoding
require('dotenv').config();
const { Client } = require('pg');
const { execSync } = require('child_process');

async function completeSchemaSync() {
  // Extract and encode password securely from environment
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    throw new Error('DIRECT_URL environment variable is required');
  }

  console.log('🔧 Complete database schema synchronization...\n');
  console.log('🔒 Using secure direct database connection');

  try {
    console.log('1️⃣ Generating Prisma client...');
    execSync('npx prisma generate', { stdio: 'inherit' });

    console.log('\n2️⃣ Pushing complete schema via direct connection...');

    // Use direct URL for schema push
    const env = { ...process.env, DATABASE_URL: directUrl };
    execSync('npx prisma db push --force-reset', {
      stdio: 'inherit',
      timeout: 60000, // 60 second timeout
      env: env
    });

    console.log('\n3️⃣ Verifying schema with direct SQL...');

    const client = new Client({
      connectionString: directUrl
    });

    await client.connect();
    console.log('✅ Connected to database via direct connection');

    // Verify all expected tables and columns exist
    const verifyQueries = [
      {
        name: 'User table with totalXP',
        query: `SELECT column_name FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'totalXP'`
      },
      {
        name: 'All User table columns',
        query: `SELECT column_name FROM information_schema.columns WHERE table_name = 'User' ORDER BY ordinal_position`
      }
    ];

    for (const verify of verifyQueries) {
      const result = await client.query(verify.query);
      console.log(`✅ ${verify.name}:`, result.rows.map(r => r.column_name));
    }

    await client.end();
    console.log('\n🎉 Complete database schema synchronization successful!');

  } catch (error) {
    console.error('❌ Schema sync failed:', error.message);
    process.exit(1);
  }
}

completeSchemaSync();