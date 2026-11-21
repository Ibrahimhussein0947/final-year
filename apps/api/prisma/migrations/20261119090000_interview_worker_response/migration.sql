-- CreateEnum
CREATE TYPE "InterviewResponse" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN "workerResponse" "InterviewResponse" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "respondedAt" TIMESTAMP(3),
ADD COLUMN "declineNote" TEXT;
