-- Validation rules Prisma cannot express in the schema.

ALTER TABLE "WorkerSkill"
  ADD CONSTRAINT "WorkerSkill_proficiency_range" CHECK ("proficiency" BETWEEN 1 AND 5);

ALTER TABLE "JobSkill"
  ADD CONSTRAINT "JobSkill_minProficiency_range" CHECK ("minProficiency" IS NULL OR "minProficiency" BETWEEN 1 AND 5);

ALTER TABLE "Review"
  ADD CONSTRAINT "Review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_salary_order" CHECK ("salaryMin" IS NULL OR "salaryMax" IS NULL OR "salaryMin" <= "salaryMax"),
  ADD CONSTRAINT "Job_vacancies_positive" CHECK ("vacancies" >= 1),
  ADD CONSTRAINT "Job_experience_nonneg" CHECK ("minExperienceYears" IS NULL OR "minExperienceYears" >= 0),
  ADD CONSTRAINT "Job_lat_range" CHECK ("lat" IS NULL OR "lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "Job_lng_range" CHECK ("lng" IS NULL OR "lng" BETWEEN -180 AND 180);

ALTER TABLE "WorkerProfile"
  ADD CONSTRAINT "WorkerProfile_salary_order" CHECK ("expectedSalaryMin" IS NULL OR "expectedSalaryMax" IS NULL OR "expectedSalaryMin" <= "expectedSalaryMax"),
  ADD CONSTRAINT "WorkerProfile_experience_nonneg" CHECK ("yearsExperience" >= 0),
  ADD CONSTRAINT "WorkerProfile_completion_range" CHECK ("completionPct" BETWEEN 0 AND 100),
  ADD CONSTRAINT "WorkerProfile_lat_range" CHECK ("lat" IS NULL OR "lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "WorkerProfile_lng_range" CHECK ("lng" IS NULL OR "lng" BETWEEN -180 AND 180);

ALTER TABLE "SkillRelation"
  ADD CONSTRAINT "SkillRelation_weight_range" CHECK ("weight" BETWEEN 0 AND 1),
  ADD CONSTRAINT "SkillRelation_not_self" CHECK ("skillAId" <> "skillBId");

ALTER TABLE "Recommendation"
  ADD CONSTRAINT "Recommendation_score_range" CHECK ("score" BETWEEN 0 AND 100),
  ADD CONSTRAINT "Recommendation_confidence_range" CHECK ("confidence" BETWEEN 0 AND 1);

-- Postgres full-text search index for job browsing (used from Phase 6).
CREATE INDEX "Job_fts_idx" ON "Job"
  USING GIN (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("description", '')));
