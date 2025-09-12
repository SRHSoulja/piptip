-- Migration: Add performance indexes and ensure unique constraints
-- Date: 2025-09-11
-- Purpose: Add critical performance indexes for hot-path queries

BEGIN;

-- Add performance indexes on Tip table
CREATE INDEX IF NOT EXISTS "Tip_fromUserId_idx" ON "Tip"("fromUserId");
CREATE INDEX IF NOT EXISTS "Tip_toUserId_idx" ON "Tip"("toUserId");

-- Add performance indexes on GroupTip table  
CREATE INDEX IF NOT EXISTS "GroupTip_creatorId_idx" ON "GroupTip"("creatorId");
CREATE INDEX IF NOT EXISTS "GroupTip_guildId_idx" ON "GroupTip"("guildId");

-- Add performance indexes on GroupTipClaim table
CREATE INDEX IF NOT EXISTS "GroupTipClaim_groupTipId_idx" ON "GroupTipClaim"("groupTipId");
CREATE INDEX IF NOT EXISTS "GroupTipClaim_userId_idx" ON "GroupTipClaim"("userId");

-- Ensure unique constraint on GroupTipClaim (critical for duplicate prevention)
CREATE UNIQUE INDEX IF NOT EXISTS "GroupTipClaim_groupTipId_userId_key" ON "GroupTipClaim"("groupTipId", "userId");

-- Add performance indexes on Match table
CREATE INDEX IF NOT EXISTS "Match_challengerId_idx" ON "Match"("challengerId");
CREATE INDEX IF NOT EXISTS "Match_joinerId_idx" ON "Match"("joinerId");

-- Add performance index on Transaction table
CREATE INDEX IF NOT EXISTS "Transaction_userId_idx" ON "Transaction"("userId");

COMMIT;