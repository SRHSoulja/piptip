-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_discordId_idx" ON "User"("discordId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserBalance_userId_idx" ON "UserBalance"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserBalance_tokenId_idx" ON "UserBalance"("tokenId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PredictionMarket_status_guildId_createdAt_idx" ON "PredictionMarket"("status", "guildId", "createdAt") WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PredictionParticipation_userId_createdAt_idx" ON "PredictionParticipation"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ActivityFeedItem_visibility_createdAt_idx" ON "ActivityFeedItem"("visibility", "createdAt" DESC) WHERE "visibility" = 'public';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt" DESC) WHERE "userId" IS NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Tip_status_createdAt_idx" ON "Tip"("status", "createdAt" DESC) WHERE "status" = 'COMPLETED';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_sentAt_createdAt_idx" ON "Notification"("sentAt", "createdAt") WHERE "sentAt" IS NULL;