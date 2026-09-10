import type { ReactNode } from 'react';
import { ApiRequestError, ApiTransportError } from '../lib/api';
import styles from './StateViews.module.css';

/**
 * Loading / empty / error states. Every route uses these rather than rendering
 * nothing, so the app never shows a blank screen while it decides (spec 4.2).
 */

export function LoadingState({ label = 'Loading' }: { label?: string }): JSX.Element {
  return (
    <div className={styles.state} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className={styles.state}>
      <h2 className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyBody}>{description}</p>
      {action}
    </div>
  );
}

function describeError(error: unknown): { title: string; detail: string; canRetry: boolean } {
  if (error instanceof ApiTransportError) {
    return {
      title: 'Could not reach the server',
      detail: 'Check that the API is running, then try again.',
      canRetry: true,
    };
  }
  if (error instanceof ApiRequestError) {
    if (error.code === 'UNAUTHENTICATED') {
      return {
        title: 'Your session expired',
        detail: 'Sign in again to continue. Anything you typed is still here.',
        canRetry: false,
      };
    }
    if (error.code === 'NOT_FOUND') {
      return {
        title: 'Not available',
        detail:
          'This item is not in the active content release. It may have been archived by a newer release.',
        canRetry: false,
      };
    }
    return { title: 'Something went wrong', detail: error.message, canRetry: true };
  }
  return {
    title: 'Something went wrong',
    detail: 'An unexpected error occurred.',
    canRetry: true,
  };
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): JSX.Element {
  const { title, detail, canRetry } = describeError(error);
  const requestId = error instanceof ApiRequestError ? error.requestId : undefined;
  return (
    <div className={styles.state} role="alert">
      <h2 className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyBody}>{detail}</p>
      {requestId ? <p className={styles.requestId}>Reference: {requestId}</p> : null}
      {canRetry && onRetry ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
