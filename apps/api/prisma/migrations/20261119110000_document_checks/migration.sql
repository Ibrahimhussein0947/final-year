-- AlterEnum
ALTER TYPE "VerificationKind" ADD VALUE 'IDENTITY';

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('BIRTH_CERTIFICATE', 'EDUCATION_CERTIFICATE');

-- CreateEnum
CREATE TYPE "DocumentCheckOutcome" AS ENUM ('CONSISTENT', 'PARTIAL', 'MISMATCH', 'UNREADABLE');

-- CreateTable
CREATE TABLE "WorkerIdentity" (
    "workerId" TEXT NOT NULL,
    "fatherName" TEXT,
    "grandfatherName" TEXT,
    "dateOfBirth" DATE,
    "verifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerIdentity_pkey" PRIMARY KEY ("workerId")
);

-- CreateTable
CREATE TABLE "DocumentCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "docType" "DocumentType" NOT NULL,
    "educationId" TEXT,
    "outcome" "DocumentCheckOutcome" NOT NULL,
    "ocrConfidence" INTEGER,
    "textChars" INTEGER NOT NULL DEFAULT 0,
    "fields" JSONB NOT NULL,
    "flags" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCheck_fileId_key" ON "DocumentCheck"("fileId");

-- CreateIndex
CREATE INDEX "DocumentCheck_userId_idx" ON "DocumentCheck"("userId");

-- CreateIndex
CREATE INDEX "FileAsset_sha256_idx" ON "FileAsset"("sha256");

-- AddForeignKey
ALTER TABLE "WorkerIdentity" ADD CONSTRAINT "WorkerIdentity_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentCheck" ADD CONSTRAINT "DocumentCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentCheck" ADD CONSTRAINT "DocumentCheck_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
