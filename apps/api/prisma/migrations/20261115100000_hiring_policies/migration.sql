-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrganizationType" ADD VALUE 'PUBLIC_ENTERPRISE';
ALTER TYPE "OrganizationType" ADD VALUE 'COOPERATIVE';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "referenceNumber" VARCHAR(40);

-- CreateTable
CREATE TABLE "HiringPolicy" (
    "organizationType" "OrganizationType" NOT NULL,
    "label" TEXT,
    "minAnnouncementDays" INTEGER NOT NULL DEFAULT 0,
    "requireVerified" BOOLEAN NOT NULL DEFAULT false,
    "requireDeadline" BOOLEAN NOT NULL DEFAULT false,
    "requireSalary" BOOLEAN NOT NULL DEFAULT false,
    "requireReference" BOOLEAN NOT NULL DEFAULT false,
    "requireDecisionNote" BOOLEAN NOT NULL DEFAULT false,
    "requireInterview" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "HiringPolicy_pkey" PRIMARY KEY ("organizationType")
);

-- CreateIndex
CREATE INDEX "Job_organizationId_referenceNumber_idx" ON "Job"("organizationId", "referenceNumber");

