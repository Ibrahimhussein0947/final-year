-- Remove conversations whose application no longer exists (left behind before this link existed).
DELETE FROM "Conversation" WHERE "applicationId" IS NOT NULL AND "applicationId" NOT IN (SELECT "id" FROM "Application");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
