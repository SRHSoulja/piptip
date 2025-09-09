-- CreateTable
CREATE TABLE "public"."User" (
    "id" SERIAL NOT NULL,
    "discordId" TEXT NOT NULL,
    "agwAddress" TEXT,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Match" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL,
    "wagerAtomic" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "potAtomic" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tokenId" INTEGER NOT NULL,
    "challengerId" INTEGER NOT NULL,
    "joinerId" INTEGER,
    "challengerMove" TEXT,
    "joinerMove" TEXT,
    "result" TEXT,
    "rakeAtomic" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "winnerUserId" INTEGER,
    "messageId" TEXT,
    "channelId" TEXT,
    "offerDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tip" (
    "id" SERIAL NOT NULL,
    "fromUserId" INTEGER NOT NULL,
    "toUserId" INTEGER NOT NULL,
    "tokenId" INTEGER NOT NULL,
    "amountAtomic" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "feeAtomic" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GroupTip" (
    "id" SERIAL NOT NULL,
    "creatorId" INTEGER NOT NULL,
    "tokenId" INTEGER NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "duration" INTEGER NOT NULL,
    "messageId" TEXT,
    "channelId" TEXT,
    "guildId" TEXT,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupTip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GroupTipClaim" (
    "id" SERIAL NOT NULL,
    "groupTipId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupTipClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Token" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "minDeposit" DECIMAL(65,30) NOT NULL DEFAULT 50,
    "minWithdraw" DECIMAL(65,30) NOT NULL DEFAULT 50,
    "tipFeeBps" INTEGER,
    "houseFeeBps" INTEGER,
    "withdrawMaxPerTx" DECIMAL(65,30),
    "withdrawDailyCap" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserBalance" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenId" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "UserBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProcessedDeposit" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedDeposit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."DepositCursor" (
    "name" TEXT NOT NULL,
    "blockHex" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositCursor_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "public"."AppConfig" (
    "id" SERIAL NOT NULL,
    "minDeposit" DECIMAL(65,30) NOT NULL DEFAULT 50,
    "minWithdraw" DECIMAL(65,30) NOT NULL DEFAULT 50,
    "withdrawMaxPerTx" DECIMAL(65,30) NOT NULL DEFAULT 50,
    "withdrawDailyCap" DECIMAL(65,30) NOT NULL DEFAULT 500,
    "houseFeeBps" INTEGER NOT NULL DEFAULT 200,
    "tipFeeBps" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ApprovedServer" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "note" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovedServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Ad" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Transaction" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "userId" INTEGER,
    "otherUserId" INTEGER,
    "guildId" TEXT,
    "tokenId" INTEGER,
    "amount" DECIMAL(65,30) NOT NULL,
    "fee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "txHash" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WebhookEvent" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "public"."User"("discordId");

-- CreateIndex
CREATE INDEX "User_agwAddress_idx" ON "public"."User"("agwAddress");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "public"."User"("createdAt");

-- CreateIndex
CREATE INDEX "Match_status_offerDeadline_idx" ON "public"."Match"("status", "offerDeadline");

-- CreateIndex
CREATE INDEX "Match_createdAt_idx" ON "public"."Match"("createdAt");

-- CreateIndex
CREATE INDEX "Tip_createdAt_idx" ON "public"."Tip"("createdAt");

-- CreateIndex
CREATE INDEX "GroupTip_status_expiresAt_idx" ON "public"."GroupTip"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "GroupTip_createdAt_idx" ON "public"."GroupTip"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GroupTipClaim_groupTipId_userId_key" ON "public"."GroupTipClaim"("groupTipId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Token_address_key" ON "public"."Token"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Token_symbol_key" ON "public"."Token"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "UserBalance_userId_tokenId_key" ON "public"."UserBalance"("userId", "tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovedServer_guildId_key" ON "public"."ApprovedServer"("guildId");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "public"."Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_guildId_idx" ON "public"."Transaction"("guildId");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "public"."Transaction"("type");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_key_key" ON "public"."WebhookEvent"("key");

-- CreateIndex
CREATE INDEX "WebhookEvent_createdAt_idx" ON "public"."WebhookEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."Match" ADD CONSTRAINT "Match_challengerId_fkey" FOREIGN KEY ("challengerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Match" ADD CONSTRAINT "Match_joinerId_fkey" FOREIGN KEY ("joinerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Match" ADD CONSTRAINT "Match_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "public"."Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tip" ADD CONSTRAINT "Tip_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tip" ADD CONSTRAINT "Tip_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tip" ADD CONSTRAINT "Tip_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "public"."Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupTip" ADD CONSTRAINT "GroupTip_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupTip" ADD CONSTRAINT "GroupTip_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "public"."Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupTipClaim" ADD CONSTRAINT "GroupTipClaim_groupTipId_fkey" FOREIGN KEY ("groupTipId") REFERENCES "public"."GroupTip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupTipClaim" ADD CONSTRAINT "GroupTipClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserBalance" ADD CONSTRAINT "UserBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserBalance" ADD CONSTRAINT "UserBalance_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "public"."Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
