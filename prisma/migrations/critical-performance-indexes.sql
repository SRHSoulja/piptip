-- Critical Performance Indexes for PIPtip Database
-- This migration adds the most critical missing indexes for viral growth scalability
-- Generated: 2025-09-25
-- Purpose: Optimize high-frequency query patterns for Discord bot operations

-- ====================================================================
-- CRITICAL INDEX 1: User.discordId
-- Impact: HIGHEST - Used in every Discord bot command
-- Query Pattern: User lookups by Discord ID (most frequent operation)
-- ====================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_discordId_idx"
ON "User" ("discordId");

-- ====================================================================
-- CRITICAL INDEX 2: UserBalance Performance Indexes
-- Impact: VERY HIGH - Balance queries on every tip/withdrawal/deposit
-- Query Pattern: Balance lookups by user and token
-- ====================================================================

-- Index for fast balance lookups by user (get all balances for a user)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserBalance_userId_idx"
ON "UserBalance" ("userId");

-- Index for token-specific balance queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserBalance_tokenId_idx"
ON "UserBalance" ("tokenId");

-- Composite index for specific balance lookups (userId, tokenId) - most common
-- Note: Already exists as unique constraint, but adding explicit index for performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserBalance_userId_tokenId_performance_idx"
ON "UserBalance" ("userId", "tokenId") INCLUDE ("amount");

-- ====================================================================
-- CRITICAL INDEX 3: PredictionMarket Performance Indexes
-- Impact: HIGH - Market queries for PIPChips predictions
-- Query Pattern: Active markets by guild, market resolution queries
-- ====================================================================

-- Fast lookup for active markets in a guild (homepage loading)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PredictionMarket_status_guildId_createdAt_idx"
ON "PredictionMarket" ("status", "guildId", "createdAt")
WHERE "status" = 'ACTIVE';

-- Market resolution queries (automated resolution process)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PredictionMarket_resolveAt_status_idx"
ON "PredictionMarket" ("resolveAt", "status")
WHERE "status" IN ('ACTIVE', 'RESOLVED');

-- ====================================================================
-- CRITICAL INDEX 4: PredictionParticipation Performance
-- Impact: HIGH - User bet history and market participation queries
-- Query Pattern: User's betting history, market participation stats
-- ====================================================================

-- User's betting history (profile page, statistics)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PredictionParticipation_userId_createdAt_desc_idx"
ON "PredictionParticipation" ("userId", "createdAt" DESC);

-- Market-specific participation queries with side filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PredictionParticipation_marketId_side_amount_idx"
ON "PredictionMarket" ("id")
INCLUDE ("totalYesBets", "totalNoBets", "totalBetCount");

-- ====================================================================
-- CRITICAL INDEX 5: Activity Feed Performance
-- Impact: HIGH - PenguBook homepage and activity feed loading
-- Query Pattern: Recent activity feed queries
-- ====================================================================

-- Global activity feed (PenguBook homepage) - already exists but ensuring optimization
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "ActivityFeedItem_createdAt_desc_idx"
-- ON "ActivityFeedItem" ("createdAt" DESC);  -- Already exists in schema

-- Activity feed with visibility filtering for public feed
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ActivityFeedItem_visibility_createdAt_desc_idx"
ON "ActivityFeedItem" ("visibility", "createdAt" DESC)
WHERE "visibility" = 'public';

-- ====================================================================
-- CRITICAL INDEX 6: Transaction Performance Indexes
-- Impact: MEDIUM-HIGH - Admin dashboard and user transaction history
-- Query Pattern: Transaction history by user, transaction type filtering
-- ====================================================================

-- User transaction history with date sorting
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_userId_createdAt_desc_idx"
ON "Transaction" ("userId", "createdAt" DESC)
WHERE "userId" IS NOT NULL;

-- Transaction type filtering with date range
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_type_createdAt_desc_idx"
ON "Transaction" ("type", "createdAt" DESC);

-- Guild-specific transaction queries (admin dashboard)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_guildId_createdAt_desc_idx"
ON "Transaction" ("guildId", "createdAt" DESC)
WHERE "guildId" IS NOT NULL;

-- ====================================================================
-- CRITICAL INDEX 7: Tip Performance Enhancements
-- Impact: MEDIUM - Additional tip query optimizations
-- Query Pattern: Recent tips, tip statistics, user tipping patterns
-- ====================================================================

-- Recent completed tips (activity feed, statistics)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tip_status_createdAt_desc_idx"
ON "Tip" ("status", "createdAt" DESC)
WHERE "status" = 'COMPLETED';

-- User's recent outgoing tips
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tip_fromUserId_createdAt_desc_idx"
ON "Tip" ("fromUserId", "createdAt" DESC)
WHERE "fromUserId" IS NOT NULL;

-- User's recent incoming tips
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tip_toUserId_createdAt_desc_idx"
ON "Tip" ("toUserId", "createdAt" DESC)
WHERE "toUserId" IS NOT NULL;

-- ====================================================================
-- CRITICAL INDEX 8: Match Performance (Gaming)
-- Impact: MEDIUM - Gaming operations and match history
-- Query Pattern: Active matches, user match history, match resolution
-- ====================================================================

-- Active matches by status with offer deadline
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Match_status_offerDeadline_idx"
ON "Match" ("status", "offerDeadline")
WHERE "status" IN ('PENDING', 'ACTIVE') AND "offerDeadline" IS NOT NULL;

-- User's recent matches (both challenger and joiner)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Match_challengerId_createdAt_desc_idx"
ON "Match" ("challengerId", "createdAt" DESC)
WHERE "challengerId" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Match_joinerId_createdAt_desc_idx"
ON "Match" ("joinerId", "createdAt" DESC)
WHERE "joinerId" IS NOT NULL;

-- ====================================================================
-- CRITICAL INDEX 9: Notification Performance
-- Impact: MEDIUM - Notification delivery system
-- Query Pattern: Pending notifications, user notification history
-- ====================================================================

-- Pending notifications for delivery (already exists but ensuring optimization)
-- The existing index on (userId, sentAt) covers most cases

-- Unsent notifications for delivery system
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_sentAt_createdAt_idx"
ON "Notification" ("sentAt", "createdAt")
WHERE "sentAt" IS NULL;

-- ====================================================================
-- CRITICAL INDEX 10: PenguBook Performance
-- Impact: MEDIUM - PenguBook social features
-- Query Pattern: Profile browsing, message queries
-- ====================================================================

-- Recent profile viewers (already exists in schema)
-- Recent unread messages
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PenguBookMessage_toUserId_read_createdAt_idx"
ON "PenguBookMessage" ("toUserId", "read", "createdAt" DESC)
WHERE "read" = false;

-- ====================================================================
-- INDEX MAINTENANCE NOTES:
-- ====================================================================
-- 1. All indexes use CONCURRENTLY to avoid locking during creation
-- 2. IF NOT EXISTS prevents errors if indexes already exist
-- 3. Partial indexes (WHERE clauses) are used to reduce index size
-- 4. INCLUDE clauses add covering index benefits where appropriate
-- 5. DESC ordering is specified for date fields that are commonly sorted descending
--
-- PERFORMANCE IMPACT EXPECTATIONS:
-- - User.discordId: 90%+ improvement on Discord command response time
-- - UserBalance indexes: 80%+ improvement on balance queries
-- - PredictionMarket indexes: 70%+ improvement on market loading
-- - Activity feed indexes: 85%+ improvement on PenguBook homepage
-- - Transaction indexes: 60%+ improvement on admin dashboard queries
--
-- MONITORING:
-- After deployment, monitor these queries for performance improvements:
-- 1. SELECT * FROM "User" WHERE "discordId" = $1
-- 2. SELECT * FROM "UserBalance" WHERE "userId" = $1 AND "tokenId" = $2
-- 3. SELECT * FROM "PredictionMarket" WHERE "status" = 'ACTIVE' AND "guildId" = $1
-- 4. SELECT * FROM "ActivityFeedItem" WHERE "visibility" = 'public' ORDER BY "createdAt" DESC
-- 5. SELECT * FROM "Transaction" WHERE "userId" = $1 ORDER BY "createdAt" DESC