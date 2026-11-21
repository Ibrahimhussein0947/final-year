-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'NATIONAL_ID';
ALTER TYPE "DocumentType" ADD VALUE 'EXPERIENCE_LETTER';
ALTER TYPE "DocumentType" ADD VALUE 'BUSINESS_LICENSE';
ALTER TYPE "DocumentType" ADD VALUE 'TIN_CERTIFICATE';
ALTER TYPE "DocumentType" ADD VALUE 'COMMERCIAL_REGISTRATION';
ALTER TYPE "DocumentType" ADD VALUE 'REPRESENTATIVE_ID';
ALTER TYPE "DocumentType" ADD VALUE 'AUTHORIZATION_LETTER';
ALTER TYPE "DocumentType" ADD VALUE 'ORG_REGISTRATION';
ALTER TYPE "DocumentType" ADD VALUE 'GOVERNMENT_LETTER';
ALTER TYPE "DocumentType" ADD VALUE 'AGENCY_LICENSE';

-- AlterTable
ALTER TABLE "WorkerIdentity" ADD COLUMN "idType" TEXT, ADD COLUMN "idNumber" TEXT;

-- AlterTable
ALTER TABLE "DocumentCheck" ADD COLUMN "organizationId" TEXT;

-- CreateTable
CREATE TABLE "OrganizationLegal" (
    "organizationId" TEXT NOT NULL,
    "tin" TEXT,
    "licenseNumber" TEXT,
    "licenseExpiresAt" DATE,
    "registrationNumber" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationLegal_pkey" PRIMARY KEY ("organizationId")
);

-- AddForeignKey
ALTER TABLE "OrganizationLegal" ADD CONSTRAINT "OrganizationLegal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
