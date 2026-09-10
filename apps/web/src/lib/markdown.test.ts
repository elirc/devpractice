import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown, renderMarkdown } from './markdown';

/** Spec 10.1/10.4: raw HTML disabled, javascript:/data: links rejected. */
describe('markdown rendering', () => {
  it('renders ordinary markdown', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** text.');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('does not execute raw HTML in authored content', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('alert(1)</script>');
  });

  it('strips javascript: links', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');
    // The scheme must be gone and the anchor must not be navigable. marked
    // drops the unsafe href itself, so no href survives to reach the sanitiser
    // hook; either path is acceptable as long as nothing is clickable.
    expect(html).not.toContain('javascript:');
    expect(html).not.toMatch(/<a[^>]*\shref=/i);
    expect(html).toContain('click me');
  });

  it('strips data: links', () => {
    const html = renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD4=)');
    expect(html).not.toContain('data:text/html');
  });

  it('keeps http(s) links and marks them safe for a new tab', () => {
    const html = renderMarkdown('[docs](https://developer.mozilla.org/)');
    expect(html).toContain('href="https://developer.mozilla.org/"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('allows relative in-app links', () => {
    const html = renderMarkdown('[chapter](/learn/chapters/c1)');
    expect(html).toContain('href="/learn/chapters/c1"');
    expect(html).not.toContain('data-unsafe-link');
  });

  it('removes event handler attributes', () => {
    const html = renderMarkdown('<a href="https://x.test" onclick="steal()">x</a>');
    expect(html).not.toContain('onclick');
  });

  it('renders inline markdown without block wrapping', () => {
    expect(renderInlineMarkdown('`code` and **bold**')).toContain('<code>code</code>');
    expect(renderInlineMarkdown('plain')).not.toContain('<p>');
  });
});
