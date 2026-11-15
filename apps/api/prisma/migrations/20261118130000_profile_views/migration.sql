-- CreateTable
CREATE TABLE "ProfileView" (
    "workerId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstViewedAt" TIMESTAMP(3) NOT NULL,
    "lastViewedAt" TIMESTAMP(3) NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProfileView_pkey" PRIMARY KEY ("workerId","organizationId")
);

-- CreateIndex
CREATE INDEX "ProfileView_workerId_lastViewedAt_idx" ON "ProfileView"("workerId", "lastViewedAt");

-- AddForeignKey
ALTER TABLE "ProfileView" ADD CONSTRAINT "ProfileView_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileView" ADD CONSTRAINT "ProfileView_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
