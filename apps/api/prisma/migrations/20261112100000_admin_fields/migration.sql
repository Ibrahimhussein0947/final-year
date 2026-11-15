-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "resolutionNote" TEXT;

-- AlterTable
ALTER TABLE "VerificationRequest" ADD COLUMN     "targetId" TEXT,
ADD COLUMN     "targetType" TEXT;

-- One open report per person and target, so a report cannot be used to flood the queue.
CREATE UNIQUE INDEX "Report_open_unique" ON "Report"("reporterId", "targetType", "targetId") WHERE "status" IN ('OPEN', 'UNDER_REVIEW');
