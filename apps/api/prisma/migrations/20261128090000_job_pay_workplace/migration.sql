-- Independent dimensions of a job: how it is paid, where it is done, how people are selected, and the benefits offered.
CREATE TYPE "PayBasis" AS ENUM ('MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY', 'PER_PROJECT', 'COMMISSION', 'PIECE_RATE', 'PERFORMANCE', 'NEGOTIABLE', 'UNPAID');
CREATE TYPE "Workplace" AS ENUM ('OFFICE', 'HOME', 'FACTORY', 'FARM', 'HEALTH_FACILITY', 'CONSTRUCTION_SITE', 'OUTDOOR', 'INDUSTRIAL_FACILITY', 'VEHICLE', 'SHIP', 'AIRCRAFT', 'LABORATORY', 'RETAIL_SHOP', 'MULTIPLE_SITES', 'FULLY_REMOTE');
CREATE TYPE "RecruitmentMethod" AS ENUM ('OPEN', 'INTERNAL', 'REFERRAL', 'DIRECT', 'COMPETITIVE', 'MASS', 'EMERGENCY', 'SEASONAL', 'CAMPUS', 'AGENCY');

ALTER TABLE "Job" ADD COLUMN "workplace" "Workplace";
ALTER TABLE "Job" ADD COLUMN "recruitmentMethod" "RecruitmentMethod";
ALTER TABLE "Job" ADD COLUMN "payBasis" "PayBasis";
ALTER TABLE "Job" ADD COLUMN "benefitTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
