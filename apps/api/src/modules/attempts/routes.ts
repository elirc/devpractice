import type { FastifyInstance } from 'fastify';
import {
  attemptBodySchema,
  type AttemptResult,
  type ExerciseItem,
  type GradingOrigin,
} from '@devpractice/contracts';
import {
  assistanceForAttempt,
  exercisePassAward,
  gradeChoice,
  gradePredictOutput,
  verifyFunctionReport,
  type ChoiceGrading,
  type FunctionGrading,
  type PredictOutputGrading,
} from '@devpractice/learning-core';
import { Prisma, type AttemptOutcome as PrismaOutcome } from '@prisma/client';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { findReceipt, storeReceipt } from '../../lib/idempotency.js';
import { db, grantXp, parseBody, recordActivity, TX_OPTIONS } from '../curriculum/shared.js';
import { loadPublishedVersion } from '../curriculum/release.js';

const ATTEMPT_OPERATION = 'attempt.submit';

/** The grading origin an exercise REQUIRES; the client does not get to pick. */
function requiredOrigin(exercise: ExerciseItem): GradingOrigin {
  switch (exercise.grading.kind) {
    case 'choice':
    case 'predict-output':
      return 'server_objective';
    case 'function-cases':
      return 'browser_automated';
    case 'rubric':
      return 'self_reported';
  }
}

interface GradeOutput {
  outcome: PrismaOutcome;
  feedback: AttemptResult['feedback'] & Record<string, unknown>;
}

export function registerAttemptsRoutes(app: FastifyInstance): void {
  /**
   * Submit an attempt (spec 9.3).
   *
   * The server derives userId, assistance, accepted case ids, XP and
   * timestamps. Client-supplied ownership, XP or mastery claims are ignored.
   * Learner source is stored as a snapshot and NEVER executed here.
   */
  app.post('/attempts', async (request, reply) => {
    const owner = requireOwner(request);
    const body = parseBody(attemptBodySchema, request);

    const version = await loadPublishedVersion<ExerciseItem>(
      db(),
      body.exerciseVersionId,
      owner.activeReleaseId,
    );
    if (version.kind !== 'exercise') throw problem.notFound();
    // The version must genuinely belong to the exercise the client named.
    if (version.itemId !== body.exerciseId) {
      throw problem.badRequest('exerciseVersionId does not belong to that exercise.');
    }

    const exercise = version.payload;
    const origin = requiredOrigin(exercise);
    if (body.gradingOrigin !== origin) {
      throw problem.badRequest(
        `This exercise is graded as ${origin}; the submitted gradingOrigin does not match.`,
      );
    }

    const reveals = await db().revealEvent.findMany({
      where: { userId: owner.userId, itemId: body.exerciseId, masteryRevision: version.masteryRevision },
      select: { itemId: true, masteryRevision: true, revealKind: true, hintIndex: true, createdAt: true },
    });
    const assistance = assistanceForAttempt(
      reveals.map((r) => ({
        itemId: r.itemId,
        masteryRevision: r.masteryRevision,
        revealKind: r.revealKind,
        hintIndex: r.hintIndex,
        createdAt: r.createdAt,
      })),
      body.exerciseId,
      version.masteryRevision,
    );

    const graded = grade(exercise, body);

    const result = await db().$transaction(async (tx) => {
      const replay = await findReceipt<AttemptResult>(
        tx,
        owner.userId,
        body.clientEventId,
        ATTEMPT_OPERATION,
        body,
      );
      if (replay.replayed && replay.response) return replay.response;

      const attempt = await tx.attempt.create({
        data: {
          userId: owner.userId,
          clientEventId: body.clientEventId,
          exerciseVersionId: version.versionId,
          exerciseId: body.exerciseId,
          masteryRevision: version.masteryRevision,
          sourceSnapshot: body.source ?? null,
          // Prisma distinguishes a JSON null from an absent value.
          answer:
            body.answer === undefined || body.answer === null
              ? Prisma.DbNull
              : (body.answer as Prisma.InputJsonValue),
          outcome: graded.outcome,
          gradingOrigin: origin,
          assistance,
          result: graded.feedback as object,
        },
      });

      // XP is motivation, not mastery: assisted passes earn it too, once.
      let xpAwarded = 0;
      if (graded.outcome === 'passed') {
        xpAwarded = await grantXp(
          tx,
          owner.userId,
          exercisePassAward(body.exerciseId, version.masteryRevision),
        );
      }

      // Opening a lesson does not start it; making an attempt does.
      await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId: owner.userId, lessonId: exercise.lessonId } },
        create: {
          userId: owner.userId,
          lessonId: exercise.lessonId,
          status: 'in_progress',
          startedAt: new Date(),
        },
        update: {},
      });

      await recordActivity(tx, owner.userId, 'attempt.submitted', body.exerciseId, attempt.id, {
        outcome: graded.outcome,
        gradingOrigin: origin,
        assistance,
      });

      const response: AttemptResult = {
        attemptId: attempt.id,
        outcome: graded.outcome,
        assistance,
        gradingOrigin: origin,
        feedback: graded.feedback,
        xpAwarded,
        createdAt: attempt.createdAt.toISOString(),
      };
      await storeReceipt(tx, owner.userId, body.clientEventId, ATTEMPT_OPERATION, body, response);
      return response;
    }, TX_OPTIONS);

    return ok(reply, result, {
      contentUpdated: !version.isInActiveRelease,
      ...(version.isInActiveRelease
        ? {}
        : {
            notice:
              'This attempt was graded against the version you loaded. Newer content is now published.',
          }),
    });
  });
}

function grade(exercise: ExerciseItem, body: ReturnType<typeof attemptBodySchema.parse>): GradeOutput {
  switch (exercise.grading.kind) {
    case 'choice': {
      const selected = Array.isArray(body.answer)
        ? (body.answer as unknown[]).filter((v): v is string => typeof v === 'string')
        : null;
      if (!selected) throw problem.badRequest('answer must be an array of option ids.');
      const result = gradeChoice(exercise.grading as unknown as ChoiceGrading, selected);
      return {
        outcome: result.correct ? 'passed' : 'failed',
        feedback: {
          correct: result.correct,
          selectedOptionIds: result.selectedOptionIds,
          correctOptionIds: result.correctOptionIds,
          optionExplanations: result.optionExplanations,
          invalidOptionIds: result.invalidOptionIds,
        },
      };
    }
    case 'predict-output': {
      if (typeof body.answer !== 'string') {
        throw problem.badRequest('answer must be the predicted output text.');
      }
      const result = gradePredictOutput(
        exercise.grading as unknown as PredictOutputGrading,
        body.answer,
      );
      return {
        outcome: result.correct ? 'passed' : 'failed',
        feedback: {
          correct: result.correct,
          expectedNormalized: result.expectedNormalized,
          submittedNormalized: result.submittedNormalized,
          explanationMarkdown: exercise.solution.explanationMarkdown,
        },
      };
    }
    case 'function-cases': {
      if (!body.runnerResult) {
        throw problem.badRequest('runnerResult is required for a browser-run function exercise.');
      }
      const verification = verifyFunctionReport(
        exercise.grading as unknown as FunctionGrading,
        body.runnerResult,
      );
      return {
        outcome: verification.accepted ? 'passed' : 'failed',
        feedback: {
          correct: verification.accepted,
          caseResults: verification.caseResults,
          // Surfaced so a rejected claim is explainable rather than mysterious.
          rejectionReasons: verification.rejectionReasons,
          reportedStatus: body.runnerResult.status,
        },
      };
    }
    case 'rubric': {
      if (!body.selfAssessment) {
        return {
          outcome: 'needs_self_assessment',
          feedback: {
            criteria: exercise.grading.criteria,
            modelAnswerMarkdown: exercise.grading.modelAnswerMarkdown,
            note: 'Compare your response with the criteria and record your own assessment.',
          },
        };
      }
      return {
        outcome: body.selfAssessment === 'not-met' ? 'failed' : 'passed',
        feedback: {
          selfAssessment: body.selfAssessment,
          criteria: exercise.grading.criteria,
          modelAnswerMarkdown: exercise.grading.modelAnswerMarkdown,
          // Never presented as an objective result.
          note: 'Recorded as your own assessment, not an automated grade.',
        },
      };
    }
  }
}
