import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Minimal published release fixture.
 *
 * Just enough real content for the foundation tests to exercise drafts,
 * bookmarks and missions against genuine ContentItem / ContentVersion /
 * ReleaseItem rows rather than invented ids.
 */

function checksum(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export interface ContentFixture {
  releaseId: string;
  exerciseId: string;
  exerciseVersionId: string;
  missionId: string;
  missionVersionId: string;
  lessonId: string;
}

const EXERCISE_PAYLOAD = {
  kind: 'exercise',
  id: 'js-arrays-filter-open',
  version: 1,
  masteryRevision: 1,
  title: 'Count open support tickets',
  conceptIds: ['js.array-filter'],
  prerequisiteIds: [],
  bodyMarkdown: 'Practice selecting records without changing the input.',
  lessonId: 'v1-l08',
  sortOrder: 0,
  type: 'function',
  difficulty: 'foundation',
  estimatedMinutes: 6,
  promptMarkdown: 'Return the number of tickets whose status is exactly open.',
  hints: ['Separate selecting from counting.', 'filter returns a new array.', "Use === 'open'."],
  solution: {
    code: 'function countOpen(t){return t.filter(x=>x.status==="open").length;}',
    explanationMarkdown: 'Filtering selects matching records without changing the original array.',
  },
  grading: {
    kind: 'function-cases',
    language: 'javascript',
    entrypoint: 'countOpen',
    starterCode: 'function countOpen(tickets) { return 0; }',
    assertInputUnchanged: true,
    cases: [
      { id: 'empty', args: [[]], expected: 0, hidden: false },
      {
        id: 'mixed',
        args: [[{ status: 'open' }, { status: 'closed' }, { status: 'open' }]],
        expected: 2,
        hidden: false,
      },
    ],
  },
  primaryConceptId: 'js.array-filter',
  requiredForLessonCompletion: true,
};

const MISSION_PAYLOAD = {
  kind: 'mission',
  id: 'm01-support-ticket-interface',
  version: 1,
  masteryRevision: 1,
  title: 'Support ticket interface',
  conceptIds: ['react.state'],
  prerequisiteIds: [],
  bodyMarkdown: 'Build a ticket list, filter, create form and detail view.',
  projectId: 'support-desk',
  workType: 'build',
  stack: 'react',
  release: 'v1',
  chapterPrerequisiteIds: [],
  starterAssetId: 'm01-starter-v1',
  starterCommit: null,
  setupMarkdown: 'pnpm install then pnpm dev.',
  baselineChecks: ['pnpm test:baseline'],
  acceptanceCriteria: ['Title is required and trimmed.', 'Errors are associated.', 'No overflow.'],
  verificationCommands: ['pnpm test:mission'],
  checklist: [
    { id: 'list-renders', label: 'Ticket list renders' },
    { id: 'form-validates', label: 'Create form validates' },
  ],
  hints: ['Decide where state lives.', 'Validate at the boundary.', 'Refresh after success.'],
  solutionMarkdown: 'Lift filter state to the list container.',
  reflectionRubric: ['Explains component vs server state.'],
};

export async function seedContentFixture(db: PrismaClient): Promise<ContentFixture> {
  const owner = await db.user.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });

  await db.contentItem.createMany({
    data: [
      { id: 'v1-l08', kind: 'lesson' },
      { id: EXERCISE_PAYLOAD.id, kind: 'exercise' },
      { id: MISSION_PAYLOAD.id, kind: 'mission' },
    ],
    skipDuplicates: true,
  });

  const exerciseVersion = await db.contentVersion.create({
    data: {
      itemId: EXERCISE_PAYLOAD.id,
      version: 1,
      masteryRevision: 1,
      kind: 'exercise',
      parentId: 'v1-l08',
      sortOrder: 0,
      primaryConceptId: 'js.array-filter',
      title: EXERCISE_PAYLOAD.title,
      payload: EXERCISE_PAYLOAD,
      checksum: checksum(EXERCISE_PAYLOAD),
    },
  });

  const missionVersion = await db.contentVersion.create({
    data: {
      itemId: MISSION_PAYLOAD.id,
      version: 1,
      masteryRevision: 1,
      kind: 'mission',
      sortOrder: 0,
      title: MISSION_PAYLOAD.title,
      payload: MISSION_PAYLOAD,
      checksum: checksum(MISSION_PAYLOAD),
    },
  });

  const release = await db.contentRelease.create({
    data: {
      packageId: 'devpractice-v1',
      packageVersion: '1.0.0-test',
      ownerId: owner.id,
      checksum: 'test-fixture',
      state: 'published',
      title: 'Test fixture release',
      validationSummary: { errors: 0, warnings: 0 },
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      items: {
        create: [
          {
            itemId: EXERCISE_PAYLOAD.id,
            versionId: exerciseVersion.id,
            kind: 'exercise',
            parentId: 'v1-l08',
            sortOrder: 0,
          },
          {
            itemId: MISSION_PAYLOAD.id,
            versionId: missionVersion.id,
            kind: 'mission',
            sortOrder: 0,
          },
        ],
      },
    },
  });

  // Every user in the test database reads the same fixture release.
  await db.user.updateMany({ data: { activeReleaseId: release.id } });

  return {
    releaseId: release.id,
    exerciseId: EXERCISE_PAYLOAD.id,
    exerciseVersionId: exerciseVersion.id,
    missionId: MISSION_PAYLOAD.id,
    missionVersionId: missionVersion.id,
    lessonId: 'v1-l08',
  };
}
