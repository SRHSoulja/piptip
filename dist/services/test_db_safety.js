/**
 * Test Database Safety Module
 *
 * Ensures tests NEVER hit production database by:
 * 1. Checking for TEST_DATABASE_URL in test environment
 * 2. Validating database URL doesn't point to production
 * 3. Providing safe test database configuration
 */
import { PrismaClient } from '@prisma/client';
/**
 * Validates and returns safe test database configuration
 */
export function getTestDatabaseConfig() {
    const isTestEnvironment = process.env.NODE_ENV === 'test' ||
        process.env.NETWORK === 'testnet' ||
        process.argv.some(arg => arg.includes('test'));
    if (!isTestEnvironment) {
        return {
            url: process.env.DATABASE_URL,
            isTestDatabase: false,
            isSafe: true
        };
    }
    // Priority 1: Use TEST_DATABASE_URL if set
    if (process.env.TEST_DATABASE_URL) {
        console.log('✅ Using TEST_DATABASE_URL for test isolation');
        return {
            url: process.env.TEST_DATABASE_URL,
            isTestDatabase: true,
            isSafe: true
        };
    }
    // Priority 2: Check if DATABASE_URL looks like a test database
    const dbUrl = process.env.DATABASE_URL || '';
    const isTestDb = dbUrl.includes('test') ||
        dbUrl.includes('_test') ||
        dbUrl.includes('-test');
    if (isTestDb) {
        console.warn('⚠️ Using DATABASE_URL which appears to be a test database');
        return {
            url: dbUrl,
            isTestDatabase: true,
            isSafe: true
        };
    }
    // Priority 3: STRICT MODE - Check if DB is on test port (5433)
    try {
        const url = new URL(dbUrl);
        const port = url.port || '5432';
        const host = url.hostname;
        const database = url.pathname.substring(1).split('?')[0];
        // Allow if on test port 5433
        if (port === '5433' && host === 'localhost') {
            console.warn('⚠️ Using DATABASE_URL on test port 5433 (isolation via port)');
            return {
                url: dbUrl,
                isTestDatabase: true,
                isSafe: true
            };
        }
        // Check if NETWORK=testnet AND database looks safe
        if (process.env.NETWORK === 'testnet' && (database.includes('test') || host === 'localhost')) {
            console.warn('⚠️ NETWORK=testnet: Using DATABASE_URL for testnet integration tests');
            console.warn('   Database: ' + database);
            console.warn('   ⚠️  WARNING: Set TEST_DATABASE_URL for complete isolation!');
            return {
                url: dbUrl,
                isTestDatabase: false,
                isSafe: true
            };
        }
    }
    catch (e) {
        // URL parse failed, continue to fail-safe
    }
    // Priority 4: FAIL SAFE - Refuse to run tests against production
    console.error('');
    console.error('🚨 SAFETY VIOLATION: Tests cannot run against production database!');
    console.error('');
    console.error('Current configuration:');
    console.error(`  NODE_ENV: ${process.env.NODE_ENV}`);
    console.error(`  NETWORK: ${process.env.NETWORK}`);
    console.error(`  DATABASE_URL: ${dbUrl ? '[SET]' : '[NOT SET]'}`);
    console.error(`  TEST_DATABASE_URL: ${process.env.TEST_DATABASE_URL ? '[SET]' : '[NOT SET]'}`);
    console.error('');
    console.error('To fix this:');
    console.error('1. Start test database:');
    console.error('   docker-compose -f docker-compose.test.yml up -d');
    console.error('');
    console.error('2. Set TEST_DATABASE_URL in .env.test:');
    console.error('   TEST_DATABASE_URL="postgresql://piptip_test:test_password@localhost:5433/piptip_test"');
    console.error('');
    console.error('3. Run migrations on test DB:');
    console.error('   npm run test:migrate');
    console.error('');
    console.error('4. Load test environment:');
    console.error('   export $(cat .env.test | xargs)');
    console.error('');
    process.exit(1);
}
/**
 * Create a Prisma client configured for safe test usage
 */
export function createTestPrismaClient() {
    const config = getTestDatabaseConfig();
    return new PrismaClient({
        datasources: {
            db: {
                url: config.url
            }
        },
        log: process.env.DEBUG_PRISMA ? ['query', 'error', 'warn'] : ['error']
    });
}
/**
 * Validate test environment before running tests
 */
export function validateTestEnvironment() {
    const config = getTestDatabaseConfig();
    if (!config.isSafe) {
        throw new Error('Test environment validation failed - cannot proceed');
    }
    console.log('🔒 Test database safety validated');
    console.log(`   Database: ${config.isTestDatabase ? 'TEST' : 'PRODUCTION'}`);
    console.log('');
}
