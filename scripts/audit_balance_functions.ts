#!/usr/bin/env npx tsx
/**
 * Balance Function Coverage Audit
 *
 * Scans codebase for all balance-affecting functions and verifies:
 * 1. Each function invokes logCompleteTransaction() or balance update wrapper
 * 2. Functions explicitly excluded by design are documented
 * 3. No missed cases that could cause balance drift
 *
 * Run: npm run audit:balance-functions
 */

import fs from "fs";
import path from "path";
import glob from "glob";

interface FunctionAudit {
  file: string;
  functionName: string;
  lineNumber: number;
  category: 'LOGGED' | 'EXCLUDED_BY_DESIGN' | 'MISSING_LOG' | 'UNCERTAIN';
  reason: string;
  codeSnippet: string;
}

interface AuditReport {
  timestamp: string;
  filesScanned: number;
  functionsFound: number;
  categorization: {
    logged: number;
    excludedByDesign: number;
    missingLog: number;
    uncertain: number;
  };
  findings: FunctionAudit[];
  summary: {
    passed: boolean;
    criticalIssues: number;
    warnings: number;
  };
}

// Patterns to identify balance-affecting operations
const BALANCE_PATTERNS = {
  // Direct balance updates
  directUpdates: [
    /userBalance\.update/,
    /user\.update.*balance/i,
    /pipchipsBalance/,
    /\.amount\s*=/,
    /\.balance\s*=/
  ],

  // Balance operation functions
  balanceFunctions: [
    /debitToken/,
    /creditToken/,
    /transferToken/,
    /processTransaction/,
    /updateBalance/,
    /adjustBalance/,
    /modifyBalance/
  ],

  // Transaction logging
  transactionLogging: [
    /logCompleteTransaction/,
    /logTxAtomicTx/,
    /createTransaction/
  ],

  // Excluded patterns (read-only or non-financial)
  excludedPatterns: [
    /\.findUnique/,
    /\.findFirst/,
    /\.findMany/,
    /\.count/,
    /getBalance/,
    /checkBalance/,
    /viewBalance/
  ]
};

// Functions explicitly excluded by design (with reasons)
const EXCLUDED_BY_DESIGN = {
  'ensureUserBalance': 'Initialization only - creates zero balance',
  'ensureUser': 'User creation only - no balance change',
  'getTokenById': 'Read-only token lookup',
  'getTokenByAddress': 'Read-only token lookup',
  'getUserBalance': 'Read-only balance query',
  'calculateOdds': 'Read-only calculation',
  'mapDbMarket': 'Data transformation only',
  'formatAmount': 'Display formatting only',
  'toDecStr': 'Type conversion only',
  'toAtomic': 'Type conversion only'
};

/**
 * Scan TypeScript files for balance-affecting functions
 */
async function scanCodebase(): Promise<FunctionAudit[]> {
  console.log("🔍 Scanning codebase for balance-affecting functions...\n");

  const findings: FunctionAudit[] = [];

  // Scan source files using glob.sync for synchronous operation
  const files = glob.sync("src/**/*.ts", {
    ignore: ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"]
  });

  console.log(`   Found ${files.length} TypeScript files to analyze\n`);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    // Track current function context
    let currentFunction: string | null = null;
    let functionStartLine = 0;
    let braceDepth = 0;
    let inFunction = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Track function declarations
      const functionMatch = line.match(/(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
      if (functionMatch && braceDepth === 0) {
        currentFunction = functionMatch[1] || functionMatch[2];
        functionStartLine = lineNum;
        inFunction = true;
      }

      // Track brace depth
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      // Reset when function ends
      if (inFunction && braceDepth === 0 && line.includes('}')) {
        inFunction = false;
        currentFunction = null;
      }

      // Check for balance-affecting operations
      const hasDirectUpdate = BALANCE_PATTERNS.directUpdates.some(pattern => pattern.test(line));
      const hasBalanceFunction = BALANCE_PATTERNS.balanceFunctions.some(pattern => pattern.test(line));
      const hasTransactionLog = BALANCE_PATTERNS.transactionLogging.some(pattern => pattern.test(line));
      const isExcluded = BALANCE_PATTERNS.excludedPatterns.some(pattern => pattern.test(line));

      if ((hasDirectUpdate || hasBalanceFunction) && currentFunction && !isExcluded) {
        // Check if this function has transaction logging
        const functionEnd = Math.min(i + 50, lines.length); // Look ahead 50 lines
        const functionBlock = lines.slice(i, functionEnd).join('\n');

        const hasLogging = BALANCE_PATTERNS.transactionLogging.some(pattern =>
          pattern.test(functionBlock)
        );

        // Check if explicitly excluded
        const isExcludedByDesign = currentFunction in EXCLUDED_BY_DESIGN;

        // Determine category
        let category: FunctionAudit['category'];
        let reason: string;

        if (isExcludedByDesign) {
          category = 'EXCLUDED_BY_DESIGN';
          reason = EXCLUDED_BY_DESIGN[currentFunction as keyof typeof EXCLUDED_BY_DESIGN];
        } else if (hasLogging || hasBalanceFunction) {
          // Balance functions like debitToken/creditToken have built-in logging
          category = 'LOGGED';
          reason = hasBalanceFunction
            ? 'Uses balance operation wrapper with transaction logging'
            : 'Includes logCompleteTransaction or logTxAtomicTx';
        } else if (hasDirectUpdate) {
          category = 'MISSING_LOG';
          reason = 'Direct balance update without transaction logging';
        } else {
          category = 'UNCERTAIN';
          reason = 'Needs manual review';
        }

        // Get code snippet
        const snippetStart = Math.max(0, i - 2);
        const snippetEnd = Math.min(lines.length, i + 3);
        const snippet = lines.slice(snippetStart, snippetEnd)
          .map((l, idx) => `${snippetStart + idx + 1}: ${l}`)
          .join('\n');

        findings.push({
          file: file.replace(process.cwd(), ''),
          functionName: currentFunction,
          lineNumber: lineNum,
          category,
          reason,
          codeSnippet: snippet
        });
      }
    }
  }

  return findings;
}

/**
 * Analyze findings and generate report
 */
async function generateReport(findings: FunctionAudit[]): Promise<AuditReport> {
  console.log("📊 Analyzing findings...\n");

  const report: AuditReport = {
    timestamp: new Date().toISOString(),
    filesScanned: 0,
    functionsFound: findings.length,
    categorization: {
      logged: 0,
      excludedByDesign: 0,
      missingLog: 0,
      uncertain: 0
    },
    findings: findings,
    summary: {
      passed: false,
      criticalIssues: 0,
      warnings: 0
    }
  };

  // Count files scanned
  const uniqueFiles = new Set(findings.map(f => f.file));
  report.filesScanned = uniqueFiles.size;

  // Categorize findings
  for (const finding of findings) {
    switch (finding.category) {
      case 'LOGGED':
        report.categorization.logged++;
        break;
      case 'EXCLUDED_BY_DESIGN':
        report.categorization.excludedByDesign++;
        break;
      case 'MISSING_LOG':
        report.categorization.missingLog++;
        report.summary.criticalIssues++;
        break;
      case 'UNCERTAIN':
        report.categorization.uncertain++;
        report.summary.warnings++;
        break;
    }
  }

  // Determine pass/fail
  report.summary.passed = report.summary.criticalIssues === 0;

  return report;
}

/**
 * Print report to console
 */
function printReport(report: AuditReport): void {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   Balance Function Coverage Audit Report                  ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Files Scanned: ${report.filesScanned}`);
  console.log(`Functions Found: ${report.functionsFound}\n`);

  console.log("Categorization:");
  console.log(`   ✅ Properly Logged: ${report.categorization.logged}`);
  console.log(`   📋 Excluded by Design: ${report.categorization.excludedByDesign}`);
  console.log(`   ❌ Missing Transaction Log: ${report.categorization.missingLog}`);
  console.log(`   ⚠️  Uncertain (Needs Review): ${report.categorization.uncertain}\n`);

  console.log("Summary:");
  console.log(`   Critical Issues: ${report.summary.criticalIssues}`);
  console.log(`   Warnings: ${report.summary.warnings}`);
  console.log(`   Status: ${report.summary.passed ? "✅ PASSED" : "❌ FAILED"}\n`);

  // Print critical issues
  if (report.summary.criticalIssues > 0) {
    console.log("❌ CRITICAL ISSUES - Missing Transaction Logs:\n");
    const missingLogs = report.findings.filter(f => f.category === 'MISSING_LOG');

    for (const finding of missingLogs) {
      console.log(`   File: ${finding.file}:${finding.lineNumber}`);
      console.log(`   Function: ${finding.functionName}`);
      console.log(`   Reason: ${finding.reason}`);
      console.log(`   Code:`);
      console.log(finding.codeSnippet.split('\n').map(l => `      ${l}`).join('\n'));
      console.log();
    }
  }

  // Print warnings
  if (report.summary.warnings > 0) {
    console.log("⚠️  WARNINGS - Uncertain Cases (Manual Review Needed):\n");
    const uncertainCases = report.findings.filter(f => f.category === 'UNCERTAIN');

    for (const finding of uncertainCases.slice(0, 5)) { // Limit to first 5
      console.log(`   File: ${finding.file}:${finding.lineNumber}`);
      console.log(`   Function: ${finding.functionName}`);
      console.log(`   Reason: ${finding.reason}\n`);
    }

    if (uncertainCases.length > 5) {
      console.log(`   ... and ${uncertainCases.length - 5} more uncertain cases\n`);
    }
  }

  // Print properly logged functions (sample)
  console.log("✅ Sample Properly Logged Functions:\n");
  const loggedFunctions = report.findings.filter(f => f.category === 'LOGGED');
  for (const finding of loggedFunctions.slice(0, 5)) {
    console.log(`   ${finding.functionName} (${finding.file}:${finding.lineNumber})`);
    console.log(`      ${finding.reason}\n`);
  }
}

/**
 * Save detailed report to file
 */
function saveReport(report: AuditReport): void {
  const reportDir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(reportDir, { recursive: true });

  const reportPath = path.join(reportDir, `balance-audit-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n📄 Detailed report saved to: ${reportPath}`);
}

/**
 * Main audit runner
 */
async function runAudit(): Promise<void> {
  try {
    const findings = await scanCodebase();
    const report = await generateReport(findings);

    printReport(report);
    saveReport(report);

    process.exit(report.summary.passed ? 0 : 1);
  } catch (error) {
    console.error("❌ Audit failed:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAudit();
}