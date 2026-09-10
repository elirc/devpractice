import { useMemo } from 'react';
import { renderInlineMarkdown, renderMarkdown } from '../lib/markdown';
import styles from './Markdown.module.css';

/**
 * Renders authored markdown. The HTML is sanitised in lib/markdown before it
 * ever reaches dangerouslySetInnerHTML — raw HTML is disabled and javascript:
 * / data: links are stripped (spec 10.4).
 */
export function Markdown({ source, className }: { source: string; className?: string }): JSX.Element {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return (
    <div
      className={[styles.prose, className].filter(Boolean).join(' ')}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function InlineMarkdown({ source }: { source: string }): JSX.Element {
  const html = useMemo(() => renderInlineMarkdown(source), [source]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
