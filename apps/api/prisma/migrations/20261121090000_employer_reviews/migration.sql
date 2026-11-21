-- CreateTable
CREATE TABLE "EmployerReview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "paidOnTime" BOOLEAN,
    "respectful" BOOLEAN,
    "asDescribed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployerReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmployerReview_rating_range" CHECK ("rating" BETWEEN 1 AND 5)
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployerReview_applicationId_key" ON "EmployerReview"("applicationId");

-- CreateIndex
CREATE INDEX "EmployerReview_organizationId_idx" ON "EmployerReview"("organizationId");

-- AddForeignKey
ALTER TABLE "EmployerReview" ADD CONSTRAINT "EmployerReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerReview" ADD CONSTRAINT "EmployerReview_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
