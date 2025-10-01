import * as fs from 'fs';
import * as path from 'path';

const files = [
  'tests/match_integration.test.ts',
  'tests/transaction_log_integration.test.ts',
  'tests/prediction_market_integration.test.ts',
  'tests/prediction_market_flow.test.ts',
  'tests/tournament_tpip_integration.test.ts',
  'tests/tournament_entry_multi_token.test.ts',
  'tests/multi_token_acceptance.test.ts',
  'scripts/stress_test_reconciliation.ts'
];

console.log('🔧 Fixing updatedAt field in test files...\n');

for (const filePath of files) {
  const fullPath = path.join(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    continue;
  }

  let content = fs.readFileSync(fullPath, 'utf-8');
  let modified = false;

  // Pattern 1: user.create with shorthand property (data: { discordId })
  const shorthandPattern = /(await prisma\.user\.create\(\{\s*data:\s*\{\s*discordId\s*\})/g;
  if (content.match(shorthandPattern)) {
    content = content.replace(shorthandPattern, 'await prisma.user.create({\n      data: { discordId, updatedAt: new Date() }');
    modified = true;
  }

  // Pattern 2: user.create with explicit discordId assignment
  const explicitPattern = /(await prisma\.user\.create\(\{\s*data:\s*\{\s*discordId:\s*[^,}]+)(}\s*}\))/g;
  if (content.match(explicitPattern)) {
    content = content.replace(explicitPattern, '$1, updatedAt: new Date() }$2');
    modified = true;
  }

  // Pattern 3: user.create with discordId and other fields
  const multiFieldPattern = /(await prisma\.user\.create\(\{\s*data:\s*\{[^}]*discordId[^}]*)(}\s*}\))/g;
  if (content.match(multiFieldPattern) && !content.match(/updatedAt/)) {
    content = content.replace(multiFieldPattern, (match) => {
      if (match.includes('updatedAt')) return match; // Skip if already has updatedAt
      return match.replace(/(}\s*}\))/, ', updatedAt: new Date() }$1');
    });
    modified = true;
  }

  // Pattern 3: user.upsert - add to create block
  const upsertCreatePattern = /(create: \{[^}]+predictionSelfExcluded: false)(,?\s*}\s*,)/g;
  if (content.match(upsertCreatePattern)) {
    content = content.replace(upsertCreatePattern, '$1,\n          updatedAt: new Date()$2');
    modified = true;
  }

  // Pattern 4: user.upsert - add to update block
  const upsertUpdatePattern = /(update: \{[^}]+predictionSelfExcluded: false)(}\s*}\))/g;
  if (content.match(upsertUpdatePattern)) {
    content = content.replace(upsertUpdatePattern, '$1,\n          updatedAt: new Date()$2');
    modified = true;
  }

  if (modified) {
    // Backup original
    fs.writeFileSync(fullPath + '.backup', fs.readFileSync(fullPath));
    // Write fixed version
    fs.writeFileSync(fullPath, content);
    console.log(`✅ Fixed: ${filePath}`);
  } else {
    console.log(`ℹ️  No changes: ${filePath}`);
  }
}

console.log('\n🎉 Fix complete! Backups created with .backup extension');
console.log('\nTo test:');
console.log('  ./RUN_ALL_TESTS.sh');
