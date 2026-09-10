import type {
  ActivityEventDto,
  CurriculumChapterDto,
  CurriculumTrackDto,
  GradingOrigin,
  LessonStatus,
} from '@devpractice/contracts';

/**
 * Response shapes the shell consumes that are not declared in the shared
 * contracts package. Kept in one place so an API change surfaces as a single
 * type error rather than scattered runtime surprises.
 */

export interface ReferenceDto {
  label: string;
  url: string;
}

export interface ExerciseSummaryDto {
  id: string;
  title: string;
  type:
    | 'choice'
    | 'predict-output'
    | 'code-reading'
    | 'function'
    | 'explanation'
    | 'local-project';
  difficulty: 'foundation' | 'core' | 'stretch';
  estimatedMinutes: number;
  requiredForLessonCompletion: boolean;
  primaryConceptId: string;
  /** Owner's latest evidence for this exercise, if any. */
  latestOutcome: 'passed' | 'failed' | 'needs_self_assessment' | null;
  assistance: 'none' | 'hints' | 'solution_viewed' | null;
  masteryRevision: number;
}

export interface LessonDetailDto {
  id: string;
  chapterId: string;
  chapterTitle: string;
  title: string;
  objectives: string[];
  estimatedMinutes: number;
  bodyMarkdown: string;
  workedExampleMarkdown: string;
  commonMistakes: string[];
  summaryMarkdown: string;
  references: ReferenceDto[];
  conceptIds: string[];
  exercises: ExerciseSummaryDto[];
  reviewCardIds: string[];
  status: LessonStatus;
  /** Required-exercise mastery revisions moved past the recorded completion. */
  updatedPracticeAvailable: boolean;
  cardsEnrolled: boolean;
  bookmarked: boolean;
  previousLessonId: string | null;
  nextLessonId: string | null;
  contentVersionId: string;
}

export interface ChapterDetailDto extends CurriculumChapterDto {
  bodyMarkdown: string;
  trackId: string;
  trackTitle: string;
  /**
   * Suggested background, never blocking (spec 3.1). Prerequisites are
   * CONCEPT ids, not chapter ids — there is no chapter-level prerequisite in
   * the data model, so these are shown as advisory text rather than links.
   */
  prerequisiteIds: string[];
  placementAvailable: boolean;
  missions: MissionSummaryDto[];
}

/**
 * GET /curriculum returns the track list directly, not wrapped in an object
 * (the release id travels in the envelope's `meta`). This mirrors the API and
 * its integration tests exactly.
 */
export type CurriculumDto = CurriculumTrackDto[];

export interface TodayDto {
  resume: {
    lessonId: string;
    lessonTitle: string;
    chapterTitle: string;
    status: LessonStatus;
  } | null;
  reviewsDue: number;
  activeMission: { id: string; title: string; status: string } | null;
  recentActivity: ActivityEventDto[];
  totalXp: number;
  level: number;
}

export interface NoteDto {
  id: string;
  contentItemId: string | null;
  contentItemTitle: string | null;
  contentArchived: boolean;
  title: string;
  body: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkDto {
  contentItemId: string;
  title: string;
  kind: string;
  archived: boolean;
  createdAt: string;
}

export interface ReviewChoiceOptionDto {
  id: string;
  textMarkdown: string;
}

export interface DueReviewCardDto {
  cardId: string;
  cardVersionId: string;
  lessonId: string;
  lessonTitle: string;
  type: 'recall' | 'transfer' | 'code-reading' | 'debugging';
  promptMarkdown: string;
  /** Revealed only after the owner asks to see it. */
  answerMarkdown: string;
  explanationMarkdown: string;
  gradingOrigin: GradingOrigin;
  options: ReviewChoiceOptionDto[] | null;
  optionMode: 'single' | 'multiple' | null;
  revision: number;
  dueAt: string;
  step: number;
  newlyIntroduced: boolean;
}

export interface DueReviewsDto {
  cards: DueReviewCardDto[];
  totalDue: number;
  remaining: number;
  serverTime: string;
}

export interface ReviewResponseResultDto {
  cardId: string;
  correct: boolean | null;
  /** The rating the server actually applied — an incorrect answer forces again. */
  appliedRating: 'again' | 'hard' | 'good' | 'easy';
  ratingWasForced: boolean;
  answerMarkdown: string;
  explanationMarkdown: string;
  state: { step: number; dueAt: string; revision: number };
}

export interface PlacementItemDto {
  id: string;
  promptMarkdown: string;
  type: 'choice' | 'predict-output' | 'code-reading' | 'function' | 'explanation';
  options: ReviewChoiceOptionDto[] | null;
  optionMode: 'single' | 'multiple' | null;
  critical: boolean;
}

export interface PlacementAssessmentDto {
  chapterId: string;
  chapterTitle: string;
  assessmentId: string;
  assessmentVersionId: string;
  title: string;
  bodyMarkdown: string;
  items: PlacementItemDto[];
  qualification: { minimumCorrect: number; requireAllCritical: boolean };
  /** True once answers have been revealed for this version (spec 3.5). */
  practiceOnly: boolean;
  placedOut: boolean;
}

export interface PlacementResultDto {
  score: number;
  total: number;
  qualified: boolean;
  practiceOnly: boolean;
  placedOut: boolean;
  itemResults: {
    itemId: string;
    correct: boolean;
    critical: boolean;
    explanationMarkdown: string;
  }[];
}

export interface MissionSummaryDto {
  id: string;
  title: string;
  projectId: string;
  workType: 'build' | 'extend' | 'repair' | 'refactor' | 'investigate';
  stack: 'react' | 'node' | 'fullstack' | 'dotnet';
  release: 'v1' | 'v2' | 'v3';
  status: 'not_started' | 'in_progress' | 'completed';
  prerequisitesSatisfied: boolean;
}

export interface MissionChecklistItemDto {
  id: string;
  label: string;
}

export interface MissionDetailDto extends MissionSummaryDto {
  bodyMarkdown: string;
  chapterPrerequisites: { id: string; title: string; satisfied: boolean }[];
  starterAssetId: string;
  starterCommit: string | null;
  starterDownloadUrl: string;
  setupMarkdown: string;
  baselineChecks: string[];
  acceptanceCriteria: string[];
  verificationCommands: string[];
  checklist: MissionChecklistItemDto[];
  reflectionRubric: string[];
  hintsRevealed: number;
  revealedHints: string[];
  solutionRevealed: boolean;
  solutionMarkdown: string | null;
  progress: {
    checklist: Record<string, boolean>;
    status: 'not_started' | 'in_progress' | 'completed';
    repositoryUrl: string | null;
    commitHash: string | null;
    report: {
      testCommand: string;
      reportedOutcome: 'passing' | 'failing' | 'partial';
      notes: string;
    } | null;
    revision: number;
  };
}

export interface DraftDto {
  exerciseId: string;
  source: string;
  revision: number;
  contentVersionId: string;
  updatedAt: string;
}

export interface SettingsDto {
  email: string;
  timezone: string;
  theme: 'system' | 'light' | 'dark';
  preferencesRevision: number;
  activeReleaseId: string | null;
  sessionExpiresAt: string;
}

/* ------------------------------ content ops ------------------------------ */

export interface ValidationIssueDto {
  severity: 'error' | 'warning';
  path: string;
  itemId: string | null;
  message: string;
}

export interface ChangeSummaryItemDto {
  itemId: string;
  kind: string;
  title: string;
  change: 'added' | 'changed' | 'archived' | 'unchanged';
  /** True when the behavioural revision moved, so old evidence no longer covers it. */
  masteryRevisionChanged: boolean;
  fromVersion: number | null;
  toVersion: number | null;
}

export interface ImportDraftDto {
  importId: string;
  packageId: string;
  packageVersion: string;
  title: string;
  checksum: string;
  baseReleaseId: string | null;
  state: 'draft' | 'published' | 'superseded' | 'invalid';
  createdAt: string;
  issues: ValidationIssueDto[];
  changes: ChangeSummaryItemDto[];
  counts: {
    added: number;
    changed: number;
    archived: number;
    unchanged: number;
    masteryRevisionChanged: number;
  };
  publishable: boolean;
}

export interface ReleaseDto {
  id: string;
  packageId: string;
  packageVersion: string;
  title: string;
  state: 'draft' | 'published' | 'superseded' | 'invalid';
  checksum: string;
  createdAt: string;
  publishedAt: string | null;
  isActive: boolean;
  itemCount: number;
}
