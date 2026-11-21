-- AlterTable
ALTER TABLE "WorkerSkill" ADD COLUMN "testedScore" INTEGER, ADD COLUMN "testedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SkillTest" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "passPercent" INTEGER NOT NULL DEFAULT 70,
    "questionsAsked" INTEGER NOT NULL DEFAULT 8,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "questions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillTest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SkillTest_pass_range" CHECK ("passPercent" BETWEEN 1 AND 100),
    CONSTRAINT "SkillTest_asked_range" CHECK ("questionsAsked" BETWEEN 3 AND 30)
);

-- CreateTable
CREATE TABLE "SkillTestAttempt" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "picked" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "correct" INTEGER,
    "total" INTEGER,
    "passed" BOOLEAN,

    CONSTRAINT "SkillTestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillTest_skillId_key" ON "SkillTest"("skillId");
CREATE INDEX "SkillTestAttempt_workerId_testId_startedAt_idx" ON "SkillTestAttempt"("workerId", "testId", "startedAt");

-- AddForeignKey
ALTER TABLE "SkillTest" ADD CONSTRAINT "SkillTest_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SkillTestAttempt" ADD CONSTRAINT "SkillTestAttempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "SkillTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SkillTestAttempt" ADD CONSTRAINT "SkillTestAttempt_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
