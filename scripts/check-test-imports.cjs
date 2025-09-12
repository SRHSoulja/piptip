#!/usr/bin/env node

// scripts/check-test-imports.cjs - Prevent test code from leaking into src/

const fs = require('fs');
const path = require('path');

const FORBIDDEN_PATTERNS = [
  /tests?[\/\\]/,
  /__mocks?__[\/\\]/,
  /mock/i,
  /devOnly/i,
  /\.test\./,
  /\.spec\./
];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  
  // Check imports/requires
  const importLines = content.split('\n').map((line, idx) => ({ line, number: idx + 1 }))
    .filter(({ line }) => /^import|^export.*from|require\(/.test(line.trim()));
  
  for (const { line, number } of importLines) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(line)) {
        issues.push({
          file: filePath,
          line: number,
          content: line.trim(),
          pattern: pattern.toString()
        });
      }
    }
  }
  
  return issues;
}

function getAllFiles(dir, ext = ['.ts', '.js', '.tsx', '.jsx']) {
  const files = [];
  
  function walkDir(currentPath) {
    const entries = fs.readdirSync(currentPath);
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        if (!['node_modules', 'dist', 'build', '.git'].includes(entry)) {
          walkDir(fullPath);
        }
      } else if (ext.some(e => entry.endsWith(e))) {
        files.push(fullPath);
      }
    }
  }
  
  walkDir(dir);
  return files;
}

function main() {
  console.log('🔍 Checking for test/mock imports in src/**...');
  
  const srcFiles = getAllFiles('src');
  
  let totalIssues = 0;
  
  for (const file of srcFiles) {
    const issues = checkFile(file);
    if (issues.length > 0) {
      console.log(`\n❌ ${file}:`);
      for (const issue of issues) {
        console.log(`   Line ${issue.line}: ${issue.content}`);
        console.log(`   Matches pattern: ${issue.pattern}`);
      }
      totalIssues += issues.length;
    }
  }
  
  if (totalIssues === 0) {
    console.log('✅ No test/mock imports found in src/**');
    process.exit(0);
  } else {
    console.log(`\n🚨 Found ${totalIssues} forbidden imports in src/** files`);
    console.log('Test code should not be imported in production source files.');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}