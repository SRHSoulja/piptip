// Comprehensive database schema fix with proper password encoding
const { Client } = require('pg');

async function ensureSchemaSync() {
  // URL encode the password properly for any special characters
  const password = process.env.DIRECT_URL?.match(/:([^@]+)@/)?.[1] || 'BBITillIDie2121!';
  const encodedPassword = encodeURIComponent(password);

  // Use DIRECT_URL if available, otherwise construct it
  const directUrl = process.env.DIRECT_URL ||
    `postgresql://postgres.irzrpzcgxxzualbviyqc:${encodedPassword}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`;

  console.log('🔧 Ensuring database schema synchronization...\n');

  const client = new Client({
    connectionString: directUrl
  });

  try {
    await client.connect();
    console.log('✅ Connected to database via direct connection');

    // Comprehensive schema fixes - add any missing columns
    const schemaFixes = [
      {
        name: 'totalXP column',
        query: `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totalXP" INTEGER NOT NULL DEFAULT 0`
      },
      // Add future schema fixes here as needed
      // {
      //   name: 'example new column',
      //   query: `ALTER TABLE "SomeTable" ADD COLUMN IF NOT EXISTS "newColumn" TEXT`
      // }
    ];

    for (const fix of schemaFixes) {
      try {
        await client.query(fix.query);
        console.log(`✅ ${fix.name} - schema updated`);
      } catch (fixError) {
        console.log(`⚠️  ${fix.name} - ${fixError.message}`);
      }
    }

    console.log('\n🎉 Database schema synchronization complete');

  } catch (error) {
    console.error('❌ Schema sync failed:', error.message);
    // Don't exit with error - allow app to continue
    console.log('⚠️  Continuing app startup despite schema sync issues...');
  } finally {
    await client.end();
  }
}

ensureSchemaSync();