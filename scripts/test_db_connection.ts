// Test database connection from Railway
import { PrismaClient } from '@prisma/client';

async function testConnection() {
  console.log('=== Database Connection Test ===\n');

  // Check environment
  console.log('Environment variables:');
  console.log(`- DATABASE_URL exists: ${!!process.env.DATABASE_URL}`);
  if (process.env.DATABASE_URL) {
    const masked = process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@');
    console.log(`- DATABASE_URL format: ${masked}`);
  }
  console.log(`- NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  console.log('');

  // Try to connect
  console.log('Attempting Prisma connection...');
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  try {
    await prisma.$connect();
    console.log('✅ Connection successful!');

    // Try a simple query
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Query successful:', result);

    await prisma.$disconnect();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Connection failed:');
    console.error(`- Error code: ${error.code}`);
    console.error(`- Error message: ${error.message}`);
    console.error(`- Client version: ${error.clientVersion || 'unknown'}`);

    await prisma.$disconnect();
    process.exit(1);
  }
}

testConnection();
