-- Awards are stored as profile activities.
ALTER TYPE "ActivityKind" ADD VALUE 'AWARD';

-- More CV details on the profile.
ALTER TABLE "WorkerProfile"
  ADD COLUMN "languageLevels" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "objective" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "addressLine" TEXT,
  ADD COLUMN "nationality" TEXT;

-- More detail per job.
ALTER TABLE "WorkExperience"
  ADD COLUMN "location" TEXT,
  ADD COLUMN "employmentType" "EmploymentType",
  ADD COLUMN "reasonLeft" TEXT,
  ADD COLUMN "achievements" TEXT;
