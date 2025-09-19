-- Performance Optimization Indexes for PIPTip
-- Based on database performance analysis

-- Critical indexes for tip operations (most frequent queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tip_fromUserId_status_createdAt_idx"
ON "Tip"("fromUserId", "status", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tip_toUserId_status_createdAt_idx"
ON "Tip"("toUserId", "status", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tip_status_createdAt_amount_idx"
ON "Tip"("status", "createdAt", "amountAtomic");

-- Balance operations optimization (mission critical)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserBalance_userId_tokenId_amount_idx"
ON "UserBalance"("userId", "tokenId", "amount");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserBalance_tokenId_amount_idx"
ON "UserBalance"("tokenId", "amount");

-- Match performance for gaming features
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Match_status_createdAt_idx"
ON "Match"("status", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Match_challengerId_status_idx"
ON "Match"("challengerId", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Match_challengeeId_status_idx"
ON "Match"("challengeeId", "status");

-- User streak performance for leaderboards
CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserStreak_currentWins_lastGameAt_idx"
ON "UserStreak"("currentWins" DESC, "lastGameAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserStreak_longestWins_lastGameAt_idx"
ON "UserStreak"("longestWins" DESC, "lastGameAt" DESC);

-- Transaction analysis and statistics
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_userId_type_createdAt_idx"
ON "Transaction"("userId", "type", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_tokenId_type_createdAt_idx"
ON "Transaction"("tokenId", "type", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_type_status_createdAt_idx"
ON "Transaction"("type", "status", "createdAt");

-- Group tip optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS "GroupTip_status_expiresAt_guildId_idx"
ON "GroupTip"("status", "expiresAt", "guildId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "GroupTip_createdById_status_idx"
ON "GroupTip"("createdById", "status");

-- Achievement system performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserAchievementProgress_userId_lastChecked_idx"
ON "UserAchievementProgress"("userId", "lastCheckedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "AchievementDefinition_category_enabled_sort_idx"
ON "AchievementDefinition"("category", "isEnabled", "sortOrder");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserAchievement_userId_unlockedAt_idx"
ON "UserAchievement"("userId", "unlockedAt" DESC);

-- PenguBook and social features optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_showInPenguBook_bioViewCount_idx"
ON "User"("showInPenguBook", "bioViewCount" DESC)
WHERE "bio" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_showInPenguBook_bioLastUpdated_idx"
ON "User"("showInPenguBook", "bioLastUpdated" DESC)
WHERE "bio" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "BioBrowse_viewerId_createdAt_idx"
ON "BioBrowse"("viewerId", "createdAt" DESC);

-- Treasury and financial operations
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TreasuryOperation_type_status_createdAt_idx"
ON "TreasuryOperation"("type", "status", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "TreasuryOperation_userId_status_idx"
ON "TreasuryOperation"("userId", "status");

-- Tier membership optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TierMembership_userId_isActive_idx"
ON "TierMembership"("userId", "isActive");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "TierMembership_tierId_isActive_idx"
ON "TierMembership"("tierId", "isActive");

-- Date-based queries optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tip_createdAt_status_idx"
ON "Tip"("createdAt" DESC, "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Match_createdAt_status_idx"
ON "Match"("createdAt" DESC, "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_createdAt_type_idx"
ON "Transaction"("createdAt" DESC, "type");