#!/usr/bin/env npx tsx
// Secure backup cleanup script - removes sensitive data from existing backups

import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

const BACKUP_DIR = join(process.cwd(), 'backups');

// Hash function for consistent anonymization
function hashDiscordId(discordId: string): string {
  const salt = process.env.BACKUP_ANONYMIZATION_SALT || 'default-salt-change-in-production';
  return crypto.createHash('sha256').update(discordId + salt).digest('hex').substring(0, 16);
}

// Clean a single backup file
function cleanBackupFile(filename: string): void {
  const filepath = join(BACKUP_DIR, filename);

  try {
    console.log(`🔧 Processing ${filename}...`);

    let content = readFileSync(filepath, 'utf8');

    // Find and replace Discord IDs in SQL INSERT statements
    const discordIdPattern = /'(\d{17,19})'/g;
    const walletPattern = /'(0x[a-fA-F0-9]{40})'/g;

    let replacementCount = 0;

    // Replace Discord IDs with hashed versions
    content = content.replace(discordIdPattern, (match, discordId) => {
      // Only replace if it looks like a Discord ID (17-19 digits)
      if (discordId.length >= 17 && discordId.length <= 19) {
        const hashedId = hashDiscordId(discordId);
        replacementCount++;
        return `'ANON_${hashedId}'`;
      }
      return match;
    });

    // Replace wallet addresses with anonymized versions
    content = content.replace(walletPattern, (match, address) => {
      const hashedAddress = crypto.createHash('sha256').update(address).digest('hex').substring(0, 10);
      return `'0xANON${hashedAddress}'`;
    });

    if (replacementCount > 0) {
      // Add anonymization notice at the top
      const notice = `-- ANONYMIZED BACKUP FILE
-- Original Discord IDs have been hashed for privacy protection
-- Generated: ${new Date().toISOString()}
-- Anonymized entries: ${replacementCount}

`;
      content = notice + content;

      writeFileSync(filepath, content, 'utf8');
      console.log(`✅ Anonymized ${replacementCount} Discord IDs in ${filename}`);
    } else {
      console.log(`ℹ️  No Discord IDs found in ${filename}`);
    }

  } catch (error) {
    console.error(`❌ Error processing ${filename}:`, error);
  }
}

// Main cleanup process
async function main() {
  console.log('🔒 Starting secure backup cleanup...');

  try {
    const files = readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sql'));
    console.log(`📁 Found ${files.length} backup files to process`);

    for (const file of files) {
      cleanBackupFile(file);
    }

    console.log('✅ Secure backup cleanup completed');
    console.log('📋 Recommendations:');
    console.log('   1. Set BACKUP_ANONYMIZATION_SALT environment variable to a unique value');
    console.log('   2. Store anonymized backups in a separate, secure location');
    console.log('   3. Consider encryption for additional security');
    console.log('   4. Implement backup retention policies');

  } catch (error) {
    console.error('❌ Backup cleanup failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { cleanBackupFile, hashDiscordId };