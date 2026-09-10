import DOMPurify from 'dompurify';
import { Marked } from 'marked';

/**
 * Markdown rendering with raw HTML disabled and a safe link policy
 * (spec 10.1, 10.4). Authored content is trusted-ish, but it arrives over the
 * wire and is rendered into an authenticated page, so it is sanitised anyway.
 */

const marked = new Marked({
  gfm: true,
  breaks: false,
  // Raw HTML in source is escaped rather than parsed, so a content package can
  // never inject markup; DOMPurify is the second line of defence.
  async: false,
});

const ALLOWED_PROTOCOLS = /^(https?:|mailto:|#|\/)/i;

let hookInstalled = false;

function installHooks(): void {
  if (hookInstalled) return;
  hookInstalled = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href');
      if (href && !ALLOWED_PROTOCOLS.test(href.trim())) {
        // javascript: and data: links are removed, not merely blocked on click.
        node.removeAttribute('href');
        node.setAttribute('data-unsafe-link', 'true');
      }
      if (node.getAttribute('href')?.startsWith('http')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });
}

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'span',
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'data-unsafe-link'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'img'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
};

/** Render trusted-authored markdown to sanitised HTML. */
export function renderMarkdown(source: string): string {
  installHooks();
  const html = marked.parse(source ?? '') as string;
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

/** Render a short inline fragment (option text, list labels) without block wrapping. */
export function renderInlineMarkdown(source: string): string {
  installHooks();
  const html = marked.parseInline(source ?? '') as string;
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
