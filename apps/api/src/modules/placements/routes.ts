import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  placementSubmitSchema,
  type AssessmentItem,
  type ChapterItem,
  type Grading,
} from '@devpractice/contracts';
import {
  gradeChoice,
  gradePlacement,
  gradePredictOutput,
  isPracticeOnly,
  verifyFunctionReport,
  type ChoiceGrading,
  type FunctionGrading,
  type PlacementItemOutcome,
  type PredictOutputGrading,
} from '@devpractice/learning-core';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { findReceipt, storeReceipt } from '../../lib/idempotency.js';
import { db, parseBody, parseParams, recordActivity, serverNow, TX_OPTIONS } from '../curriculum/shared.js';
import { loadItem, requireActiveReleaseId } from '../curriculum/release.js';
import { projectAssessment } from '../exercises/projection.js';

const chapterParamSchema = z.object({ chapterId: z.string().min(1).max(80) });

type SubmittedAnswer = {
  selectedOptionIds?: string[];
  text?: string;
  runnerResult?: {
    status: string;
    passedCaseIds: string[];
    failedCaseIds: string[];
    durationMs: number;
    message?: string;
  };
};

function gradeAssessmentItem(grading: Grading, answer: SubmittedAnswer | undefined): boolean {
  if (!answer) return false;
  switch (grading.kind) {
    case 'choice':
      return gradeChoice(grading as unknown as ChoiceGrading, answer.selectedOptionIds ?? []).correct;
    case 'predict-output':
      return gradePredictOutput(grading as unknown as PredictOutputGrading, answer.text ?? '').correct;
    case 'function-cases':
      return answer.runnerResult
        ? verifyFunctionReport(grading as unknown as FunctionGrading, {
            status: answer.runnerResult.status as 'passed',
            passedCaseIds: answer.runnerResult.passedCaseIds,
            failedCaseIds: answer.runnerResult.failedCaseIds,
            durationMs: answer.runnerResult.durationMs,
          }).accepted
        : false;
    case 'rubric':
      // A self-assessed answer cannot establish placement evidence.
      return false;
  }
}

export function registerPlacementsRoutes(app: FastifyInstance): void {
  /**
   * Placement prompts. No hints, no solutions and no answers appear until the
   * assessment is submitted (spec 3.5).
   */
  app.get('/placements/:chapterId', async (request, reply) => {
    const owner = requireOwner(request);
    const { chapterId } = parseParams(chapterParamSchema, request);
    const releaseId = await requireActiveReleaseId(db(), owner);

    const chapter = await loadItem<ChapterItem>(db(), releaseId, chapterId, 'chapter');
    const assessment = await loadItem<AssessmentItem>(
      db(),
      releaseId,
      chapter.payload.assessmentId,
      'assessment',
    );

    const previous = await db().placementAttempt.count({
      where: { userId: owner.userId, assessmentVersionId: assessment.versionId },
    });
    const placement = await db().chapterPlacement.findUnique({
      where: { userId_chapterId: { userId: owner.userId, chapterId } },
    });

    return ok(reply, {
      ...projectAssessment(assessment.payload),
      assessmentVersionId: assessment.versionId,
      practiceOnly: isPracticeOnly(previous),
      previousAttempts: previous,
      placedOut: placement?.placedOut ?? false,
      notice: isPracticeOnly(previous)
        ? 'You have already seen the answers for this version. A repeat is practice only; fresh placement evidence needs an alternate version.'
        : null,
    });
  });

  app.post('/placements/:chapterId', async (request, reply) => {
    const owner = requireOwner(request);
    const { chapterId } = parseParams(chapterParamSchema, request);
    const body = parseBody(placementSubmitSchema, request);
    const releaseId = await requireActiveReleaseId(db(), owner);

    const chapter = await loadItem<ChapterItem>(db(), releaseId, chapterId, 'chapter');
    const assessment = await loadItem<AssessmentItem>(
      db(),
      releaseId,
      chapter.payload.assessmentId,
      'assessment',
    );
    if (assessment.versionId !== body.assessmentVersionId) {
      throw problem.releaseConflict('This assessment has been updated. Reload before submitting.', {
        currentAssessmentVersionId: assessment.versionId,
      });
    }

    const answers = body.answers as Record<string, SubmittedAnswer>;
    const outcomes: PlacementItemOutcome[] = assessment.payload.items.map((item) => ({
      itemId: item.id,
      critical: item.critical,
      correct: gradeAssessmentItem(item.grading, answers[item.id]),
    }));
    const graded = gradePlacement(outcomes, assessment.payload.qualification);

    const result = await db().$transaction(async (tx) => {
      const replay = await findReceipt<Record<string, unknown>>(
        tx,
        owner.userId,
        body.clientEventId,
        'placement.submit',
        { chapterId, ...body },
      );
      if (replay.replayed && replay.response) return replay.response;

      const previous = await tx.placementAttempt.count({
        where: { userId: owner.userId, assessmentVersionId: assessment.versionId },
      });
      const practiceOnly = isPracticeOnly(previous);

      const attempt = await tx.placementAttempt.create({
        data: {
          userId: owner.userId,
          chapterId,
          assessmentVersionId: assessment.versionId,
          clientEventId: body.clientEventId,
          submittedAnswers: body.answers as object,
          score: graded.score,
          qualified: graded.qualified,
          practiceOnly,
        },
      });

      // A practice repeat cannot create fresh placement evidence, and placing
      // out is never revoked by a later practice attempt.
      if (graded.qualified && !practiceOnly) {
        await tx.chapterPlacement.upsert({
          where: { userId_chapterId: { userId: owner.userId, chapterId } },
          create: {
            userId: owner.userId,
            chapterId,
            placedOut: true,
            qualifiedAt: serverNow(),
          },
          update: { placedOut: true, qualifiedAt: serverNow() },
        });
      }

      await recordActivity(tx, owner.userId, 'placement.submitted', chapterId, attempt.id, {
        score: graded.score,
        qualified: graded.qualified,
        practiceOnly,
      });

      const payload = {
        attemptId: attempt.id,
        chapterId,
        score: graded.score,
        total: graded.total,
        qualified: graded.qualified,
        practiceOnly,
        placedOut: graded.qualified && !practiceOnly,
        failedCriticalItemIds: graded.failedCriticalItemIds,
        // Answers and explanations are released only now, after submission.
        itemResults: assessment.payload.items.map((item) => ({
          itemId: item.id,
          critical: item.critical,
          correct: outcomes.find((o) => o.itemId === item.id)?.correct ?? false,
          explanationMarkdown: item.explanationMarkdown,
        })),
        // XP is never granted for placement (spec 3.7).
        xpAwarded: 0,
        notice:
          'Placing out records placement evidence. It does not claim you completed every exercise or retained the material.',
      };
      await storeReceipt(
        tx,
        owner.userId,
        body.clientEventId,
        'placement.submit',
        { chapterId, ...body },
        payload,
      );
      return payload as unknown as Record<string, unknown>;
    }, TX_OPTIONS);

    return ok(reply, result);
  });
}
