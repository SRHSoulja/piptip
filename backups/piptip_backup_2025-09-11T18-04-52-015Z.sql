-- ANONYMIZED BACKUP FILE
-- Original Discord IDs have been hashed for privacy protection
-- Generated: 2025-09-19T10:26:17.647Z
-- Anonymized entries: 1

-- PIPTip Database Backup
-- Generated: 2025-09-11T18:04:52.015Z
-- Database: postgres
-- Host: db.irzrpzcgxxzualbviyqc.supabase.co
-- Backup Type: Full Schema + Data
-- 
-- PIPtip Database Backup (Prisma-based)
-- Generated: 2025-09-11T18:04:52.027Z
-- Method: Prisma data export

-- USERS
-- Total records: 1
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (4, 'ANON_6cc43811397ff6b1', NULL, 0, 0, 0, '2025-09-11T17:41:33.668Z', '2025-09-11T17:41:33.668Z');

-- TOKENS
-- Total records: 2
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (2, '0xANONe7a89befdd', 'JOCK', 18, true, 50, 50, 100, 200, 0, 0, '2025-09-09T19:22:45.000Z', '2025-09-11T17:44:21.972Z');
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (1, '0xANONcfffb25cb6', 'PENGU', 18, true, 50, 50, 100, 200, 200, 0, '2025-09-09T15:43:53.000Z', '2025-09-11T17:44:25.182Z');

-- USER_BALANCES
-- Total records: 1
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (5, 4, 1, 150);

-- TIPS
-- Total records: 0

-- TRANSACTIONS
-- Total records: 2
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (130, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 1, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T17-41-22-148Z.sql', '2025-09-11T17:41:23.807Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (131, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 2, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T17-55-48-648Z.sql', '2025-09-11T17:55:50.410Z');

-- MATCHES
-- Total records: 0

-- Summary
-- Users: 1
-- Tokens: 2
-- Tips: 0
-- Transactions: 2
-- Matches: 0
-- Backup completed successfully