-- AlterTable
ALTER TABLE "Interview" ADD COLUMN "remindedDayAt" TIMESTAMP(3),
ADD COLUMN "remindedHourAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Interview_status_scheduledAt_idx" ON "Interview"("status", "scheduledAt");
