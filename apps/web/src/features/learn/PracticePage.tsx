import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AttemptResult } from '@devpractice/contracts';
import { PracticeSlot } from '../../components/PracticeSlot';
import { SaveIndicator } from '../../components/SaveIndicator';
import { Button, Card, StatusChip } from '../../components/Ui';
import type { SaveIndicatorState } from '../practice/contract';
import styles from './Lesson.module.css';

/** Focused single-exercise route (spec 4.2, /practice/:exerciseId). */
export default function PracticePage(): JSX.Element {
  const { exerciseId = '' } = useParams();
  const navigate = useNavigate();
  const [saveState, setSaveState] = useState<SaveIndicatorState>('idle');
  const [result, setResult] = useState<AttemptResult | null>(null);

  return (
    <div>
      <div className={styles.mobileBar}>
        <Button variant="quiet" onClick={() => navigate(-1)}>
          ← Back
        </Button>
        <SaveIndicator state={saveState} />
      </div>

      <Card>
        <PracticeSlot
          exerciseId={exerciseId}
          layout="focused"
          onAttemptRecorded={setResult}
          onSaveStateChange={setSaveState}
        />
      </Card>

      {result ? (
        <Card>
          <h2 className={styles.sectionTitle}>Last result</h2>
          <div className={styles.chips}>
            <StatusChip
              tone={
                result.outcome === 'passed'
                  ? 'success'
                  : result.outcome === 'failed'
                    ? 'danger'
                    : 'warning'
              }
            >
              {result.outcome === 'passed'
                ? 'Passed'
                : result.outcome === 'failed'
                  ? 'Not yet'
                  : 'Self-assessment needed'}
            </StatusChip>
            <StatusChip tone="neutral" icon="i">
              {result.gradingOrigin === 'server_objective'
                ? 'checked by the server'
                : result.gradingOrigin === 'browser_automated'
                  ? 'checked in your browser'
                  : 'self-reported'}
            </StatusChip>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
