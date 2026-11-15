-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('INTERNSHIP', 'VOLUNTEER', 'TRAINING', 'APPRENTICESHIP', 'REFERENCE');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "autoApplied" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Education" ADD COLUMN     "department" TEXT,
ADD COLUMN     "evidenceFileId" TEXT,
ADD COLUMN     "gpa" DOUBLE PRECISION,
ADD COLUMN     "gpaScale" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "autoApply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoApplyMinScore" INTEGER NOT NULL DEFAULT 80;

-- CreateTable
CREATE TABLE "ProfileActivity" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "title" TEXT NOT NULL,
    "organization" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "hours" INTEGER,
    "description" TEXT,
    "source" "EvidenceSource" NOT NULL DEFAULT 'SELF_REPORTED',
    "evidenceFileId" TEXT,

    CONSTRAINT "ProfileActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfileActivity_workerId_kind_idx" ON "ProfileActivity"("workerId", "kind");

-- AddForeignKey
ALTER TABLE "ProfileActivity" ADD CONSTRAINT "ProfileActivity_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A GPA must be non-negative and not above its own scale; the auto-apply threshold is a percentage.
ALTER TABLE "Education" ADD CONSTRAINT "Education_gpa_check" CHECK ("gpa" IS NULL OR ("gpaScale" IS NOT NULL AND "gpaScale" > 0 AND "gpa" >= 0 AND "gpa" <= "gpaScale"));
ALTER TABLE "User" ADD CONSTRAINT "User_autoApplyMinScore_check" CHECK ("autoApplyMinScore" BETWEEN 50 AND 100);
