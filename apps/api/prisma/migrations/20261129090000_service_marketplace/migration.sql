-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ServiceMode" AS ENUM ('AT_CUSTOMER', 'AT_PROVIDER', 'REMOTE');

-- CreateEnum
CREATE TYPE "ServiceInquiryStatus" AS ENUM ('SENT', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ReportTargetType" ADD VALUE 'SERVICE';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "serviceInquiryId" TEXT;

-- CreateTable
CREATE TABLE "ServiceListing" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "serviceMode" "ServiceMode" NOT NULL DEFAULT 'AT_CUSTOMER',
    "payBasis" "PayBasis",
    "priceMin" INTEGER,
    "priceMax" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "toolsIncluded" BOOLEAN NOT NULL DEFAULT false,
    "availability" TEXT,
    "locationId" TEXT,
    "status" "ServiceStatus" NOT NULL DEFAULT 'DRAFT',
    "descriptionHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceSkill" (
    "serviceId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "ServiceSkill_pkey" PRIMARY KEY ("serviceId","skillId")
);

-- CreateTable
CREATE TABLE "ServiceInquiry" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "preferredDate" TIMESTAMP(3),
    "status" "ServiceInquiryStatus" NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceBlock" (
    "providerUserId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceBlock_pkey" PRIMARY KEY ("providerUserId","customerId")
);

-- CreateIndex
CREATE INDEX "ServiceListing_status_categoryId_locationId_idx" ON "ServiceListing"("status", "categoryId", "locationId");

-- CreateIndex
CREATE INDEX "ServiceListing_workerId_status_idx" ON "ServiceListing"("workerId", "status");

-- CreateIndex
CREATE INDEX "ServiceListing_descriptionHash_idx" ON "ServiceListing"("descriptionHash");

-- CreateIndex
CREATE INDEX "ServiceSkill_skillId_idx" ON "ServiceSkill"("skillId");

-- CreateIndex
CREATE INDEX "ServiceInquiry_serviceId_status_idx" ON "ServiceInquiry"("serviceId", "status");

-- CreateIndex
CREATE INDEX "ServiceInquiry_customerId_createdAt_idx" ON "ServiceInquiry"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_serviceInquiryId_key" ON "Conversation"("serviceInquiryId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_serviceInquiryId_fkey" FOREIGN KEY ("serviceInquiryId") REFERENCES "ServiceInquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceListing" ADD CONSTRAINT "ServiceListing_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceListing" ADD CONSTRAINT "ServiceListing_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceListing" ADD CONSTRAINT "ServiceListing_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceSkill" ADD CONSTRAINT "ServiceSkill_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceSkill" ADD CONSTRAINT "ServiceSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceInquiry" ADD CONSTRAINT "ServiceInquiry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceInquiry" ADD CONSTRAINT "ServiceInquiry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBlock" ADD CONSTRAINT "ServiceBlock_providerUserId_fkey" FOREIGN KEY ("providerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBlock" ADD CONSTRAINT "ServiceBlock_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

