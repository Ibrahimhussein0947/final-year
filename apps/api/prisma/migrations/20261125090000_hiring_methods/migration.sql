-- CreateEnum
CREATE TYPE "HiringStepKind" AS ENUM ('WRITTEN_EXAM', 'SCORE_SHEET', 'REFERENCE_CHECKED', 'GUARANTOR_RECORDED');
CREATE TYPE "AppealOutcome" AS ENUM ('UPHELD', 'REOPENED');

-- AlterTable
ALTER TABLE "HiringPolicy"
  ADD COLUMN "requiredSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "suggestedSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "panelSize" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "maxProbationDays" INTEGER,
  ADD COLUMN "appealDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobOffer" ADD COLUMN "probationDays" INTEGER;

-- CreateTable
CREATE TABLE "HiringStep" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "HiringStepKind" NOT NULL,
    "data" JSONB NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationAppeal" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "outcome" "AppealOutcome",
    "reply" TEXT,

    CONSTRAINT "ApplicationAppeal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HiringStep_applicationId_kind_idx" ON "HiringStep"("applicationId", "kind");
CREATE UNIQUE INDEX "ApplicationAppeal_applicationId_key" ON "ApplicationAppeal"("applicationId");

ALTER TABLE "HiringStep" ADD CONSTRAINT "HiringStep_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationAppeal" ADD CONSTRAINT "ApplicationAppeal_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Starting methods per organization type. These are developer defaults, NOT legal advice: they must be confirmed by a legal
-- adviser and can be changed by an administrator. Only rows that exist are updated; the seed creates the rest.
UPDATE "HiringPolicy" SET "requiredSteps" = ARRAY['ID_VERIFIED','WRITTEN_EXAM','SCORE_SHEET'], "suggestedSteps" = ARRAY['REFERENCE_CHECKED'], "panelSize" = 3, "maxProbationDays" = NULL, "appealDays" = 7 WHERE "organizationType" = 'GOVERNMENT';
UPDATE "HiringPolicy" SET "requiredSteps" = ARRAY['ID_VERIFIED','WRITTEN_EXAM','SCORE_SHEET'], "suggestedSteps" = ARRAY['REFERENCE_CHECKED'], "panelSize" = 2, "maxProbationDays" = 45, "appealDays" = 7 WHERE "organizationType" = 'PUBLIC_ENTERPRISE';
UPDATE "HiringPolicy" SET "requiredSteps" = ARRAY['ID_VERIFIED','SCORE_SHEET','REFERENCE_CHECKED'], "suggestedSteps" = ARRAY['WRITTEN_EXAM'], "panelSize" = 2, "maxProbationDays" = 45, "appealDays" = 0 WHERE "organizationType" = 'NGO';
UPDATE "HiringPolicy" SET "requiredSteps" = ARRAY['ID_VERIFIED'], "suggestedSteps" = ARRAY['REFERENCE_CHECKED'], "maxProbationDays" = NULL WHERE "organizationType" = 'RECRUITMENT_AGENCY';
UPDATE "HiringPolicy" SET "suggestedSteps" = ARRAY['ID_VERIFIED','SCORE_SHEET','REFERENCE_CHECKED'], "maxProbationDays" = 45 WHERE "organizationType" = 'TRAINING_INSTITUTION';
UPDATE "HiringPolicy" SET "suggestedSteps" = ARRAY['ID_VERIFIED','REFERENCE_CHECKED'], "maxProbationDays" = 45 WHERE "organizationType" IN ('PRIVATE_COMPANY','SME','COOPERATIVE','CONSTRUCTION','FACTORY','HOTEL_RESTAURANT','AGRICULTURAL');
UPDATE "HiringPolicy" SET "suggestedSteps" = ARRAY['ID_VERIFIED','GUARANTOR_RECORDED','REFERENCE_CHECKED'], "maxProbationDays" = NULL WHERE "organizationType" IN ('HOUSEHOLD','INDIVIDUAL');
