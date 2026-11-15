-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "invitationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_invitationId_key" ON "Conversation"("invitationId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "JobInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
