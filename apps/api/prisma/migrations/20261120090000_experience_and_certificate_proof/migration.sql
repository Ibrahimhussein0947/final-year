-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'PROFESSIONAL_CERTIFICATE';

-- AlterTable
ALTER TABLE "WorkExperience" ADD COLUMN "source" "EvidenceSource" NOT NULL DEFAULT 'SELF_REPORTED',
ADD COLUMN "evidenceFileId" TEXT;

-- AlterTable
ALTER TABLE "DocumentCheck" ADD COLUMN "experienceId" TEXT,
ADD COLUMN "certificationId" TEXT;
