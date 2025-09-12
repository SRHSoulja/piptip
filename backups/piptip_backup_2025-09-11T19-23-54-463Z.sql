-- PIPTip Database Backup
-- Generated: 2025-09-11T19:23:54.463Z
-- Database: postgres
-- Host: db.irzrpzcgxxzualbviyqc.supabase.co
-- Backup Type: Full Schema + Data
-- 
-- PIPtip Database Backup (Prisma-based)
-- Generated: 2025-09-11T19:23:54.476Z
-- Method: Prisma data export

-- USERS
-- Total records: 2
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (5, '403807194308673537', NULL, 0, 0, 0, '2025-09-11T18:32:56.012Z', '2025-09-11T18:32:56.012Z');
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (6, '843340896518406154', NULL, 0, 0, 0, '2025-09-11T18:58:20.089Z', '2025-09-11T18:58:20.089Z');

-- TOKENS
-- Total records: 2
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (2, '0x3Bb6d7504d5c4B251799E5959f8336eAe6129Db1', 'JOCK', 18, true, 50, 50, 100, 200, 0, 0, '2025-09-09T19:22:45.000Z', '2025-09-11T17:44:21.972Z');
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (1, '0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62', 'PENGU', 18, true, 50, 50, 100, 200, 200, 0, '2025-09-09T15:43:53.000Z', '2025-09-11T17:44:25.182Z');

-- USER_BALANCES
-- Total records: 2
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (9, 5, 1, 150);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (10, 5, 2, 155.55);

-- TIPS
-- Total records: 0

-- TRANSACTIONS
-- Total records: 12
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (130, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 1, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T17-41-22-148Z.sql', '2025-09-11T17:41:23.807Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (131, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 2, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T17-55-48-648Z.sql', '2025-09-11T17:55:50.410Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (132, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 2, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T18-04-52-015Z.sql', '2025-09-11T18:04:53.744Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (133, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 2, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T18-05-26-110Z.sql', '2025-09-11T18:05:27.971Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (137, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 3, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T18-21-11-868Z.sql', '2025-09-11T18:21:13.531Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (138, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 4, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T18-23-09-460Z.sql', '2025-09-11T18:23:11.193Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (140, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 4, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T18-29-05-936Z.sql', '2025-09-11T18:29:07.639Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (143, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 5, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T18-32-04-181Z.sql', '2025-09-11T18:32:05.866Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (144, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 4, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T18-37-00-394Z.sql', '2025-09-11T18:37:02.164Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (145, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 4, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T18-37-43-311Z.sql', '2025-09-11T18:37:45.028Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (146, 'ADMIN_ADJUSTMENT', 5, NULL, NULL, 1, 150, 0, NULL, 'testing', '2025-09-11T18:40:43.433Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (147, 'ADMIN_ADJUSTMENT', 5, NULL, NULL, 2, 155.55, 0, NULL, 'testing', '2025-09-11T18:42:52.989Z');

-- MATCHES
-- Total records: 0

-- Summary
-- Users: 2
-- Tokens: 2
-- Tips: 0
-- Transactions: 12
-- Matches: 0
-- Backup completed successfully