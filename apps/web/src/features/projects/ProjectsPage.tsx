import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews';
import { Card, PageHeader, StatusChip } from '../../components/Ui';
import { useMissions } from '../../lib/queries';
import styles from './Projects.module.css';

type FilterKey = 'release' | 'stack' | 'project' | 'workType';

const LABEL: Record<FilterKey, string> = {
  release: 'Release',
  stack: 'Stack',
  project: 'Project',
  workType: 'Work type',
};

export default function ProjectsPage(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useMissions();
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    release: 'all',
    stack: 'all',
    project: 'all',
    workType: 'all',
  });

  const options = useMemo(() => {
    const source = data ?? [];
    const unique = (values: string[]): string[] => ['all', ...Array.from(new Set(values)).sort()];
    return {
      release: unique(source.map((m) => m.release)),
      stack: unique(source.map((m) => m.stack)),
      project: unique(source.map((m) => m.projectId)),
      workType: unique(source.map((m) => m.workType)),
    };
  }, [data]);

  const missions = useMemo(() => {
    if (!data) return [];
    return data.filter(
      (mission) =>
        (filters.release === 'all' || mission.release === filters.release) &&
        (filters.stack === 'all' || mission.stack === filters.stack) &&
        (filters.project === 'all' || mission.projectId === filters.project) &&
        (filters.workType === 'all' || mission.workType === filters.workType),
    );
  }, [data, filters]);

  if (isPending) return <LoadingState label="Loading projects" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  if (data.length === 0) {
    return (
      <div>
        <PageHeader title="Projects" />
        <EmptyState
          title="No missions published"
          description="Missions arrive with a content release. Publish one to see project work here."
          action={<Link to="/content">Open content</Link>}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Work you do locally in VS Code against a real repository."
      />

      <div className={styles.filters}>
        {(Object.keys(LABEL) as FilterKey[]).map((key) => (
          <label key={key} className={styles.filterLabel}>
            <span>{LABEL[key]}</span>
            <select
              className={styles.select}
              value={filters[key]}
              onChange={(event) =>
                setFilters((current) => ({ ...current, [key]: event.target.value }))
              }
            >
              {options[key].map((value) => (
                <option key={value} value={value}>
                  {value === 'all' ? 'All' : value}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {missions.length === 0 ? (
        <EmptyState
          title="No missions match these filters"
          description="Change a filter to see the rest of the project work."
        />
      ) : (
        <ul className={styles.list}>
          {missions.map((mission) => (
            <li key={mission.id}>
              <Card className={styles.missionCard}>
                <div className={styles.missionHeader}>
                  <h2 className={styles.missionTitle}>
                    <Link to={`/projects/${mission.id}`}>{mission.title}</Link>
                  </h2>
                  <StatusChip
                    tone={
                      mission.status === 'completed'
                        ? 'success'
                        : mission.status === 'in_progress'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {mission.status.replace('_', ' ')}
                  </StatusChip>
                </div>
                <div className={styles.tags}>
                  <StatusChip tone="neutral">{mission.release}</StatusChip>
                  <StatusChip tone="neutral">{mission.stack}</StatusChip>
                  <StatusChip tone="neutral">{mission.workType}</StatusChip>
                  <StatusChip tone="neutral">{mission.projectId}</StatusChip>
                </div>
                {!mission.prerequisitesSatisfied ? (
                  <p className={styles.note}>
                    Suggested chapters are not finished yet. You can still start this mission.
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
