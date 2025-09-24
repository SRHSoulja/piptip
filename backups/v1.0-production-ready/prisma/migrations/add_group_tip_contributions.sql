-- Migration: Add group tip contributions tracking
-- This allows users to add to existing group tips with proper tax handling

-- Create GroupTipContribution table
CREATE TABLE "GroupTipContribution" (
    "id" SERIAL NOT NULL,
    "groupTipId" INTEGER NOT NULL,
    "contributorId" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "taxPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupTipContribution_pkey" PRIMARY KEY ("id")
);

-- Add foreign key constraints
ALTER TABLE "GroupTipContribution" ADD CONSTRAINT "GroupTipContribution_groupTipId_fkey" FOREIGN KEY ("groupTipId") REFERENCES "GroupTip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupTipContribution" ADD CONSTRAINT "GroupTipContribution_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add indexes for performance
CREATE INDEX "GroupTipContribution_groupTipId_idx" ON "GroupTipContribution"("groupTipId");
CREATE INDEX "GroupTipContribution_contributorId_idx" ON "GroupTipContribution"("contributorId");
CREATE INDEX "GroupTipContribution_status_idx" ON "GroupTipContribution"("status");

-- Prevent duplicate contributions from same user to same group tip
CREATE UNIQUE INDEX "GroupTipContribution_groupTipId_contributorId_key" ON "GroupTipContribution"("groupTipId", "contributorId");

-- Add contribution tracking to GroupTip table
ALTER TABLE "GroupTip" ADD COLUMN "contributionsTotal" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "GroupTip" ADD COLUMN "contributorsCount" INTEGER NOT NULL DEFAULT 0;