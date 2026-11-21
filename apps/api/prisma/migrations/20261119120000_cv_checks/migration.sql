-- CreateEnum
CREATE TYPE "ProfileCheckOutcome" AS ENUM ('ACCEPTED', 'DECLINED', 'UNCHECKED');

-- CreateTable
CREATE TABLE "CvCheck" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "fileId" TEXT,
    "outcome" "ProfileCheckOutcome" NOT NULL,
    "findings" JSONB NOT NULL,
    "profileHash" TEXT NOT NULL,
    "ocrConfidence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CvCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CvCheck_workerId_createdAt_idx" ON "CvCheck"("workerId", "createdAt");

-- AddForeignKey
ALTER TABLE "CvCheck" ADD CONSTRAINT "CvCheck_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
