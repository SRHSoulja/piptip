-- Migration: Add status and tax tracking to tips and group tips
-- Date: 2025-09-10
-- Purpose: Implement comprehensive refund system with principal + tax tracking

BEGIN;

-- Create enums for new status fields
CREATE TYPE "TipStatus" AS ENUM ('PENDING', 'COMPLETED', 'REFUNDED');
CREATE TYPE "GroupTipStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REFUNDED', 'FAILED');
CREATE TYPE "GroupContributionStatus" AS ENUM ('PENDING', 'CLAIMED', 'REFUNDED');

-- Add new fields to Tip table
ALTER TABLE "Tip" ADD COLUMN "taxAtomic" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Tip" ADD COLUMN "status" "TipStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Tip" ADD COLUMN "refundedAt" TIMESTAMP(3);

-- Add index on tip status
CREATE INDEX "Tip_status_idx" ON "Tip"("status");

-- Add new fields to GroupTip table  
ALTER TABLE "GroupTip" ADD COLUMN "taxAtomic" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "GroupTip" ADD COLUMN "refundedAt" TIMESTAMP(3);

-- Convert existing GroupTip.status from VARCHAR to enum
-- First, update existing string values to match enum values
UPDATE "GroupTip" SET "status" = 'ACTIVE' WHERE "status" = 'ACTIVE';
UPDATE "GroupTip" SET "status" = 'EXPIRED' WHERE "status" = 'EXPIRED';
UPDATE "GroupTip" SET "status" = 'FINALIZED' WHERE "status" = 'FINALIZED';
UPDATE "GroupTip" SET "status" = 'FAILED' WHERE "status" = 'FAILED';
UPDATE "GroupTip" SET "status" = 'REFUNDED' WHERE "status" = 'REFUNDED';

-- Handle any other status values by setting them to ACTIVE (safest default)
UPDATE "GroupTip" SET "status" = 'ACTIVE' WHERE "status" NOT IN ('ACTIVE', 'EXPIRED', 'FINALIZED', 'FAILED', 'REFUNDED');

-- Now change the column type
ALTER TABLE "GroupTip" ALTER COLUMN "status" TYPE "GroupTipStatus" USING "status"::text::"GroupTipStatus";

-- Add new fields to GroupTipClaim table
ALTER TABLE "GroupTipClaim" ADD COLUMN "status" "GroupContributionStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "GroupTipClaim" ADD COLUMN "refundedAt" TIMESTAMP(3);

-- Rename existing claimedAt to be optional (since PENDING claims won't have it)
ALTER TABLE "GroupTipClaim" ALTER COLUMN "claimedAt" DROP NOT NULL;
ALTER TABLE "GroupTipClaim" ALTER COLUMN "claimedAt" DROP DEFAULT;

-- Add creation timestamp for new claims
ALTER TABLE "GroupTipClaim" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add index on group tip claim status
CREATE INDEX "GroupTipClaim_status_idx" ON "GroupTipClaim"("status");

-- Backfill existing data
-- Mark all existing tips as COMPLETED (they succeeded if they exist)
UPDATE "Tip" SET "status" = 'COMPLETED' WHERE "status" = 'PENDING';

-- Copy feeAtomic to taxAtomic for existing tips (they're the same for now)
UPDATE "Tip" SET "taxAtomic" = "feeAtomic";

-- Mark all existing group tip claims as CLAIMED (they succeeded if they exist)
UPDATE "GroupTipClaim" SET "status" = 'CLAIMED' WHERE "status" = 'PENDING' AND "claimedAt" IS NOT NULL;

-- Set createdAt for existing claims to match claimedAt (best approximation)
UPDATE "GroupTipClaim" SET "createdAt" = "claimedAt" WHERE "claimedAt" IS NOT NULL;

-- For claims without claimedAt, set createdAt to a reasonable default
UPDATE "GroupTipClaim" SET "createdAt" = CURRENT_TIMESTAMP WHERE "createdAt" IS NULL;

COMMIT;