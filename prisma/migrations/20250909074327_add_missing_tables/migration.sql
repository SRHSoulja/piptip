/*
  Warnings:

  - You are about to drop the column `balanceAtomic` on the `User` table. All the data in the column will be lost.
  - Added the required column `tokenId` to the `Match` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tokenId` to the `Tip` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "AppConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "minDeposit" DECIMAL NOT NULL DEFAULT 50,
    "minWithdraw" DECIMAL NOT NULL DEFAULT 50,
    "withdrawMaxPerTx" DECIMAL NOT NULL DEFAULT 50,
    "withdrawDailyCap" DECIMAL NOT NULL DEFAULT 500,
    "houseFeeBps" INTEGER NOT NULL DEFAULT 200,
    "tipFeeBps" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ApprovedServer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "note" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "text" TEXT NOT NULL,
    "url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "userId" INTEGER,
    "otherUserId" INTEGER,
    "guildId" TEXT,
    "tokenId" INTEGER,
    "amount" DECIMAL NOT NULL,
    "fee" DECIMAL NOT NULL DEFAULT 0,
    "txHash" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Token" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "minDeposit" DECIMAL NOT NULL DEFAULT 50,
    "minWithdraw" DECIMAL NOT NULL DEFAULT 50,
    "tipFeeBps" INTEGER,
    "houseFeeBps" INTEGER,
    "withdrawMaxPerTx" DECIMAL,
    "withdrawDailyCap" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserBalance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "tokenId" INTEGER NOT NULL,
    "amount" DECIMAL NOT NULL DEFAULT 0,
    CONSTRAINT "UserBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserBalance_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Match" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL,
    "wagerAtomic" DECIMAL NOT NULL DEFAULT 0,
    "potAtomic" DECIMAL NOT NULL DEFAULT 0,
    "tokenId" INTEGER NOT NULL,
    "challengerId" INTEGER NOT NULL,
    "joinerId" INTEGER,
    "challengerMove" TEXT,
    "joinerMove" TEXT,
    "result" TEXT,
    "rakeAtomic" DECIMAL NOT NULL DEFAULT 0,
    "winnerUserId" INTEGER,
    "messageId" TEXT,
    "channelId" TEXT,
    "offerDeadline" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Match_challengerId_fkey" FOREIGN KEY ("challengerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_joinerId_fkey" FOREIGN KEY ("joinerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Match_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Match" ("challengerId", "challengerMove", "channelId", "createdAt", "id", "joinerId", "joinerMove", "messageId", "offerDeadline", "potAtomic", "rakeAtomic", "result", "status", "wagerAtomic", "winnerUserId") SELECT "challengerId", "challengerMove", "channelId", "createdAt", "id", "joinerId", "joinerMove", "messageId", "offerDeadline", "potAtomic", "rakeAtomic", "result", "status", "wagerAtomic", "winnerUserId" FROM "Match";
DROP TABLE "Match";
ALTER TABLE "new_Match" RENAME TO "Match";
CREATE INDEX "Match_status_offerDeadline_idx" ON "Match"("status", "offerDeadline");
CREATE INDEX "Match_createdAt_idx" ON "Match"("createdAt");
CREATE TABLE "new_Tip" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fromUserId" INTEGER NOT NULL,
    "toUserId" INTEGER NOT NULL,
    "tokenId" INTEGER NOT NULL,
    "amountAtomic" DECIMAL NOT NULL DEFAULT 0,
    "feeAtomic" DECIMAL NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tip_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tip_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tip_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Tip" ("amountAtomic", "createdAt", "feeAtomic", "fromUserId", "id", "note", "toUserId") SELECT "amountAtomic", "createdAt", "feeAtomic", "fromUserId", "id", "note", "toUserId" FROM "Tip";
DROP TABLE "Tip";
ALTER TABLE "new_Tip" RENAME TO "Tip";
CREATE INDEX "Tip_createdAt_idx" ON "Tip"("createdAt");
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "discordId" TEXT NOT NULL,
    "agwAddress" TEXT,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("agwAddress", "createdAt", "discordId", "id", "losses", "ties", "updatedAt", "wins") SELECT "agwAddress", "createdAt", "discordId", "id", "losses", "ties", "updatedAt", "wins" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");
CREATE INDEX "User_agwAddress_idx" ON "User"("agwAddress");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ApprovedServer_guildId_key" ON "ApprovedServer"("guildId");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_guildId_idx" ON "Transaction"("guildId");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_key_key" ON "WebhookEvent"("key");

-- CreateIndex
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Token_address_key" ON "Token"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Token_symbol_key" ON "Token"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "UserBalance_userId_tokenId_key" ON "UserBalance"("userId", "tokenId");
