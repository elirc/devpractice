import { describe, expect, it } from 'vitest';
import { jsonEqual } from '@devpractice/contracts';
import { ConsoleBuffer, boundedStringify, deepCopyJson, evaluateCase, utf8Length } from '../src/compare.js';

describe('jsonEqual', () => {
  it('ignores object key order but respects array order', () => {
    expect(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });

  it('compares nested structures', () => {
    expect(jsonEqual({ a: [{ x: 1 }] }, { a: [{ x: 1 }] })).toBe(true);
    expect(jsonEqual({ a: [{ x: 1 }] }, { a: [{ x: 2 }] })).toBe(false);
  });

  it('is exact for numbers unless a tolerance is given', () => {
    expect(jsonEqual(0.1 + 0.2, 0.3)).toBe(false);
    expect(jsonEqual(0.1 + 0.2, 0.3, 1e-9)).toBe(true);
  });

  it('does not treat differing key counts as equal', () => {
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it('distinguishes null from undefined and from 0', () => {
    expect(jsonEqual(null, undefined)).toBe(false);
    expect(jsonEqual(null, 0)).toBe(false);
  });
});

describe('evaluateCase', () => {
  const base = {
    assertInputUnchanged: false,
    durationMs: 1,
    maxOutputBytes: 4096,
  };

  it('passes a matching value', () => {
    const result = evaluateCase({
      ...base,
      testCase: { id: 'a', args: [1], expected: 2, hidden: false },
      actual: 2,
    });
    expect(result.passed).toBe(true);
    expect(result.expectedJson).toBe('2');
  });

  it('fails a mutated input even when the value matches', () => {
    const result = evaluateCase({
      ...base,
      assertInputUnchanged: true,
      testCase: { id: 'a', args: [[1, 2]], expected: 2, hidden: false },
      actual: 2,
      argsAfter: [[1]],
    });
    expect(result.passed).toBe(false);
    expect(result.inputMutated).toBe(true);
  });

  it('passes when the input is untouched', () => {
    const result = evaluateCase({
      ...base,
      assertInputUnchanged: true,
      testCase: { id: 'a', args: [[1, 2]], expected: 2, hidden: false },
      actual: 2,
      argsAfter: [[1, 2]],
    });
    expect(result.passed).toBe(true);
    expect(result.inputMutated).toBe(false);
  });

  it('withholds expected and actual for hidden cases', () => {
    const result = evaluateCase({
      ...base,
      testCase: { id: 'a', args: [], expected: 7, hidden: true },
      actual: 8,
    });
    expect(result.passed).toBe(false);
    expect(result.expectedJson).toBeUndefined();
    expect(result.actualJson).toBeUndefined();
  });

  it('records an error as a failure', () => {
    const result = evaluateCase({
      ...base,
      testCase: { id: 'a', args: [], expected: 1, hidden: false },
      actual: undefined,
      error: 'Error: boom',
    });
    expect(result.passed).toBe(false);
    expect(result.error).toBe('Error: boom');
  });
});

describe('boundedStringify', () => {
  it('truncates beyond the byte ceiling', () => {
    const { json, truncated } = boundedStringify('x'.repeat(500), 50);
    expect(truncated).toBe(true);
    expect(json.length).toBeLessThan(500);
  });

  it('survives a cyclic value', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(boundedStringify(cyclic, 100).json).toContain('unserializable');
  });
});

describe('deepCopyJson', () => {
  it('returns an independent structure', () => {
    const original = [{ a: [1, 2] }];
    const copy = deepCopyJson(original);
    copy[0]!.a.push(3);
    expect(original[0]!.a).toHaveLength(2);
  });
});

describe('utf8Length', () => {
  it('counts multi-byte characters', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('☃')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
  });
});

describe('ConsoleBuffer', () => {
  it('caps the number of lines', () => {
    const buffer = new ConsoleBuffer(3, 10_000);
    for (let i = 0; i < 10; i += 1) buffer.push(`line ${i}`);
    expect(buffer.output).toHaveLength(3);
    expect(buffer.truncated).toBe(true);
  });

  it('caps total bytes', () => {
    const buffer = new ConsoleBuffer(100, 20);
    buffer.push('x'.repeat(50));
    expect(buffer.truncated).toBe(true);
    // Content is cut at the cap; the trailing "…" marker (3 UTF-8 bytes) is
    // display-only and is allowed to sit just past it.
    expect(buffer.output[0]).toBe(`${'x'.repeat(20)}…`);
    expect(utf8Length(buffer.output.join(''))).toBeLessThanOrEqual(20 + 3);
  });

  it('stays untruncated within limits', () => {
    const buffer = new ConsoleBuffer(10, 1000);
    buffer.push('hello');
    expect(buffer.truncated).toBe(false);
    expect(buffer.output).toEqual(['hello']);
  });
});
