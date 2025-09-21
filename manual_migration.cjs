// Manual database migration to add totalXP column
const { Client } = require('pg');

async function runMigration() {
  console.log('🔧 Running manual database migration...\n');

  const client = new Client({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Check if totalXP column exists
    const checkResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'User' AND column_name = 'totalXP'
    `);

    if (checkResult.rows.length > 0) {
      console.log('✅ totalXP column already exists');
      return;
    }

    console.log('🔧 Adding totalXP column...');

    // Add the totalXP column with default value
    await client.query(`
      ALTER TABLE "User"
      ADD COLUMN "totalXP" INTEGER NOT NULL DEFAULT 0
    `);

    console.log('✅ Successfully added totalXP column');

    // Verify the column was added
    const verifyResult = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'User' AND column_name = 'totalXP'
    `);

    if (verifyResult.rows.length > 0) {
      const col = verifyResult.rows[0];
      console.log(`✅ Verified: ${col.column_name} (${col.data_type}) with default ${col.column_default}`);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await client.end();
    console.log('📤 Database connection closed');
  }
}

runMigration()
  .then(() => {
    console.log('\n🎉 Migration completed successfully!');
    console.log('💡 You can now restart the Railway service to use the new column.');
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error.message);
    process.exit(1);
  });