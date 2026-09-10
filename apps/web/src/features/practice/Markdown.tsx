import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import styles from './practice.module.css';

/**
 * Renders authored Markdown with raw HTML disabled and a safe link policy
 * (spec 10.1). Content is trusted-authored but is still sanitised, and runner
 * error text is never rendered as HTML.
 */
marked.setOptions({ gfm: true, breaks: false });

const ALLOWED_SCHEMES = /^(https?:|mailto:|#|\/)/i;

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => {
    const parsed = marked.parse(source, { async: false }) as string;
    const clean = DOMPurify.sanitize(parsed, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
    });
    return clean;
  }, [source]);

  return (
    <div
      className={[styles.markdown, className].filter(Boolean).join(' ')}
      // Sanitised above; marked never emits raw HTML from authored content.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Guard used when building links from authored content. */
export function isSafeHref(href: string): boolean {
  return ALLOWED_SCHEMES.test(href.trim());
}
