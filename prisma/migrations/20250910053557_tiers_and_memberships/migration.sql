-- CreateEnum
CREATE TYPE "public"."TierMembershipStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "public"."Tier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tokenId" INTEGER NOT NULL,
    "priceAmount" DECIMAL(65,30) NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "tipTaxFree" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TierMembership" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tierId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT,
    "status" "public"."TierMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TierMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tier_active_idx" ON "public"."Tier"("active");

-- CreateIndex
CREATE UNIQUE INDEX "TierMembership_txHash_key" ON "public"."TierMembership"("txHash");

-- CreateIndex
CREATE INDEX "TierMembership_userId_tierId_expiresAt_idx" ON "public"."TierMembership"("userId", "tierId", "expiresAt");

-- CreateIndex
CREATE INDEX "TierMembership_userId_status_expiresAt_idx" ON "public"."TierMembership"("userId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_user_tier_status" ON "public"."TierMembership"("userId", "tierId", "status");

-- AddForeignKey
ALTER TABLE "public"."Tier" ADD CONSTRAINT "Tier_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "public"."Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TierMembership" ADD CONSTRAINT "TierMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TierMembership" ADD CONSTRAINT "TierMembership_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "public"."Tier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
