-- AddForeignKey
ALTER TABLE "EmployerReview" ADD CONSTRAINT "EmployerReview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
