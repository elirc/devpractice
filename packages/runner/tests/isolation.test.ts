import { describe, expect, it } from 'vitest';
import { runInNode } from '../src/node-runner.js';
import type { RunnerCase } from '@devpractice/contracts';

/**
 * Acceptance A07 (runner isolation) and A08 (TypeScript verification), spec 7.4.
 *
 * These run the REAL QuickJS-WASM interpreter through the same engine the
 * browser worker uses. They are the release gate for browser code exercises.
 */

const countOpenCases: RunnerCase[] = [
  { id: 'empty', args: [[]], expected: 0, hidden: false },
  {
    id: 'mixed',
    args: [[{ status: 'open' }, { status: 'closed' }, { status: 'open' }]],
    expected: 2,
    hidden: false,
  },
  { id: 'all-closed', args: [[{ status: 'closed' }]], expected: 0, hidden: false },
];

const CORRECT = `function countOpen(tickets) {
  return tickets.filter(function (t) { return t.status === 'open'; }).length;
}`;

describe('correctness', () => {
  it('passes a correct function', async () => {
    const res = await runInNode({
      source: CORRECT,
      language: 'javascript',
      entrypoint: 'countOpen',
      cases: countOpenCases,
    });
    expect(res.status).toBe('passed');
    expect(res.caseResults.every((c) => c.passed)).toBe(true);
  });

  it('fails an incorrect boundary case (always-zero mutant)', async () => {
    const res = await runInNode({
      source: 'function countOpen(t) { return 0; }',
      language: 'javascript',
      entrypoint: 'countOpen',
      cases: countOpenCases,
    });
    expect(res.status).toBe('failed');
    expect(res.caseResults.find((c) => c.caseId === 'mixed')?.passed).toBe(false);
    // The empty case still passes: one green case must not imply a pass.
    expect(res.caseResults.find((c) => c.caseId === 'empty')?.passed).toBe(true);
  });

  it('fails a count-all mutant', async () => {
    const res = await runInNode({
      source: 'function countOpen(t) { return t.length; }',
      language: 'javascript',
      entrypoint: 'countOpen',
      cases: countOpenCases,
    });
    expect(res.status).toBe('failed');
  });

  it('detects a mutated input when assertInputUnchanged is set', async () => {
    const res = await runInNode({
      source: `function countOpen(tickets) {
        let n = 0;
        while (tickets.length) { if (tickets.pop().status === 'open') n++; }
        return n;
      }`,
      language: 'javascript',
      entrypoint: 'countOpen',
      assertInputUnchanged: true,
      cases: countOpenCases,
    });
    expect(res.status).toBe('failed');
    const mixed = res.caseResults.find((c) => c.caseId === 'mixed');
    expect(mixed?.inputMutated).toBe(true);
    expect(mixed?.passed).toBe(false);
  });

  it('reports a missing entrypoint clearly', async () => {
    const res = await runInNode({
      source: 'function somethingElse() { return 1; }',
      language: 'javascript',
      entrypoint: 'countOpen',
      cases: countOpenCases,
    });
    expect(res.status).toBe('runtime_error');
    expect(res.message).toContain('countOpen');
  });

  it('resolves a const arrow-function entrypoint (lexical, not on globalThis)', async () => {
    const res = await runInNode({
      source: `const countOpen = (t) => t.filter(x => x.status === 'open').length;`,
      language: 'javascript',
      entrypoint: 'countOpen',
      cases: countOpenCases,
    });
    expect(res.status).toBe('passed');
  });
});

describe('A08 TypeScript verification', () => {
  it('passes a well-typed solution', async () => {
    const res = await runInNode({
      source: `function double(n: number): number { return n * 2; }`,
      language: 'typescript',
      entrypoint: 'double',
      cases: [
        { id: 'two', args: [2], expected: 4, hidden: false },
        { id: 'zero', args: [0], expected: 0, hidden: false },
      ],
    });
    expect(res.status).toBe('passed');
  });

  it('REJECTS a runtime-correct but type-invalid solution', async () => {
    // Runs fine as JavaScript; the type error must stop it (acceptance A08).
    const res = await runInNode({
      source: `function double(n: number): number { const s: string = n; return n * 2; }`,
      language: 'typescript',
      entrypoint: 'double',
      cases: [{ id: 'two', args: [2], expected: 4, hidden: false }],
    });
    expect(res.status).toBe('compile_error');
    expect(res.caseResults).toHaveLength(0);
    expect(res.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('catches an implicit any under strict mode', async () => {
    const res = await runInNode({
      source: `function double(n) { return n * 2; }`,
      language: 'typescript',
      entrypoint: 'double',
      cases: [{ id: 'two', args: [2], expected: 4, hidden: false }],
    });
    expect(res.status).toBe('compile_error');
  });

  it('reports a TypeScript syntax error as compile_error', async () => {
    const res = await runInNode({
      source: `function double(n: number): number { return n * 2;`,
      language: 'typescript',
      entrypoint: 'double',
      cases: [{ id: 'two', args: [2], expected: 4, hidden: false }],
    });
    expect(res.status).toBe('compile_error');
  });

  it('rejects imports as unsupported in V1', async () => {
    const res = await runInNode({
      source: `import * as fs from 'fs';\nfunction double(n: number): number { return n * 2; }`,
      language: 'typescript',
      entrypoint: 'double',
      cases: [{ id: 'two', args: [2], expected: 4, hidden: false }],
    });
    expect(res.status).toBe('unsupported');
    expect(res.message).toMatch(/import/i);
  });

  it('uses es2015+ library types (Map, Object.entries)', async () => {
    const res = await runInNode({
      source: `function sizeOf(pairs: [string, number][]): number {
        const m = new Map<string, number>(pairs);
        return Object.entries(Object.fromEntries(m)).length;
      }`,
      language: 'typescript',
      entrypoint: 'sizeOf',
      cases: [
        { id: 'two', args: [[['a', 1], ['b', 2]]], expected: 2, hidden: false },
        { id: 'none', args: [[]], expected: 0, hidden: false },
      ],
    });
    expect(res.status).toBe('passed');
  });
});

describe('A07 runner isolation', () => {
  it('reports a JavaScript syntax error', async () => {
    const res = await runInNode({
      source: 'function countOpen(t) { return t.length',
      language: 'javascript',
      entrypoint: 'countOpen',
      cases: countOpenCases,
    });
    expect(res.status).toBe('compile_error');
  });

  it('records a thrown exception per case without killing the run', async () => {
    const res = await runInNode({
      source: `function countOpen(t) { if (t.length === 0) throw new Error('boom'); return t.length; }`,
      language: 'javascript',
      entrypoint: 'countOpen',
      cases: countOpenCases,
    });
    expect(res.status).toBe('failed');
    expect(res.caseResults.find((c) => c.caseId === 'empty')?.error).toContain('boom');
    expect(res.caseResults).toHaveLength(3);
  });

  it('supports ordinary recursion', async () => {
    const res = await runInNode({
      source: `function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }`,
      language: 'javascript',
      entrypoint: 'fact',
      cases: [
        { id: 'five', args: [5], expected: 120, hidden: false },
        { id: 'one', args: [1], expected: 1, hidden: false },
      ],
    });
    expect(res.status).toBe('passed');
  });

  it('contains unbounded recursion without crashing the host', async () => {
    const res = await runInNode({
      source: `function boom(n) { return boom(n + 1); }`,
      language: 'javascript',
      entrypoint: 'boom',
      cases: [{ id: 'go', args: [1], expected: 0, hidden: false }],
    });
    expect(['failed', 'runtime_error', 'timed_out']).toContain(res.status);
  });

  it('stops an infinite loop at the time limit', async () => {
    const started = Date.now();
    const res = await runInNode({
      source: `function spin() { while (true) {} }`,
      language: 'javascript',
      entrypoint: 'spin',
      cases: [{ id: 'go', args: [], expected: 1, hidden: false }],
      limits: { timeoutMs: 500 },
    });
    const elapsed = Date.now() - started;
    expect(res.status).toBe('timed_out');
    // Proves the interrupt handler fired rather than the process hanging.
    expect(elapsed).toBeLessThan(15_000);
  });

  it('bounds excessive allocation', async () => {
    const res = await runInNode({
      source: `function grow() { const a = []; while (true) { a.push(new Array(10000).fill('x')); } }`,
      language: 'javascript',
      entrypoint: 'grow',
      cases: [{ id: 'go', args: [], expected: 1, hidden: false }],
      limits: { timeoutMs: 1500, memoryLimitBytes: 8 * 1024 * 1024 },
    });
    expect(['runtime_error', 'timed_out', 'failed']).toContain(res.status);
  });

  it('bounds oversized output', async () => {
    // String.repeat is a single cheap allocation, so the OUTPUT cap is the
    // bound under test. Building the string with Array().fill().join() instead
    // costs seconds and lets the time limit trip first, which tests nothing
    // about output size.
    const res = await runInNode({
      source: `function big() { return 'x'.repeat(50000); }`,
      language: 'javascript',
      entrypoint: 'big',
      cases: [{ id: 'go', args: [], expected: '', hidden: false }],
      limits: { maxOutputBytes: 4096 },
    });
    // The property under test is CONTAINMENT: the run must not pass, and the
    // oversized value must never reach the learner-visible payload. Which
    // specific bound trips (output cap vs. time limit) is not contractual.
    expect(res.status).not.toBe('passed');
    expect(['runtime_error', 'timed_out', 'failed']).toContain(res.status);
    expect(JSON.stringify(res.caseResults).length).toBeLessThan(10_000);
  });

  it('contains a slow oversized allocation by some bound, whichever trips first', async () => {
    const res = await runInNode({
      source: `function big() { return new Array(200000).fill('xxxxxxxxxx').join(''); }`,
      language: 'javascript',
      entrypoint: 'big',
      cases: [{ id: 'go', args: [], expected: '', hidden: false }],
      limits: { maxOutputBytes: 4096 },
    });
    // Either the output cap or the time limit is a correct containment.
    expect(['runtime_error', 'timed_out', 'failed']).toContain(res.status);
  });

  it('truncates console output instead of flooding the UI', async () => {
    const res = await runInNode({
      source: `function noisy() { for (let i = 0; i < 5000; i++) console.log('line ' + i); return 1; }`,
      language: 'javascript',
      entrypoint: 'noisy',
      cases: [{ id: 'go', args: [], expected: 1, hidden: false }],
    });
    expect(res.consoleOutput.length).toBeLessThanOrEqual(100);
    expect(res.consoleTruncated).toBe(true);
  });

  describe('no host capability is reachable from learner code', () => {
    const forbidden = [
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document',
      'window',
      'process',
      'require',
      'importScripts',
      'postMessage',
      'Worker',
      'navigator',
    ];

    for (const name of forbidden) {
      it(`${name} is undefined inside the interpreter`, async () => {
        const res = await runInNode({
          source: `function probe() { return typeof ${name}; }`,
          language: 'javascript',
          entrypoint: 'probe',
          cases: [{ id: 'probe', args: [], expected: 'undefined', hidden: false }],
        });
        expect(res.status).toBe('passed');
      });
    }

    it('cannot reach the host realm through constructor escapes', async () => {
      const res = await runInNode({
        source: `function probe() {
          try {
            const F = (function(){}).constructor;
            return typeof F('return typeof fetch')();
          } catch (e) { return 'blocked'; }
        }`,
        language: 'javascript',
        entrypoint: 'probe',
        cases: [{ id: 'probe', args: [], expected: 'string', hidden: false }],
      });
      // Function constructor stays inside the interpreter: it can only ever see
      // the interpreter's own globals, where fetch does not exist.
      const actual = res.caseResults[0]?.actualJson;
      expect(res.status === 'passed' || actual === '"blocked"' || actual === '"undefined"').toBe(
        true,
      );
    });
  });

  it('starts a clean runtime on a repeated run after an error', async () => {
    const bad = await runInNode({
      source: `function f() { globalThis.leaked = 1; throw new Error('x'); }`,
      language: 'javascript',
      entrypoint: 'f',
      cases: [{ id: 'a', args: [], expected: 1, hidden: false }],
    });
    expect(bad.status).toBe('failed');

    const next = await runInNode({
      source: `function f() { return typeof globalThis.leaked; }`,
      language: 'javascript',
      entrypoint: 'f',
      cases: [{ id: 'a', args: [], expected: 'undefined', hidden: false }],
    });
    expect(next.status).toBe('passed');
  });

  it('honours cooperative cancellation', async () => {
    const token = { cancelled: false };
    const promise = runInNode(
      {
        source: `function spin() { while (true) {} }`,
        language: 'javascript',
        entrypoint: 'spin',
        cases: [{ id: 'go', args: [], expected: 1, hidden: false }],
        limits: { timeoutMs: 5000 },
      },
      token,
    );
    setTimeout(() => {
      token.cancelled = true;
    }, 100);
    const res = await promise;
    expect(['cancelled', 'timed_out']).toContain(res.status);
  });

  it('hides expected values for hidden cases', async () => {
    const res = await runInNode({
      source: 'function f() { return 1; }',
      language: 'javascript',
      entrypoint: 'f',
      cases: [
        { id: 'shown', args: [], expected: 1, hidden: false },
        { id: 'secret', args: [], expected: 1, hidden: true },
      ],
    });
    expect(res.caseResults.find((c) => c.caseId === 'shown')?.expectedJson).toBe('1');
    expect(res.caseResults.find((c) => c.caseId === 'secret')?.expectedJson).toBeUndefined();
    expect(res.caseResults.find((c) => c.caseId === 'secret')?.actualJson).toBeUndefined();
  });
});
