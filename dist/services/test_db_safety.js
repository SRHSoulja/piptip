import { PrismaClient } from "@prisma/client";
function getTestDatabaseConfig() {
  const isTestEnvironment = process.env.NODE_ENV === "test" || process.env.NETWORK === "testnet" || process.argv.some((arg) => arg.includes("test"));
  if (!isTestEnvironment) {
    return {
      url: process.env.DATABASE_URL,
      isTestDatabase: false,
      isSafe: true
    };
  }
  if (process.env.TEST_DATABASE_URL) {
    console.log("\u2705 Using TEST_DATABASE_URL for test isolation");
    return {
      url: process.env.TEST_DATABASE_URL,
      isTestDatabase: true,
      isSafe: true
    };
  }
  const dbUrl = process.env.DATABASE_URL || "";
  const isTestDb = dbUrl.includes("test") || dbUrl.includes("_test") || dbUrl.includes("-test");
  if (isTestDb) {
    console.warn("\u26A0\uFE0F Using DATABASE_URL which appears to be a test database");
    return {
      url: dbUrl,
      isTestDatabase: true,
      isSafe: true
    };
  }
  try {
    const url = new URL(dbUrl);
    const port = url.port || "5432";
    const host = url.hostname;
    const database = url.pathname.substring(1).split("?")[0];
    if (port === "5433" && host === "localhost") {
      console.warn("\u26A0\uFE0F Using DATABASE_URL on test port 5433 (isolation via port)");
      return {
        url: dbUrl,
        isTestDatabase: true,
        isSafe: true
      };
    }
    if (process.env.NETWORK === "testnet" && (database.includes("test") || host === "localhost")) {
      console.warn("\u26A0\uFE0F NETWORK=testnet: Using DATABASE_URL for testnet integration tests");
      console.warn("   Database: " + database);
      console.warn("   \u26A0\uFE0F  WARNING: Set TEST_DATABASE_URL for complete isolation!");
      return {
        url: dbUrl,
        isTestDatabase: false,
        isSafe: true
      };
    }
  } catch (e) {
  }
  console.error("");
  console.error("\u{1F6A8} SAFETY VIOLATION: Tests cannot run against production database!");
  console.error("");
  console.error("Current configuration:");
  console.error(`  NODE_ENV: ${process.env.NODE_ENV}`);
  console.error(`  NETWORK: ${process.env.NETWORK}`);
  console.error(`  DATABASE_URL: ${dbUrl ? "[SET]" : "[NOT SET]"}`);
  console.error(`  TEST_DATABASE_URL: ${process.env.TEST_DATABASE_URL ? "[SET]" : "[NOT SET]"}`);
  console.error("");
  console.error("To fix this:");
  console.error("1. Start test database:");
  console.error("   docker-compose -f docker-compose.test.yml up -d");
  console.error("");
  console.error("2. Set TEST_DATABASE_URL in .env.test:");
  console.error('   TEST_DATABASE_URL="postgresql://piptip_test:test_password@localhost:5433/piptip_test"');
  console.error("");
  console.error("3. Run migrations on test DB:");
  console.error("   npm run test:migrate");
  console.error("");
  console.error("4. Load test environment:");
  console.error("   export $(cat .env.test | xargs)");
  console.error("");
  process.exit(1);
}
function createTestPrismaClient() {
  const config = getTestDatabaseConfig();
  return new PrismaClient({
    datasources: {
      db: {
        url: config.url
      }
    },
    log: process.env.DEBUG_PRISMA ? ["query", "error", "warn"] : ["error"]
  });
}
function validateTestEnvironment() {
  const config = getTestDatabaseConfig();
  if (!config.isSafe) {
    throw new Error("Test environment validation failed - cannot proceed");
  }
  console.log("\u{1F512} Test database safety validated");
  console.log(`   Database: ${config.isTestDatabase ? "TEST" : "PRODUCTION"}`);
  console.log("");
}
export {
  createTestPrismaClient,
  getTestDatabaseConfig,
  validateTestEnvironment
};
//# sourceMappingURL=test_db_safety.js.map
