-- CreateEnum
CREATE TYPE "CriterionType" AS ENUM ('BOOLEAN', 'NUMBER', 'CHOICE', 'MULTI_CHOICE');

-- CreateEnum
CREATE TYPE "CriterionImportance" AS ENUM ('MUST_HAVE', 'PREFERRED');

-- CreateTable
CREATE TABLE "CriterionDefinition" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT,
    "key" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAm" TEXT,
    "labelOm" TEXT,
    "helpEn" TEXT,
    "type" "CriterionType" NOT NULL,
    "options" JSONB,
    "unit" TEXT,
    "minValue" INTEGER,
    "maxValue" INTEGER,
    "mustHaveAllowed" BOOLEAN NOT NULL DEFAULT true,
    "evidenceSuggested" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriterionDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCriterion" (
    "jobId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "importance" "CriterionImportance" NOT NULL DEFAULT 'PREFERRED',
    "value" JSONB NOT NULL,

    CONSTRAINT "JobCriterion_pkey" PRIMARY KEY ("jobId","criterionId")
);

-- CreateTable
CREATE TABLE "WorkerCriterion" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" "EvidenceSource" NOT NULL DEFAULT 'SELF_REPORTED',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CriterionDefinition_categoryId_isActive_idx" ON "CriterionDefinition"("categoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionDefinition_categoryId_key_key" ON "CriterionDefinition"("categoryId", "key");

-- CreateIndex
CREATE INDEX "JobCriterion_criterionId_idx" ON "JobCriterion"("criterionId");

-- CreateIndex
CREATE INDEX "WorkerCriterion_criterionId_idx" ON "WorkerCriterion"("criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerCriterion_workerId_criterionId_key" ON "WorkerCriterion"("workerId", "criterionId");

-- AddForeignKey
ALTER TABLE "CriterionDefinition" ADD CONSTRAINT "CriterionDefinition_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCriterion" ADD CONSTRAINT "JobCriterion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCriterion" ADD CONSTRAINT "JobCriterion_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "CriterionDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCriterion" ADD CONSTRAINT "WorkerCriterion_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerCriterion" ADD CONSTRAINT "WorkerCriterion_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "CriterionDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Criteria that apply to every sector (categoryId NULL) must have unique keys too: a plain unique index treats NULLs as distinct.
CREATE UNIQUE INDEX "CriterionDefinition_key_global_unique" ON "CriterionDefinition"("key") WHERE "categoryId" IS NULL;
