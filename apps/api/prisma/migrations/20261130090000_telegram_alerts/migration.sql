-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyTelegram" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramLinkExpiresAt" TIMESTAMP(3),
ADD COLUMN     "telegramLinkHash" TEXT,
ADD COLUMN     "telegramLinkedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramLinkHash_key" ON "User"("telegramLinkHash");
