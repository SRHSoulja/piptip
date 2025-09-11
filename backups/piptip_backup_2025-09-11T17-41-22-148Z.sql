-- PIPTip Database Backup
-- Generated: 2025-09-11T17:41:22.148Z
-- Database: postgres
-- Host: db.irzrpzcgxxzualbviyqc.supabase.co
-- Backup Type: Full Schema + Data
-- 
-- PIPtip Database Backup (Prisma-based)
-- Generated: 2025-09-11T17:41:22.158Z
-- Method: Prisma data export

-- USERS
-- Total records: 0

-- TOKENS
-- Total records: 2
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (1, '0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62', 'PENGU', 18, true, 50, 50, NULL, NULL, 200, NULL, '2025-09-09T15:43:53.000Z', '2025-09-10T00:53:23.404Z');
INSERT INTO tokens (id, address, symbol, decimals, active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap, createdAt, updatedAt) VALUES (2, '0x3Bb6d7504d5c4B251799E5959f8336eAe6129Db1', 'JOCK', 18, true, 50, 50, NULL, NULL, NULL, NULL, '2025-09-09T19:22:45.000Z', '2025-09-09T19:22:49.000Z');

-- USER_BALANCES
-- Total records: 0

-- TIPS
-- Total records: 0

-- TRANSACTIONS
-- Total records: 0

-- MATCHES
-- Total records: 0

-- Summary
-- Users: 0
-- Tokens: 2
-- Tips: 0
-- Transactions: 0
-- Matches: 0
-- Backup completed successfully