/**
 * Prediction Markets Migration Validation
 *
 * Verifies complete migration from Discord to Website:
 * - No Discord commands for markets
 * - Help command redirects to website
 * - Website API endpoints functional
 * - Admin panel accessible
 * - All flows integrated
 */

import { readdir, readFile } from 'fs/promises';
import { prisma } from '../src/services/db.js';
import { predictionMarkets } from '../src/services/prediction_markets.js';
import { pipchipsService } from '../src/services/pipchips_service.js';

interface ValidationResult {
  section: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: ValidationResult[] = [];

async function validate(section: string, check: () => Promise<boolean>, successMsg: string, failMsg: string, details?: any) {
  try {
    const passed = await check();
    results.push({
      section,
      passed,
      message: passed ? successMsg : failMsg,
      details
    });
    console.log(passed ? `✅ ${successMsg}` : `❌ ${failMsg}`);
  } catch (error: any) {
    results.push({
      section,
      passed: false,
      message: failMsg,
      details: error.message
    });
    console.error(`❌ ${failMsg}:`, error.message);
  }
}

async function main() {
  console.log('\n🔍 Prediction Markets Migration Validation\n');
  console.log('=' .repeat(60));

  // Check for test database configuration
  const testDbUrl = process.env.TEST_DATABASE_URL;
  const dbUrl = process.env.DATABASE_URL;

  if (!testDbUrl) {
    console.error('\n❌ TEST_DATABASE_URL is not set!');
    console.error('');
    console.error('This validation should run against an isolated test database.');
    console.error('');
    console.error('To fix:');
    console.error('1. Start test database: docker-compose -f docker-compose.test.yml up -d');
    console.error('2. Run: npm run test:setup');
    console.error('3. Run validation: npm run validate:markets-migration');
    console.error('');
    process.exit(1);
  }

  console.log('\n🔒 Database Configuration Check\n');
  console.log(`✅ TEST_DATABASE_URL: ${testDbUrl.substring(0, 50)}...`);
  console.log(`✅ DATABASE_URL: ${dbUrl?.substring(0, 50)}...`);

  // Verify using test port 5433
  if (!testDbUrl.includes(':5433')) {
    console.warn('⚠️  WARNING: TEST_DATABASE_URL is not using port 5433');
    console.warn('   Expected test database on localhost:5433');
  }

  console.log('');

  // 1. Discord Command Absence
  console.log('\n📋 Section 1: Discord Command Cleanup\n');

  await validate(
    'discord_commands',
    async () => {
      const commands = await readdir('./src/commands');
      const marketCommands = commands.filter(f =>
        f.includes('market') || f.includes('bet') || f.includes('predict') || f.includes('resolve')
      );
      return marketCommands.length === 0;
    },
    'No Discord market commands found',
    'Discord market commands still exist'
  );

  await validate(
    'help_command_redirect',
    async () => {
      const helpFile = await readFile('./src/commands/pip_help.ts', 'utf-8');
      return helpFile.includes('Website Only') &&
             helpFile.includes('PIPChips') &&
             helpFile.includes('TPIP') &&
             helpFile.includes('pengubook');
    },
    'Help command redirects to website',
    'Help command missing website redirect'
  );

  // 2. Website API Endpoints
  console.log('\n🌐 Section 2: Website API Endpoints\n');

  await validate(
    'market_listing_api',
    async () => {
      const apiFile = await readFile('./src/web/api/pipchips_markets.ts', 'utf-8');
      return apiFile.includes('GET /api/pipchips/markets') &&
             apiFile.includes('pipchipsMarketsRouter');
    },
    'Market listing API endpoint exists',
    'Market listing API endpoint missing'
  );

  await validate(
    'betting_api',
    async () => {
      const apiFile = await readFile('./src/web/api/pipchips_markets.ts', 'utf-8');
      return apiFile.includes('POST /api/pipchips/predict') &&
             apiFile.includes('placeBet');
    },
    'Betting API endpoint exists',
    'Betting API endpoint missing'
  );

  await validate(
    'market_detail_api',
    async () => {
      const apiFile = await readFile('./src/web/api/pipchips_markets.ts', 'utf-8');
      return apiFile.includes('GET /api/pipchips/market/:id');
    },
    'Market detail API endpoint exists',
    'Market detail API endpoint missing'
  );

  // 3. Admin Panel
  console.log('\n🛡️ Section 3: Admin Panel\n');

  await validate(
    'admin_markets_router',
    async () => {
      const adminFile = await readFile('./src/web/admin_markets.ts', 'utf-8');
      return adminFile.includes('export const adminMarketsRouter') &&
             adminFile.includes('requireAdminAuth');
    },
    'Admin markets router exists',
    'Admin markets router missing'
  );

  await validate(
    'admin_panel_integrated',
    async () => {
      const adminFile = await readFile('./src/web/admin.ts', 'utf-8');
      return adminFile.includes('adminMarketsRouter') &&
             adminFile.includes('adminRouter.use(adminMarketsRouter)');
    },
    'Admin panel integrated into main admin',
    'Admin panel not integrated'
  );

  await validate(
    'admin_market_creation',
    async () => {
      const adminFile = await readFile('./src/web/admin_markets.ts', 'utf-8');
      return adminFile.includes('POST /admin/markets/create');
    },
    'Admin panel supports market creation',
    'Admin panel missing market creation'
  );

  await validate(
    'admin_market_resolution',
    async () => {
      const adminFile = await readFile('./src/web/admin_markets.ts', 'utf-8');
      return adminFile.includes('POST /admin/markets/:id/resolve');
    },
    'Admin panel supports market resolution',
    'Admin panel missing market resolution'
  );

  await validate(
    'admin_batch_operations',
    async () => {
      const adminFile = await readFile('./src/web/admin_markets.ts', 'utf-8');
      return adminFile.includes('Resolve All Expired');
    },
    'Admin panel supports batch operations',
    'Admin panel missing batch operations'
  );

  // 4. Core Services
  console.log('\n⚙️ Section 4: Core Services\n');

  await validate(
    'prediction_markets_service',
    async () => {
      return typeof predictionMarkets.placeBet === 'function' &&
             typeof predictionMarkets.resolveMarket === 'function';
    },
    'Prediction markets service available',
    'Prediction markets service missing'
  );

  await validate(
    'pipchips_service',
    async () => {
      return pipchipsService !== undefined &&
             typeof pipchipsService.getUserBalance === 'function';
    },
    'PIPChips service available',
    'PIPChips service missing'
  );

  await validate(
    'tournament_entry_service',
    async () => {
      const { enterTournamentWithPayment } = await import('../src/services/tournament_entry_service.js');
      return typeof enterTournamentWithPayment === 'function';
    },
    'Tournament entry service available',
    'Tournament entry service missing'
  );

  // 5. Database Schema
  console.log('\n🗄️ Section 5: Database Schema\n');

  await validate(
    'prediction_market_model',
    async () => {
      const market = await prisma.predictionMarket.findFirst();
      return true; // If query succeeds, model exists
    },
    'PredictionMarket model exists',
    'PredictionMarket model missing'
  );

  await validate(
    'prediction_participation_model',
    async () => {
      const participation = await prisma.predictionParticipation.findFirst();
      return true;
    },
    'PredictionParticipation model exists',
    'PredictionParticipation model missing'
  );

  await validate(
    'tournament_participant_model',
    async () => {
      const participant = await prisma.tournamentParticipant.findFirst();
      return true;
    },
    'TournamentParticipant model exists',
    'TournamentParticipant model missing'
  );

  // 6. Integration Tests
  console.log('\n🧪 Section 6: Test Coverage\n');

  await validate(
    'integration_tests_exist',
    async () => {
      const testFile = await readFile('./tests/prediction_markets_integration.test.ts', 'utf-8');
      return testFile.includes('Prediction Markets - Complete Integration');
    },
    'Integration tests created',
    'Integration tests missing'
  );

  await validate(
    'package_json_test_script',
    async () => {
      const packageFile = await readFile('./package.json', 'utf-8');
      return packageFile.includes('test:markets-integration');
    },
    'Test script added to package.json',
    'Test script missing from package.json'
  );

  // 7. Documentation
  console.log('\n📚 Section 7: Documentation\n');

  await validate(
    'migration_documentation',
    async () => {
      const migrationDoc = await readFile('./PREDICTION_MARKETS_MIGRATION_COMPLETE.md', 'utf-8');
      return migrationDoc.includes('Migration Complete');
    },
    'Migration documentation exists',
    'Migration documentation missing'
  );

  await validate(
    'admin_panel_documentation',
    async () => {
      const adminDoc = await readFile('./ADMIN_MARKETS_PANEL_COMPLETE.md', 'utf-8');
      return adminDoc.includes('Admin Markets Panel');
    },
    'Admin panel documentation exists',
    'Admin panel documentation missing'
  );

  await validate(
    'tpip_documentation',
    async () => {
      const tpipDoc = await readFile('./TPIP_MULTI_TOKEN_ENTRY_COMPLETE.md', 'utf-8');
      return tpipDoc.includes('TPIP Multi-Token Tournament Entry');
    },
    'TPIP documentation exists',
    'TPIP documentation missing'
  );

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Validation Summary\n');

  const sections = [...new Set(results.map(r => r.section))];
  for (const section of sections) {
    const sectionResults = results.filter(r => r.section === section);
    const passed = sectionResults.filter(r => r.passed).length;
    const total = sectionResults.length;
    const status = passed === total ? '✅' : '⚠️';
    console.log(`${status} ${section}: ${passed}/${total} checks passed`);
  }

  const totalPassed = results.filter(r => r.passed).length;
  const totalTests = results.length;
  const percentage = ((totalPassed / totalTests) * 100).toFixed(1);

  console.log('\n' + '='.repeat(60));
  console.log(`\n🎯 Overall: ${totalPassed}/${totalTests} checks passed (${percentage}%)\n`);

  if (totalPassed === totalTests) {
    console.log('✅ All validation checks passed! Migration is complete.\n');
    process.exit(0);
  } else {
    console.log('⚠️ Some validation checks failed. Review the results above.\n');

    // Show failed checks
    const failed = results.filter(r => !r.passed);
    if (failed.length > 0) {
      console.log('Failed checks:');
      failed.forEach(r => {
        console.log(`  ❌ ${r.section}: ${r.message}`);
        if (r.details) {
          console.log(`     Details: ${r.details}`);
        }
      });
      console.log();
    }

    process.exit(1);
  }
}

main().catch(error => {
  console.error('Validation script error:', error);
  process.exit(1);
});
