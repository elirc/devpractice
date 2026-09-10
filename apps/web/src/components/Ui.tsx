import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Ui.module.css';

/* Small shared primitives. Deliberately plain: this is a workspace, not a game. */

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

export function Button({
  variant = 'secondary',
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }): JSX.Element {
  return (
    <button
      type="button"
      className={[styles.button, styles[variant], className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}

export type StatusTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info';

const TONE_ICON: Record<StatusTone, string> = {
  neutral: '•',
  success: '✓',
  danger: '✕',
  warning: '!',
  info: 'i',
};

/**
 * A state label. Correctness is NEVER conveyed by colour alone (spec 4.1):
 * every chip carries a text label and a shape/glyph as well as its tone.
 */
export function StatusChip({
  tone = 'neutral',
  children,
  icon,
}: {
  tone?: StatusTone;
  children: ReactNode;
  icon?: string;
}): JSX.Element {
  return (
    <span className={[styles.chip, styles[`tone-${tone}`]].join(' ')}>
      <span className={styles.chipIcon} aria-hidden="true">
        {icon ?? TONE_ICON[tone]}
      </span>
      <span>{children}</span>
    </span>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: StatusTone;
  title?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={[styles.callout, styles[`callout-${tone}`]].join(' ')}>
      {title ? <strong className={styles.calloutTitle}>{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: ReactNode;
}): JSX.Element {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <section className={[styles.card, className].filter(Boolean).join(' ')}>{children}</section>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1>{title}</h1>
        {description ? <p className={styles.pageDescription}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </header>
  );
}
