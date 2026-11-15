-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN "maxFeaturedJobs" INTEGER,
ADD COLUMN "maxApplicationsReviewedPerMonth" INTEGER;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "featuredAt" TIMESTAMP(3);

-- Starting limits for the three plans the system ships with (the administrator can change them). Other plans stay unlimited.
UPDATE "SubscriptionPlan" SET "maxFeaturedJobs" = 0, "maxApplicationsReviewedPerMonth" = 100 WHERE "slug" = 'free';
UPDATE "SubscriptionPlan" SET "maxFeaturedJobs" = 3, "maxApplicationsReviewedPerMonth" = 1000 WHERE "slug" = 'standard';
