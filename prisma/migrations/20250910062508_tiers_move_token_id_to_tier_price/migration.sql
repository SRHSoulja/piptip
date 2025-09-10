/*
  Warnings:

  - You are about to drop the column `tokenId` on the `Tier` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Tier" DROP CONSTRAINT "Tier_tokenId_fkey";

-- AlterTable
ALTER TABLE "public"."Tier" DROP COLUMN "tokenId",
ALTER COLUMN "priceAmount" DROP NOT NULL;

-- CreateTable
CREATE TABLE "public"."TierPrice" (
    "id" SERIAL NOT NULL,
    "tierId" INTEGER NOT NULL,
    "tokenId" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TierPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TierPrice_tokenId_idx" ON "public"."TierPrice"("tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "TierPrice_tierId_tokenId_key" ON "public"."TierPrice"("tierId", "tokenId");

-- AddForeignKey
ALTER TABLE "public"."TierPrice" ADD CONSTRAINT "TierPrice_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "public"."Tier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TierPrice" ADD CONSTRAINT "TierPrice_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "public"."Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
