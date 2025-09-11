-- PIPTip Database Backup
-- Generated: 2025-09-11T18:23:09.460Z
-- Database: postgres
-- Host: db.irzrpzcgxxzualbviyqc.supabase.co
-- Backup Type: Full Schema + Data
-- 
-- PIPtip Database Backup (Prisma-based)
-- Generated: 2025-09-11T18:23:09.472Z
-- Method: Prisma data export

-- USERS
-- Total records: 1
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (4, '403807194308673537', NULL, 0, 0, 0, '2025-09-11T17:41:33.668Z', '2025-09-11T17:41:33.668Z');

-- TOKENS
-- Total records: 2
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (2, '0x3Bb6d7504d5c4B251799E5959f8336eAe6129Db1', 'JOCK', 18, true, 50, 50, 100, 200, 0, 0, '2025-09-09T19:22:45.000Z', '2025-09-11T17:44:21.972Z');
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (1, '0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62', 'PENGU', 18, true, 50, 50, 100, 200, 200, 0, '2025-09-09T15:43:53.000Z', '2025-09-11T17:44:25.182Z');

-- USER_BALANCES
-- Total records: 1
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (5, 4, 1, 79.606060421977789);

-- TIPS
-- Total records: 0

-- TRANSACTIONS
-- Total records: 8
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (130, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 1, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T17-41-22-148Z.sql', '2025-09-11T17:41:23.807Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (131, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 2, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T17-55-48-648Z.sql', '2025-09-11T17:55:50.410Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (132, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 2, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T18-04-52-015Z.sql', '2025-09-11T18:04:53.744Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (133, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 2, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T18-05-26-110Z.sql', '2025-09-11T18:05:27.971Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (134, 'ADMIN_ADJUSTMENT', 4, NULL, NULL, 1, 149.99999981, 0, NULL, 'testing', '2025-09-11T18:06:02.022Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (135, 'TIP', 4, NULL, '1074882281841360926', 1, 70.393939388022211, 0, NULL, NULL, '2025-09-11T18:18:24.217Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (136, 'TIP', 4, NULL, '1074882281841360926', 1, 69.6969696911111, 0.696969696911111, NULL, '{"groupTipId":16,"kind":"GROUP_TIP_CREATE"}', '2025-09-11T18:18:24.719Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (137, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 3, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T18-21-11-868Z.sql', '2025-09-11T18:21:13.531Z');

-- MATCHES
-- Total records: 0

-- Summary
-- Users: 1
-- Tokens: 2
-- Tips: 0
-- Transactions: 8
-- Matches: 0
-- Backup completed successfully