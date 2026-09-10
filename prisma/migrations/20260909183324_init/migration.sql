-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('not_started', 'in_progress', 'completed', 'skipped');

-- CreateEnum
CREATE TYPE "Assistance" AS ENUM ('none', 'hints', 'solution_viewed');

-- CreateEnum
CREATE TYPE "GradingOrigin" AS ENUM ('server_objective', 'browser_automated', 'self_reported');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('passed', 'failed', 'needs_self_assessment');

-- CreateEnum
CREATE TYPE "ReleaseState" AS ENUM ('draft', 'published', 'superseded', 'invalid');

-- CreateEnum
CREATE TYPE "RevealKind" AS ENUM ('hint', 'solution');

-- CreateEnum
CREATE TYPE "ReviewRating" AS ENUM ('again', 'hard', 'good', 'easy');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('not_started', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('track', 'chapter', 'lesson', 'exercise', 'review_card', 'assessment', 'mission');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "displayEmail" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "preferencesRevision" INTEGER NOT NULL DEFAULT 1,
    "activeReleaseId" TEXT,
    "activeReleaseRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "masteryRevision" INTEGER NOT NULL DEFAULT 1,
    "kind" "ContentKind" NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "primaryConceptId" TEXT,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRelease" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "packageVersion" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "state" "ReleaseState" NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "baseReleaseId" TEXT,
    "validationSummary" JSONB NOT NULL,
    "changeSummary" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ContentRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseItem" (
    "releaseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReleaseItem_pkey" PRIMARY KEY ("releaseId","itemId")
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "exerciseVersionId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "masteryRevision" INTEGER NOT NULL,
    "sourceSnapshot" TEXT,
    "answer" JSONB,
    "outcome" "AttemptOutcome" NOT NULL,
    "gradingOrigin" "GradingOrigin" NOT NULL,
    "assistance" "Assistance" NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevealEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "masteryRevision" INTEGER NOT NULL,
    "revealKind" "RevealKind" NOT NULL,
    "hintIndex" INTEGER,
    "clientEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevealEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonProgress" (
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "status" "LessonStatus" NOT NULL DEFAULT 'not_started',
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LessonProgress_pkey" PRIMARY KEY ("userId","lessonId")
);

-- CreateTable
CREATE TABLE "ChapterPlacement" (
    "userId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "placedOut" BOOLEAN NOT NULL DEFAULT false,
    "qualifiedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ChapterPlacement_pkey" PRIMARY KEY ("userId","chapterId")
);

-- CreateTable
CREATE TABLE "PlacementAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "assessmentVersionId" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "submittedAnswers" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "qualified" BOOLEAN NOT NULL,
    "practiceOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ExerciseDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftSnapshot" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewState" (
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMPTZ(6) NOT NULL,
    "lastReviewedAt" TIMESTAMPTZ(6),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewState_pkey" PRIMARY KEY ("userId","cardId")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "cardVersionId" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "rating" "ReviewRating" NOT NULL,
    "correctness" BOOLEAN,
    "gradingOrigin" "GradingOrigin" NOT NULL,
    "fromRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentItemId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "userId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("userId","contentItemId")
);

-- CreateTable
CREATE TABLE "MissionProgress" (
    "userId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "status" "MissionStatus" NOT NULL DEFAULT 'not_started',
    "repositoryUrl" TEXT,
    "commitHash" TEXT,
    "report" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MissionProgress_pkey" PRIMARY KEY ("userId","missionId")
);

-- CreateTable
CREATE TABLE "XpAward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "awardKey" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contentItemId" TEXT,
    "relatedRecordId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MutationReceipt" (
    "userId" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MutationReceipt_pkey" PRIMARY KEY ("userId","clientEventId")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "sourceAddress" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedEmail_key" ON "User"("normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "ContentVersion_kind_parentId_sortOrder_idx" ON "ContentVersion"("kind", "parentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_itemId_version_key" ON "ContentVersion"("itemId", "version");

-- CreateIndex
CREATE INDEX "ContentRelease_ownerId_state_createdAt_idx" ON "ContentRelease"("ownerId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRelease_ownerId_packageId_packageVersion_key" ON "ContentRelease"("ownerId", "packageId", "packageVersion");

-- CreateIndex
CREATE INDEX "ReleaseItem_releaseId_kind_parentId_sortOrder_idx" ON "ReleaseItem"("releaseId", "kind", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "Attempt_userId_exerciseVersionId_createdAt_idx" ON "Attempt"("userId", "exerciseVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "Attempt_userId_exerciseId_createdAt_idx" ON "Attempt"("userId", "exerciseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_userId_clientEventId_key" ON "Attempt"("userId", "clientEventId");

-- CreateIndex
CREATE INDEX "RevealEvent_userId_itemId_masteryRevision_idx" ON "RevealEvent"("userId", "itemId", "masteryRevision");

-- CreateIndex
CREATE UNIQUE INDEX "RevealEvent_userId_clientEventId_key" ON "RevealEvent"("userId", "clientEventId");

-- CreateIndex
CREATE INDEX "LessonProgress_userId_status_idx" ON "LessonProgress"("userId", "status");

-- CreateIndex
CREATE INDEX "PlacementAttempt_userId_chapterId_createdAt_idx" ON "PlacementAttempt"("userId", "chapterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementAttempt_userId_clientEventId_key" ON "PlacementAttempt"("userId", "clientEventId");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseDraft_userId_exerciseId_key" ON "ExerciseDraft"("userId", "exerciseId");

-- CreateIndex
CREATE INDEX "DraftSnapshot_draftId_createdAt_idx" ON "DraftSnapshot"("draftId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewState_userId_dueAt_idx" ON "ReviewState"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "ReviewEvent_userId_cardId_createdAt_idx" ON "ReviewEvent"("userId", "cardId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_userId_clientEventId_key" ON "ReviewEvent"("userId", "clientEventId");

-- CreateIndex
CREATE INDEX "Note_userId_updatedAt_idx" ON "Note"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "MissionProgress_userId_status_idx" ON "MissionProgress"("userId", "status");

-- CreateIndex
CREATE INDEX "XpAward_userId_createdAt_idx" ON "XpAward"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "XpAward_userId_awardKey_key" ON "XpAward"("userId", "awardKey");

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_createdAt_id_idx" ON "ActivityEvent"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "MutationReceipt_createdAt_idx" ON "MutationReceipt"("createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_normalizedEmail_sourceAddress_createdAt_idx" ON "LoginAttempt"("normalizedEmail", "sourceAddress", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeReleaseId_fkey" FOREIGN KEY ("activeReleaseId") REFERENCES "ContentRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRelease" ADD CONSTRAINT "ContentRelease_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseItem" ADD CONSTRAINT "ReleaseItem_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ContentRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseItem" ADD CONSTRAINT "ReleaseItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_exerciseVersionId_fkey" FOREIGN KEY ("exerciseVersionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevealEvent" ADD CONSTRAINT "RevealEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterPlacement" ADD CONSTRAINT "ChapterPlacement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementAttempt" ADD CONSTRAINT "PlacementAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementAttempt" ADD CONSTRAINT "PlacementAttempt_assessmentVersionId_fkey" FOREIGN KEY ("assessmentVersionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseDraft" ADD CONSTRAINT "ExerciseDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseDraft" ADD CONSTRAINT "ExerciseDraft_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftSnapshot" ADD CONSTRAINT "DraftSnapshot_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ExerciseDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewState" ADD CONSTRAINT "ReviewState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_cardVersionId_fkey" FOREIGN KEY ("cardVersionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionProgress" ADD CONSTRAINT "MissionProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpAward" ADD CONSTRAINT "XpAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MutationReceipt" ADD CONSTRAINT "MutationReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
