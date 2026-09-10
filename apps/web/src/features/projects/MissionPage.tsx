import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { Markdown } from '../../components/Markdown';
import { SaveIndicator } from '../../components/SaveIndicator';
import { Button, Callout, Card, Field, PageHeader, StatusChip } from '../../components/Ui';
import { ApiRequestError, apiSend } from '../../lib/api';
import { useMission, useRevealMissionHint } from '../../lib/queries';
import { useAutosave, type ConflictInfo } from '../../lib/useAutosave';
import { useMarkUnsaved } from '../../lib/unsaved';
import type { MissionDetailDto } from '../../lib/types';
import styles from './Projects.module.css';

interface MissionForm {
  checklist: Record<string, boolean>;
  status: 'not_started' | 'in_progress' | 'completed';
  repositoryUrl: string;
  commitHash: string;
  testCommand: string;
  reportedOutcome: 'passing' | 'failing' | 'partial';
  notes: string;
}

function toForm(mission: MissionDetailDto): MissionForm {
  return {
    checklist: mission.progress.checklist,
    status: mission.progress.status,
    repositoryUrl: mission.progress.repositoryUrl ?? '',
    commitHash: mission.progress.commitHash ?? '',
    testCommand: mission.progress.report?.testCommand ?? '',
    reportedOutcome: mission.progress.report?.reportedOutcome ?? 'partial',
    notes: mission.progress.report?.notes ?? '',
  };
}

export default function MissionPage(): JSX.Element {
  const { missionId = '' } = useParams();
  const { data, isPending, isError, error, refetch } = useMission(missionId);
  const reveal = useRevealMissionHint(missionId);
  const [saveError, setSaveError] = useState<string | null>(null);
  const repoId = useId();
  const commitId = useId();
  const commandId = useId();
  const notesId = useId();

  const save = useCallback(
    async (form: MissionForm, expectedRevision: number): Promise<{ revision: number }> => {
      const updated = await apiSend<MissionDetailDto['progress']>(
        'PUT',
        `/missions/${encodeURIComponent(missionId)}/progress`,
        {
          expectedRevision,
          checklist: form.checklist,
          status: form.status,
          repositoryUrl: form.repositoryUrl.trim() === '' ? null : form.repositoryUrl.trim(),
          commitHash: form.commitHash.trim() === '' ? null : form.commitHash.trim(),
          report: {
            testCommand: form.testCommand,
            reportedOutcome: form.reportedOutcome,
            notes: form.notes,
          },
        },
      );
      return { revision: updated.revision };
    },
    [missionId],
  );

  const parseConflict = useCallback(
    (err: ApiRequestError): ConflictInfo<MissionForm> | null => {
      const server = err.detail?.['server'] as MissionDetailDto['progress'] | undefined;
      const serverRevision = err.detail?.['serverRevision'];
      if (!server || typeof serverRevision !== 'number') return null;
      return {
        serverValue: {
          checklist: server.checklist,
          status: server.status,
          repositoryUrl: server.repositoryUrl ?? '',
          commitHash: server.commitHash ?? '',
          testCommand: server.report?.testCommand ?? '',
          reportedOutcome: server.report?.reportedOutcome ?? 'partial',
          notes: server.report?.notes ?? '',
        },
        serverRevision,
        serverUpdatedAt: (err.detail?.['serverUpdatedAt'] as string | undefined) ?? null,
      };
    },
    [],
  );

  const autosave = useAutosave<MissionForm>({
    save,
    initialValue: {
      checklist: {},
      status: 'not_started',
      repositoryUrl: '',
      commitHash: '',
      testCommand: '',
      reportedOutcome: 'partial',
      notes: '',
    },
    initialRevision: 0,
    parseConflict,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  const { resetTo } = autosave;
  useEffect(() => {
    if (data) resetTo(toForm(data), data.progress.revision);
  }, [data?.id, data?.progress.revision, resetTo, data]);

  useMarkUnsaved(`mission:${missionId}`, autosave.isDirty, 'Your mission report');

  if (isPending) return <LoadingState label="Loading mission" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const form = autosave.value;
  const nextHintIndex = data.hintsRevealed;

  async function revealNext(kind: 'hint' | 'solution'): Promise<void> {
    setSaveError(null);
    try {
      await reveal.mutateAsync(
        kind === 'hint' ? { revealKind: 'hint', hintIndex: nextHintIndex } : { revealKind: 'solution' },
      );
      await refetch();
    } catch (caught) {
      setSaveError(
        caught instanceof ApiRequestError ? caught.message : 'That could not be revealed.',
      );
    }
  }

  return (
    <div>
      <p className={styles.breadcrumb}>
        <Link to="/projects">Projects</Link>
      </p>
      <PageHeader
        title={data.title}
        actions={<SaveIndicator state={autosave.state} />}
      />

      <div className={styles.tags}>
        <StatusChip tone="neutral">{data.release}</StatusChip>
        <StatusChip tone="neutral">{data.stack}</StatusChip>
        <StatusChip tone="neutral">{data.workType}</StatusChip>
        <StatusChip
          tone={
            data.progress.status === 'completed'
              ? 'success'
              : data.progress.status === 'in_progress'
                ? 'warning'
                : 'neutral'
          }
        >
          {data.progress.status.replace('_', ' ')}
        </StatusChip>
      </div>

      {data.chapterPrerequisites.some((p) => !p.satisfied) ? (
        <Callout tone="info" title="Suggested background">
          This mission assumes{' '}
          {data.chapterPrerequisites
            .filter((p) => !p.satisfied)
            .map((p) => p.title)
            .join(', ')}
          . You can still start it now.
        </Callout>
      ) : null}

      <Card>
        <Markdown source={data.bodyMarkdown} />
      </Card>

      <Card>
        <h2>Get the starter</h2>
        <p>
          The starter is pinned to a specific version so the instructions always match the files you
          have.
        </p>
        <ul className={styles.metaList}>
          <li>
            Starter asset: <code>{data.starterAssetId}</code>
          </li>
          {data.starterCommit ? (
            <li>
              Pinned commit: <code>{data.starterCommit}</code>
            </li>
          ) : null}
        </ul>
        <a href={data.starterDownloadUrl} download>
          <Button variant="primary">Download starter</Button>
        </a>
        <h3 className={styles.subhead}>Setup</h3>
        <Markdown source={data.setupMarkdown} />
        <h3 className={styles.subhead}>Baseline checks</h3>
        <p className={styles.muted}>
          These prove the starter runs before you change anything. If they fail, the development
          setup is broken — not the assignment.
        </p>
        <ul className={styles.commands}>
          {data.baselineChecks.map((check) => (
            <li key={check}>
              <code>{check}</code>
            </li>
          ))}
        </ul>
        <h3 className={styles.subhead}>Mission checks</h3>
        <p className={styles.muted}>
          These are expected to FAIL until you implement the work.
        </p>
        <ul className={styles.commands}>
          {data.verificationCommands.map((command) => (
            <li key={command}>
              <code>{command}</code>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2>Acceptance criteria</h2>
        <ul className={styles.criteria}>
          {data.acceptanceCriteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2>Hints</h2>
        {data.revealedHints.length === 0 ? (
          <p className={styles.muted}>No hints revealed yet.</p>
        ) : (
          <ol className={styles.criteria}>
            {data.revealedHints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ol>
        )}
        <div className={styles.actions}>
          {nextHintIndex < 3 ? (
            <Button onClick={() => void revealNext('hint')} disabled={reveal.isPending}>
              Reveal hint {nextHintIndex + 1} of 3
            </Button>
          ) : null}
          {!data.solutionRevealed ? (
            <Button onClick={() => void revealNext('solution')} disabled={reveal.isPending}>
              Reveal reference solution
            </Button>
          ) : null}
        </div>
        {data.solutionRevealed && data.solutionMarkdown ? (
          <div className={styles.solution}>
            <h3 className={styles.subhead}>Reference solution</h3>
            <Markdown source={data.solutionMarkdown} />
          </div>
        ) : null}
      </Card>

      <Card>
        <h2>Your report</h2>
        <Callout tone="warning" title="Self-reported">
          Everything below is your own record of what happened on your machine. The application does
          not clone your repository, does not run your code, and does not verify these results.
        </Callout>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Checklist</legend>
          {data.checklist.map((item) => (
            <label key={item.id} className={styles.check}>
              <input
                type="checkbox"
                checked={form.checklist[item.id] ?? false}
                onChange={(event) =>
                  autosave.setValue({
                    ...form,
                    checklist: { ...form.checklist, [item.id]: event.target.checked },
                    status:
                      form.status === 'not_started' && event.target.checked
                        ? 'in_progress'
                        : form.status,
                  })
                }
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>

        <Field
          label="Repository URL (optional)"
          htmlFor={repoId}
          hint="Stored as a link only. It is never fetched or cloned by this application."
        >
          <input
            id={repoId}
            className={styles.input}
            type="url"
            inputMode="url"
            value={form.repositoryUrl}
            onChange={(event) => autosave.setValue({ ...form, repositoryUrl: event.target.value })}
          />
        </Field>

        <Field label="Commit hash (optional)" htmlFor={commitId}>
          <input
            id={commitId}
            className={styles.input}
            value={form.commitHash}
            onChange={(event) => autosave.setValue({ ...form, commitHash: event.target.value })}
          />
        </Field>

        <Field label="Test command you ran" htmlFor={commandId}>
          <input
            id={commandId}
            className={styles.input}
            value={form.testCommand}
            onChange={(event) => autosave.setValue({ ...form, testCommand: event.target.value })}
          />
        </Field>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Reported outcome</legend>
          {(['passing', 'partial', 'failing'] as const).map((value) => (
            <label key={value} className={styles.check}>
              <input
                type="radio"
                name="reported-outcome"
                checked={form.reportedOutcome === value}
                onChange={() => autosave.setValue({ ...form, reportedOutcome: value })}
              />
              <span>{value}</span>
            </label>
          ))}
        </fieldset>

        <Field label="Reflection and notes" htmlFor={notesId}>
          <textarea
            id={notesId}
            className={styles.textarea}
            rows={6}
            value={form.notes}
            onChange={(event) => autosave.setValue({ ...form, notes: event.target.value })}
          />
        </Field>

        <h3 className={styles.subhead}>Reflection prompts</h3>
        <ul className={styles.criteria}>
          {data.reflectionRubric.map((prompt) => (
            <li key={prompt}>{prompt}</li>
          ))}
        </ul>

        {autosave.errorMessage ? (
          <p className={styles.error} role="alert">
            {autosave.errorMessage}
          </p>
        ) : null}
        {saveError ? (
          <p className={styles.error} role="alert">
            {saveError}
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={form.status === 'completed'}
            onClick={() => {
              autosave.setValue({ ...form, status: 'completed' });
              void autosave.flush();
            }}
          >
            {form.status === 'completed' ? 'Reported complete' : 'Report mission complete'}
          </Button>
          <Button onClick={() => void autosave.flush()}>Save now</Button>
        </div>
      </Card>
    </div>
  );
}
