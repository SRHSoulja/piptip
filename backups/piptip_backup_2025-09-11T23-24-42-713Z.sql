-- PIPTip Database Backup
-- Generated: 2025-09-11T23:24:42.713Z
-- Database: postgres
-- Host: db.irzrpzcgxxzualbviyqc.supabase.co
-- Backup Type: Full Schema + Data
-- 
-- PIPtip Database Backup (Prisma-based)
-- Generated: 2025-09-11T23:24:42.726Z
-- Method: Prisma data export

-- USERS
-- Total records: 7
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (786, 'load_test_user_000000', NULL, 0, 0, 0, '2025-09-11T23:13:21.032Z', '2025-09-11T23:13:21.032Z');
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (787, 'load_test_user_000001', NULL, 0, 0, 0, '2025-09-11T23:13:21.032Z', '2025-09-11T23:13:21.032Z');
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (5, '403807194308673537', NULL, 0, 0, 0, '2025-09-11T18:32:56.012Z', '2025-09-11T18:32:56.012Z');
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (6, '843340896518406154', NULL, 0, 0, 0, '2025-09-11T18:58:20.089Z', '2025-09-11T18:58:20.089Z');
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (788, 'load_test_user_000002', NULL, 0, 0, 0, '2025-09-11T23:13:21.032Z', '2025-09-11T23:13:21.032Z');
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (789, 'load_test_user_000003', NULL, 0, 0, 0, '2025-09-11T23:13:21.032Z', '2025-09-11T23:13:21.032Z');
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (790, 'load_test_user_000004', NULL, 0, 0, 0, '2025-09-11T23:13:21.032Z', '2025-09-11T23:13:21.032Z');

-- TOKENS
-- Total records: 4
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (2, '0x3Bb6d7504d5c4B251799E5959f8336eAe6129Db1', 'JOCK', 18, true, 50, 50, 100, 200, 0, 0, '2025-09-09T19:22:45.000Z', '2025-09-11T17:44:21.972Z');
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (1, '0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62', 'PENGU', 18, true, 50, 50, 100, 200, 200, 0, '2025-09-09T15:43:53.000Z', '2025-09-11T17:44:25.182Z');
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (130, '0x6e2b0b367d517', 'LOAD_00', 6, true, 1, 1, NULL, NULL, NULL, NULL, '2025-09-11T23:13:21.602Z', '2025-09-11T23:13:21.602Z');
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (131, '0x69addddc6006a', 'LOAD_01', 6, true, 1, 1, NULL, NULL, NULL, NULL, '2025-09-11T23:13:21.788Z', '2025-09-11T23:13:21.788Z');

-- USER_BALANCES
-- Total records: 13
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (9, 5, 1, 150);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (10, 5, 2, 155.55);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (316, 6, 1, 150);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (318, 786, 131, 10000);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (319, 787, 130, 10000);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (320, 787, 131, 10000);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (321, 788, 130, 10000);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (323, 789, 130, 10000);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (324, 789, 131, 10000);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (325, 790, 130, 10000);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (326, 790, 131, 10000);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (317, 786, 130, -386980674.139025);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (322, 788, 131, -233902130.74851);

-- TIPS
-- Total records: 0

-- TRANSACTIONS
-- Total records: 75
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
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (148, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 5, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T19-23-54-463Z.sql', '2025-09-11T19:23:56.160Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (149, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 5, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T19-25-15-228Z.sql', '2025-09-11T19:25:17.028Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (150, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 5, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T20-25-17-227Z.sql', '2025-09-11T20:25:18.359Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (151, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 6, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T21-25-17-231Z.sql', '2025-09-11T21:25:18.249Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (152, 'TIP', 132, NULL, NULL, 2, 333.333333333333333334, 0, NULL, NULL, '2025-09-11T21:38:36.067Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (153, 'TIP', 133, NULL, NULL, 2, 333.333333333333333333, 0, NULL, NULL, '2025-09-11T21:38:36.893Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (154, 'TIP', 134, NULL, NULL, 2, 333.333333333333333333, 0, NULL, NULL, '2025-09-11T21:38:37.643Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (155, 'TIP', 26, NULL, NULL, 2, 100, 0, NULL, NULL, '2025-09-11T21:38:45.175Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (156, 'TIP', 132, NULL, NULL, 2, 333.333333333333333334, 0, NULL, NULL, '2025-09-11T21:40:31.127Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (157, 'TIP', 133, NULL, NULL, 2, 333.333333333333333333, 0, NULL, NULL, '2025-09-11T21:40:32.102Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (158, 'TIP', 134, NULL, NULL, 2, 333.333333333333333333, 0, NULL, NULL, '2025-09-11T21:40:32.988Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (159, 'TIP', 26, NULL, NULL, 2, 100, 0, NULL, NULL, '2025-09-11T21:40:42.105Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (160, 'TIP', 268, NULL, NULL, 2, 333.333333333333333334, 0, NULL, NULL, '2025-09-11T21:42:07.047Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (161, 'TIP', 269, NULL, NULL, 2, 333.333333333333333333, 0, NULL, NULL, '2025-09-11T21:42:07.953Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (162, 'TIP', 270, NULL, NULL, 2, 333.333333333333333333, 0, NULL, NULL, '2025-09-11T21:42:08.764Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (163, 'TIP', 157, NULL, NULL, 2, 100, 0, NULL, NULL, '2025-09-11T21:42:16.989Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (164, 'TIP', 290, 291, NULL, 6, 100, 0, NULL, 'Direct tip transaction', '2025-09-11T21:49:32.359Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (165, 'TIP', 291, 290, NULL, 6, 100, 0, NULL, 'Group tip refund - no claims received', '2025-09-11T21:49:32.529Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (166, 'TIP', 305, 306, NULL, 11, 100, 0, NULL, 'Completed direct tip', '2025-09-11T21:51:13.805Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (167, 'TIP', 306, NULL, NULL, 11, 150, 0, NULL, 'Group tip refunded - no claims received', '2025-09-11T21:51:13.971Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (168, 'TIP', 305, NULL, NULL, 11, 75, 0, NULL, 'Tip refunded - user not found', '2025-09-11T21:51:14.140Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (169, 'TIP', 340, 341, NULL, 31, 100, 0, NULL, 'Completed direct tip', '2025-09-11T21:53:25.843Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (170, 'TIP', 341, NULL, NULL, 31, 150, 0, NULL, 'Group tip refunded - no claims received', '2025-09-11T21:53:26.023Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (171, 'TIP', 340, NULL, NULL, 31, 75, 0, NULL, 'Tip refunded - user not found', '2025-09-11T21:53:26.184Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (172, 'TIP', 376, 377, NULL, 42, 100, 0, NULL, 'Direct tip transaction', '2025-09-11T21:54:20.329Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (173, 'TIP', 377, 376, NULL, 42, 100, 0, NULL, 'Group tip refund - no claims received', '2025-09-11T21:54:20.501Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (174, 'TIP', 378, 380, NULL, 43, 100, 0, NULL, 'Completed direct tip', '2025-09-11T21:54:20.566Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (175, 'TIP', 380, NULL, NULL, 43, 150, 0, NULL, 'Group tip refunded - no claims received', '2025-09-11T21:54:20.743Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (176, 'TIP', 378, NULL, NULL, 43, 75, 0, NULL, 'Tip refunded - user not found', '2025-09-11T21:54:20.918Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (197, 'TIP', 506, NULL, NULL, 72, 101000000, 0, NULL, 'Tip refund: principal 100000000 + tax 1000000', '2025-09-11T22:13:22.333Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (198, 'TIP', 550, NULL, NULL, 81, 50500000, 0, NULL, 'Tip refund: principal 50000000 + tax 500000', '2025-09-11T22:13:25.121Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (199, 'TIP', 564, 565, NULL, 83, 100, 0, NULL, 'Completed direct tip', '2025-09-11T22:13:25.324Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (200, 'TIP', 565, NULL, NULL, 83, 150, 0, NULL, 'Group tip refunded - no claims received', '2025-09-11T22:13:25.493Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (201, 'TIP', 564, NULL, NULL, 83, 75, 0, NULL, 'Tip refunded - user not found', '2025-09-11T22:13:25.652Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (202, 'TIP', 568, 569, NULL, 84, 100, 0, NULL, 'Direct tip transaction', '2025-09-11T22:13:25.720Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (203, 'TIP', 569, 568, NULL, 84, 100, 0, NULL, 'Group tip refund - no claims received', '2025-09-11T22:13:25.882Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (208, 'TIP', 598, NULL, NULL, 92, 202000000, 0, NULL, 'Group tip refund: principal 200000000 + tax 2000000', '2025-09-11T22:13:29.474Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (211, 'TIP', 613, NULL, NULL, 94, 75750000, 0, NULL, 'Group tip refund: principal 75000000 + tax 750000', '2025-09-11T22:13:31.723Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (212, 'TIP', 709, NULL, NULL, 2, 333.333333333333333334, 0, NULL, NULL, '2025-09-11T22:14:22.950Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (213, 'TIP', 710, NULL, NULL, 2, 333.333333333333333333, 0, NULL, NULL, '2025-09-11T22:14:23.860Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (214, 'TIP', 711, NULL, NULL, 2, 333.333333333333333333, 0, NULL, NULL, '2025-09-11T22:14:24.687Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (215, 'TIP', 508, NULL, NULL, 2, 100, 0, NULL, 'Group tip refund: principal 100 + tax 0', '2025-09-11T22:14:32.533Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (216, 'TIP', 722, NULL, NULL, 98, 101000000, 0, NULL, 'Tip refund: principal 100000000 + tax 1000000', '2025-09-11T22:15:03.680Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (217, 'TIP', 724, NULL, NULL, 99, 50500000, 0, NULL, 'Tip refund: principal 50000000 + tax 500000', '2025-09-11T22:15:06.422Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (218, 'TIP', 728, NULL, NULL, 101, 202000000, 0, NULL, 'Group tip refund: principal 200000000 + tax 2000000', '2025-09-11T22:15:10.768Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (219, 'TIP', 730, NULL, NULL, 102, 75750000, 0, NULL, 'Group tip refund: principal 75000000 + tax 750000', '2025-09-11T22:15:13.017Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (232, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 16, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T22-25-17-243Z.sql', '2025-09-11T22:25:18.314Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (233, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 16, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T22-57-10-144Z.sql', '2025-09-11T22:57:11.896Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (234, 'ADMIN_ADJUSTMENT', 6, NULL, NULL, 1, 150, 0, NULL, 'Admin granted token via web interface', '2025-09-11T23:03:11.123Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (235, 'DEPOSIT', 786, NULL, NULL, 130, 10000, 0, NULL, '{"kind":"LOAD_TEST_INITIAL_FUNDING"}', '2025-09-11T23:13:22.265Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (236, 'DEPOSIT', 786, NULL, NULL, 131, 10000, 0, NULL, '{"kind":"LOAD_TEST_INITIAL_FUNDING"}', '2025-09-11T23:13:22.265Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (237, 'DEPOSIT', 787, NULL, NULL, 130, 10000, 0, NULL, '{"kind":"LOAD_TEST_INITIAL_FUNDING"}', '2025-09-11T23:13:22.265Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (238, 'DEPOSIT', 787, NULL, NULL, 131, 10000, 0, NULL, '{"kind":"LOAD_TEST_INITIAL_FUNDING"}', '2025-09-11T23:13:22.265Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (239, 'DEPOSIT', 788, NULL, NULL, 130, 10000, 0, NULL, '{"kind":"LOAD_TEST_INITIAL_FUNDING"}', '2025-09-11T23:13:22.265Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (240, 'DEPOSIT', 788, NULL, NULL, 131, 10000, 0, NULL, '{"kind":"LOAD_TEST_INITIAL_FUNDING"}', '2025-09-11T23:13:22.265Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (241, 'DEPOSIT', 789, NULL, NULL, 130, 10000, 0, NULL, '{"kind":"LOAD_TEST_INITIAL_FUNDING"}', '2025-09-11T23:13:22.265Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (242, 'DEPOSIT', 789, NULL, NULL, 131, 10000, 0, NULL, '{"kind":"LOAD_TEST_INITIAL_FUNDING"}', '2025-09-11T23:13:22.265Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (243, 'DEPOSIT', 790, NULL, NULL, 130, 10000, 0, NULL, '{"kind":"LOAD_TEST_INITIAL_FUNDING"}', '2025-09-11T23:13:22.265Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (244, 'DEPOSIT', 790, NULL, NULL, 131, 10000, 0, NULL, '{"kind":"LOAD_TEST_INITIAL_FUNDING"}', '2025-09-11T23:13:22.265Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (245, 'TIP', 786, NULL, 'load_test_guild', 130, 105.455972, 0, NULL, 'Group tip refund: principal 104.411854 + tax 1044118', '2025-09-11T23:13:28.653Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (246, 'TIP', 786, NULL, 'load_test_guild', 130, 285.405003, 0, NULL, 'Group tip refund: principal 282.579211 + tax 2825792', '2025-09-11T23:13:30.619Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (247, 'TIP', 788, NULL, 'load_test_guild', 131, 236.25149, 0, NULL, 'Group tip refund: principal 233.912367 + tax 2339123', '2025-09-11T23:13:32.403Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (248, 'SYSTEM_BACKUP', NULL, NULL, NULL, NULL, 22, 0, NULL, 'Automated backup: piptip_backup_2025-09-11T23-23-48-224Z.sql', '2025-09-11T23:23:49.942Z');

-- MATCHES
-- Total records: 0

-- Summary
-- Users: 7
-- Tokens: 4
-- Tips: 0
-- Transactions: 75
-- Matches: 0
-- Backup completed successfully