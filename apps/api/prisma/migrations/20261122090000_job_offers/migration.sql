-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED', 'STARTED');

-- CreateTable
CREATE TABLE "JobOffer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OFFERED',
    "salary" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "startDate" DATE NOT NULL,
    "respondBy" DATE NOT NULL,
    "note" TEXT,
    "respondedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "expiryRemindedAt" TIMESTAMP(3),
    "startRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOffer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JobOffer_salary_positive" CHECK ("salary" IS NULL OR "salary" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "JobOffer_applicationId_key" ON "JobOffer"("applicationId");
CREATE INDEX "JobOffer_workerId_status_idx" ON "JobOffer"("workerId", "status");
CREATE INDEX "JobOffer_organizationId_status_idx" ON "JobOffer"("organizationId", "status");
CREATE INDEX "JobOffer_status_startDate_idx" ON "JobOffer"("status", "startDate");

-- AddForeignKey
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
