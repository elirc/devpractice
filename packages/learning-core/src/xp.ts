import { XP, levelForXp } from '@devpractice/contracts';

/**
 * XP rules (spec 3.7). XP is a motivation signal kept deliberately separate
 * from mastery: assisted passes still earn it, and no amount of XP gates a
 * lesson. Every award carries a deterministic unique key so a retry, a second
 * device, or a replayed request can never pay twice.
 */

export { XP, levelForXp };

export type XpReason = 'exercise_first_pass' | 'lesson_first_completion' | 'mission_first_completion';

export interface XpAwardRequest {
  awardKey: string;
  amount: number;
  reason: XpReason;
}

export const xpAwardKeys = {
  /** First accepted pass per exercise per mastery revision. */
  exercisePass(exerciseId: string, masteryRevision: number): string {
    return `exercise:${exerciseId}:r${masteryRevision}`;
  },
  /** First completion of a lesson, once for the lifetime of that lesson id. */
  lessonCompletion(lessonId: string): string {
    return `lesson:${lessonId}`;
  },
  /** First self-reported completion of a mission. */
  missionCompletion(missionId: string): string {
    return `mission:${missionId}`;
  },
};

export function exercisePassAward(exerciseId: string, masteryRevision: number): XpAwardRequest {
  return {
    awardKey: xpAwardKeys.exercisePass(exerciseId, masteryRevision),
    amount: XP.exerciseFirstPass,
    reason: 'exercise_first_pass',
  };
}

export function lessonCompletionAward(lessonId: string): XpAwardRequest {
  return {
    awardKey: xpAwardKeys.lessonCompletion(lessonId),
    amount: XP.lessonFirstCompletion,
    reason: 'lesson_first_completion',
  };
}

export function missionCompletionAward(missionId: string): XpAwardRequest {
  return {
    awardKey: xpAwardKeys.missionCompletion(missionId),
    amount: XP.missionFirstCompletion,
    reason: 'mission_first_completion',
  };
}

/**
 * Actions that deliberately award nothing (spec 3.7): opening a page, retrying,
 * importing content, repeated review clicks, manually skipping a lesson, and
 * placing out of a chapter.
 */
export const NON_AWARDING_ACTIONS = [
  'page_view',
  'attempt_retry',
  'content_import',
  'review_response',
  'lesson_skip',
  'placement_attempt',
] as const;
