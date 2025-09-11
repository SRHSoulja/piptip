-- PIPTip Database Backup
-- Generated: 2025-09-11T04:52:05.289Z
-- Database: postgres
-- Host: db.irzrpzcgxxzualbviyqc.supabase.co
-- Backup Type: Full Schema + Data
-- 
-- PIPtip Database Backup (Prisma-based)
-- Generated: 2025-09-11T04:52:05.301Z
-- Method: Prisma data export

-- USERS
-- Total records: 2
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (1, '403807194308673537', '0xae2cf7cc881ffdfc75f1fc425a01e8ae3229fa02', 2, 0, 0, '2025-09-09T21:40:39.910Z', '2025-09-10T19:17:07.362Z');
INSERT INTO users (id, discordId, agwAddress, wins, losses, ties, createdAt, updatedAt) VALUES (2, '843340896518406154', NULL, 0, 2, 0, '2025-09-09T21:50:26.747Z', '2025-09-10T19:17:07.525Z');

-- TOKENS
-- Total records: 2
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (1, '0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62', 'PENGU', 18, true, 50, 50, NULL, NULL, 200, NULL, '2025-09-09T15:43:53.000Z', '2025-09-10T00:53:23.404Z');
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (2, '0x3Bb6d7504d5c4B251799E5959f8336eAe6129Db1', 'JOCK', 18, true, 50, 50, NULL, NULL, NULL, NULL, '2025-09-09T19:22:45.000Z', '2025-09-09T19:22:49.000Z');

-- USER_BALANCES
-- Total records: 4
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (3, 1, 2, 34.3);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (4, 2, 2, 14.86);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (1, 1, 1, 137.8);
INSERT INTO user_balances (id, userId, tokenId, amount) VALUES (2, 2, 1, 9.7);

-- TIPS
-- Total records: 8
INSERT INTO tips (id, fromUserId, toUserId, tokenId, amountAtomic, feeAtomic, taxAtomic, note, status, refundedAt, createdAt) VALUES (1, 1, 2, 1, 10, 0, 0, 'tax test', 'PENDING', NULL, '2025-09-10T09:03:23.903Z');
INSERT INTO tips (id, fromUserId, toUserId, tokenId, amountAtomic, feeAtomic, taxAtomic, note, status, refundedAt, createdAt) VALUES (2, 2, 1, 1, 10, 0.1, 0, NULL, 'PENDING', NULL, '2025-09-10T09:07:30.734Z');
INSERT INTO tips (id, fromUserId, toUserId, tokenId, amountAtomic, feeAtomic, taxAtomic, note, status, refundedAt, createdAt) VALUES (3, 2, 1, 1, 5, 0.05, 0, 'tax test', 'PENDING', NULL, '2025-09-10T09:08:21.627Z');
INSERT INTO tips (id, fromUserId, toUserId, tokenId, amountAtomic, feeAtomic, taxAtomic, note, status, refundedAt, createdAt) VALUES (4, 1, 2, 2, 5, 0, 0, NULL, 'PENDING', NULL, '2025-09-10T19:39:35.576Z');
INSERT INTO tips (id, fromUserId, toUserId, tokenId, amountAtomic, feeAtomic, taxAtomic, note, status, refundedAt, createdAt) VALUES (5, 2, 1, 1, 5, 0.05, 0, NULL, 'PENDING', NULL, '2025-09-10T23:49:21.832Z');
INSERT INTO tips (id, fromUserId, toUserId, tokenId, amountAtomic, feeAtomic, taxAtomic, note, status, refundedAt, createdAt) VALUES (6, 1, 2, 2, 5, 0, 0, NULL, 'PENDING', NULL, '2025-09-10T23:51:19.231Z');
INSERT INTO tips (id, fromUserId, toUserId, tokenId, amountAtomic, feeAtomic, taxAtomic, note, status, refundedAt, createdAt) VALUES (7, 1, 2, 2, 5, 0, 0, NULL, 'PENDING', NULL, '2025-09-10T23:51:58.591Z');
INSERT INTO tips (id, fromUserId, toUserId, tokenId, amountAtomic, feeAtomic, taxAtomic, note, status, refundedAt, createdAt) VALUES (8, 1, 2, 1, 5, 0, 0, NULL, 'PENDING', NULL, '2025-09-10T23:53:41.323Z');

-- TRANSACTIONS
-- Total records: 81
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (1, 'TIP', 1, NULL, '1074882281841360926', 1, 20.2, 0, NULL, NULL, '2025-09-09T21:45:07.008Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (2, 'TIP', 1, NULL, '1074882281841360926', 1, 20.2, 0, NULL, NULL, '2025-09-09T21:50:00.249Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (3, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0.2, NULL, '{"groupTipId":1,"kind":"GROUP_TIP_CREATE"}', '2025-09-09T21:50:01.157Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (4, 'TIP', 2, NULL, '1074882281841360926', 1, 20, 0, NULL, NULL, '2025-09-09T21:51:03.207Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (5, 'TIP', 2, NULL, '1074882281841360926', 1, 10.1, 0, NULL, NULL, '2025-09-09T22:06:32.793Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (6, 'TIP', 2, NULL, '1074882281841360926', 1, 10, 0.1, NULL, '{"groupTipId":2,"kind":"GROUP_TIP_CREATE"}', '2025-09-09T22:06:33.661Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (7, 'TIP', 1, NULL, '1074882281841360926', 1, 10, 0, NULL, NULL, '2025-09-09T22:07:35.510Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (8, 'DEPOSIT', 1, NULL, NULL, 1, 100, 0, '0xtest_above_min_tx', NULL, '2025-09-09T22:21:32.563Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (9, 'TIP', 1, NULL, '1074882281841360926', 1, 20.2, 0, NULL, NULL, '2025-09-10T00:38:24.650Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (10, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0.2, NULL, '{"groupTipId":3,"kind":"GROUP_TIP_CREATE"}', '2025-09-10T00:38:25.608Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (11, 'TIP', 2, NULL, '1074882281841360926', 1, 20, 0, NULL, NULL, '2025-09-10T00:39:27.821Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (12, 'DEPOSIT', 1, NULL, NULL, 1, 50, 0, '0xdeadbeefcafebabefeed1234567890abcdefabcdf', NULL, '2025-09-10T00:46:55.996Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (13, 'DEPOSIT', 1, NULL, NULL, 1, 50, 0, '0xdeadbeefcafebabefeed1234567890abcdefabcef', NULL, '2025-09-10T00:48:38.004Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (14, 'WITHDRAW', 1, NULL, '1074882281841360926', 1, 50, 0, '0x42171ed72b6edde76750001784ed97520058a0d6006dec2f7aff55874cdee630', NULL, '2025-09-10T00:53:02.378Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (15, 'DEPOSIT', 1, NULL, NULL, 2, 50, 0, '0xdeadbeefcafebabefeed1234567890ab69efabcdf', NULL, '2025-09-10T01:26:58.568Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (16, 'TIP', 1, NULL, '1074882281841360926', 1, 20.2, 0, NULL, NULL, '2025-09-10T02:52:53.484Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (17, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0.2, NULL, '{"groupTipId":4,"kind":"GROUP_TIP_CREATE"}', '2025-09-10T02:52:54.447Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (18, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0, NULL, NULL, '2025-09-10T02:53:56.546Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (19, 'TIP', 1, NULL, '1074882281841360926', 2, 30.3, 0, NULL, NULL, '2025-09-10T02:55:49.430Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (20, 'TIP', 1, NULL, '1074882281841360926', 2, 30, 0.3, NULL, '{"groupTipId":5,"kind":"GROUP_TIP_CREATE"}', '2025-09-10T02:55:50.228Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (21, 'TIP', 1, NULL, '1074882281841360926', 2, 30, 0, NULL, NULL, '2025-09-10T02:56:52.241Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (22, 'TIP', 1, NULL, '1074882281841360926', 1, 20.2, 0, NULL, NULL, '2025-09-10T03:00:58.427Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (23, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0.2, NULL, '{"groupTipId":6,"kind":"GROUP_TIP_CREATE"}', '2025-09-10T03:00:59.263Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (24, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0, NULL, NULL, '2025-09-10T03:02:01.000Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (25, 'TIP', 1, NULL, '1074882281841360926', 2, 20.2, 0, NULL, NULL, '2025-09-10T03:21:14.825Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (26, 'TIP', 1, NULL, '1074882281841360926', 2, 20, 0.2, NULL, '{"groupTipId":7,"kind":"GROUP_TIP_CREATE"}', '2025-09-10T03:21:15.836Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (27, 'TIP', 1, NULL, '1074882281841360926', 1, 20.2, 0, NULL, NULL, '2025-09-10T03:21:56.941Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (28, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0.2, NULL, '{"groupTipId":8,"kind":"GROUP_TIP_CREATE"}', '2025-09-10T03:21:57.965Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (29, 'TIP', 1, NULL, '1074882281841360926', 2, 20, 0, NULL, NULL, '2025-09-10T03:22:18.163Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (30, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0, NULL, NULL, '2025-09-10T03:22:59.627Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (31, 'TIP', 1, NULL, '1074882281841360926', 1, 20.2, 0, NULL, NULL, '2025-09-10T03:25:51.097Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (32, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0.2, NULL, '{"groupTipId":9,"kind":"GROUP_TIP_CREATE"}', '2025-09-10T03:25:51.920Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (33, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0, NULL, NULL, '2025-09-10T03:26:53.988Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (34, 'TIP', 1, NULL, '1074882281841360926', 1, 20.2, 0, NULL, NULL, '2025-09-10T03:28:48.917Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (35, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0.2, NULL, '{"groupTipId":10,"kind":"GROUP_TIP_CREATE"}', '2025-09-10T03:28:49.588Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (36, 'TIP', 1, NULL, '1074882281841360926', 1, 20, 0, NULL, NULL, '2025-09-10T03:29:51.245Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (37, 'TIP', 1, NULL, '1074882281841360926', 2, 20.2, 0, NULL, NULL, '2025-09-10T04:53:40.591Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (38, 'TIP', 1, NULL, '1074882281841360926', 2, 20, 0.2, NULL, '{"groupTipId":11,"kind":"GROUP_TIP_CREATE"}', '2025-09-10T04:53:41.454Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (39, 'MATCH_WAGER', 2, NULL, '1074882281841360926', 1, 10, 0, NULL, NULL, '2025-09-10T04:54:42.669Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (40, 'TIP', 1, NULL, '1074882281841360926', 2, 20, 0, NULL, NULL, '2025-09-10T04:54:43.540Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (41, 'MATCH_WAGER', 1, NULL, '1074882281841360926', 1, 10, 0, NULL, NULL, '2025-09-10T04:55:00.807Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (42, 'MATCH_PAYOUT', 1, NULL, '1074882281841360926', 1, 19.6, 0, NULL, NULL, '2025-09-10T04:55:01.560Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (43, 'MATCH_RAKE', NULL, NULL, '1074882281841360926', 1, 0.4, 0, NULL, 'house rake', '2025-09-10T04:55:01.984Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (44, 'MEMBERSHIP_PURCHASE', 1, NULL, NULL, 1, 30, 0, NULL, 'Supporter membership', '2025-09-10T09:02:09.500Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (45, 'TIP', 1, 2, '1074882281841360926', 1, 10, 0, NULL, 'tax test', '2025-09-10T09:03:23.497Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (46, 'TIP', 2, 1, '1074882281841360926', 1, 10, 0, NULL, 'tax test', '2025-09-10T09:03:23.706Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (47, 'TIP', 1, 2, '1074882281841360926', 1, 10, 0, NULL, '{"kind":"DIRECT_TIP"}', '2025-09-10T09:03:24.112Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (48, 'TIP', 2, 1, '1074882281841360926', 1, 10, 0.1, NULL, NULL, '2025-09-10T09:07:30.354Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (49, 'TIP', 1, 2, '1074882281841360926', 1, 10, 0, NULL, NULL, '2025-09-10T09:07:30.541Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (50, 'TIP', 2, 1, '1074882281841360926', 1, 10, 0.1, NULL, '{"kind":"DIRECT_TIP"}', '2025-09-10T09:07:30.920Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (51, 'TIP', 2, 1, '1074882281841360926', 1, 5, 0.05, NULL, 'tax test', '2025-09-10T09:08:21.349Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (52, 'TIP', 1, 2, '1074882281841360926', 1, 5, 0, NULL, 'tax test', '2025-09-10T09:08:21.441Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (53, 'TIP', 2, 1, '1074882281841360926', 1, 5, 0.05, NULL, '{"kind":"DIRECT_TIP"}', '2025-09-10T09:08:21.735Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (54, 'MATCH_WAGER', 2, NULL, '1074882281841360926', 1, 5, 0, NULL, NULL, '2025-09-10T19:16:51.965Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (55, 'MATCH_WAGER', 1, NULL, '1074882281841360926', 1, 5, 0, NULL, NULL, '2025-09-10T19:17:06.521Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (56, 'MATCH_PAYOUT', 1, NULL, '1074882281841360926', 1, 9.8, 0, NULL, NULL, '2025-09-10T19:17:07.276Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (57, 'MATCH_RAKE', NULL, NULL, '1074882281841360926', 1, 0.2, 0, NULL, 'house rake', '2025-09-10T19:17:07.694Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (58, 'TIP', 1, 2, '1074882281841360926', 2, 5, 0, NULL, NULL, '2025-09-10T19:39:35.216Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (59, 'TIP', 2, 1, '1074882281841360926', 2, 5, 0, NULL, NULL, '2025-09-10T19:39:35.402Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (60, 'TIP', 1, 2, '1074882281841360926', 2, 5, 0, NULL, '{"kind":"DIRECT_TIP"}', '2025-09-10T19:39:35.762Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (61, 'TIP', 2, 1, '1074882281841360926', 1, 5, 0.05, NULL, NULL, '2025-09-10T23:49:21.443Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (62, 'TIP', 1, 2, '1074882281841360926', 1, 5, 0, NULL, NULL, '2025-09-10T23:49:21.638Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (63, 'TIP', 2, 1, '1074882281841360926', 1, 5, 0.05, NULL, '{"kind":"DIRECT_TIP"}', '2025-09-10T23:49:22.018Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (64, 'TIP', 1, NULL, '1074882281841360926', 2, 5, 0, NULL, NULL, '2025-09-10T23:50:27.250Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (65, 'TIP', 1, 2, '1074882281841360926', 2, 5, 0, NULL, NULL, '2025-09-10T23:51:18.863Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (66, 'TIP', 2, 1, '1074882281841360926', 2, 5, 0, NULL, NULL, '2025-09-10T23:51:19.046Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (67, 'TIP', 1, 2, '1074882281841360926', 2, 5, 0, NULL, '{"kind":"DIRECT_TIP"}', '2025-09-10T23:51:19.411Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (68, 'TIP', 1, 2, '1074882281841360926', 2, 5, 0, NULL, NULL, '2025-09-10T23:51:58.314Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (69, 'TIP', 2, 1, '1074882281841360926', 2, 5, 0, NULL, NULL, '2025-09-10T23:51:58.406Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (70, 'TIP', 1, 2, '1074882281841360926', 2, 5, 0, NULL, '{"kind":"DIRECT_TIP"}', '2025-09-10T23:51:58.683Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (71, 'TIP', 1, 2, '1074882281841360926', 1, 5, 0, NULL, NULL, '2025-09-10T23:53:40.992Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (72, 'TIP', 2, 1, '1074882281841360926', 1, 5, 0, NULL, NULL, '2025-09-10T23:53:41.160Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (73, 'TIP', 1, 2, '1074882281841360926', 1, 5, 0, NULL, '{"kind":"DIRECT_TIP"}', '2025-09-10T23:53:41.488Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (74, 'TIP', 1, NULL, '1074882281841360926', 2, 5, 0, NULL, NULL, '2025-09-10T23:55:29.993Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (75, 'TIP', 1, NULL, '1074882281841360926', 1, 50, 0, NULL, NULL, '2025-09-11T02:01:53.998Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (76, 'TIP', 1, NULL, '1074882281841360926', 1, 50, 0, NULL, NULL, '2025-09-11T02:06:56.798Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (77, 'TIP', 2, NULL, '1074882281841360926', 2, 14.14, 0, NULL, NULL, '2025-09-11T02:07:05.835Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (78, 'TIP', 2, NULL, '1074882281841360926', 2, 14, 0.14, NULL, '{"groupTipId":14,"kind":"GROUP_TIP_CREATE"}', '2025-09-11T02:07:06.164Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (79, 'TIP', 1, NULL, '1074882281841360926', 1, 50, 0, NULL, NULL, '2025-09-11T02:08:39.319Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (80, 'TIP', 2, NULL, '1074882281841360926', 2, 14, 0, NULL, NULL, '2025-09-11T02:12:08.994Z');
INSERT INTO transactions (id, type, userId, otherUserId, guildId, tokenId, amount, fee, txHash, metadata, createdAt) VALUES (81, 'TIP', 1, NULL, '1074882281841360926', 1, 50, 0, NULL, NULL, '2025-09-11T02:13:43.557Z');

-- MATCHES
-- Total records: 2
INSERT INTO matches (id, status, wagerAtomic, potAtomic, tokenId, challengerId, joinerId, challengerMove, joinerMove, result, rakeAtomic, winnerUserId, messageId, channelId, offerDeadline, createdAt) VALUES (1, 'SETTLED', 10, 20, 1, 2, 1, 'pebble', 'ice', 'WIN_JOINER', 0.4, 1, '1415198813542682666', '1201493956807114762', '2025-09-10T05:04:48.967Z', '2025-09-10T04:54:42.945Z');
INSERT INTO matches (id, status, wagerAtomic, potAtomic, tokenId, challengerId, joinerId, challengerMove, joinerMove, result, rakeAtomic, winnerUserId, messageId, channelId, offerDeadline, createdAt) VALUES (2, 'SETTLED', 5, 10, 1, 2, 1, 'penguin', 'pebble', 'WIN_JOINER', 0.2, 1, '1415415776453726309', '1201493956807114762', '2025-09-10T19:26:57.161Z', '2025-09-10T19:16:52.222Z');

-- Summary
-- Users: 2
-- Tokens: 2
-- Tips: 8
-- Transactions: 81
-- Matches: 2
-- Backup completed successfully