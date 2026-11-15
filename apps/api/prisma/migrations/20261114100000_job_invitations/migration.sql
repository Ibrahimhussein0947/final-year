-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('SENT', 'APPLIED', 'DECLINED');

-- CreateTable
CREATE TABLE "JobInvitation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "message" TEXT,
    "status" "InvitationStatus" NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "JobInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobInvitation_workerId_status_idx" ON "JobInvitation"("workerId", "status");

-- CreateIndex
CREATE INDEX "JobInvitation_invitedById_createdAt_idx" ON "JobInvitation"("invitedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobInvitation_jobId_workerId_key" ON "JobInvitation"("jobId", "workerId");

-- AddForeignKey
ALTER TABLE "JobInvitation" ADD CONSTRAINT "JobInvitation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobInvitation" ADD CONSTRAINT "JobInvitation_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobInvitation" ADD CONSTRAINT "JobInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

