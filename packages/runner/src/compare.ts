import { jsonEqual, type RunnerCase, type RunnerCaseResult } from '@devpractice/contracts';

/**
 * Comparison logic shared by the browser worker and the Node runner.
 *
 * This module is TRUSTED code. Expected values live here and are never handed
 * to the interpreter, so learner source cannot overwrite a result object.
 */

export interface BoundedJson {
  json: string;
  truncated: boolean;
}

/** JSON.stringify with an explicit byte ceiling and cycle tolerance. */
export function boundedStringify(value: unknown, maxBytes: number): BoundedJson {
  let raw: string;
  try {
    raw = JSON.stringify(value) ?? 'undefined';
  } catch {
    raw = '[unserializable value]';
  }
  const bytes = utf8Length(raw);
  if (bytes <= maxBytes) return { json: raw, truncated: false };
  // Cut on a character boundary; the value is only ever shown, never re-parsed.
  return { json: `${raw.slice(0, Math.max(0, maxBytes))}…`, truncated: true };
}

export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** Structural deep copy through JSON so each case gets independent inputs. */
export function deepCopyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

export interface CaseOutcomeInput {
  testCase: RunnerCase;
  /** Value returned by the interpreter, already converted to a host value. */
  actual: unknown;
  /** Arguments as they stood AFTER the call, when mutation is being checked. */
  argsAfter?: unknown[];
  assertInputUnchanged: boolean;
  durationMs: number;
  error?: string;
  maxOutputBytes: number;
}

/**
 * Decide one case. A mutated input fails the case even when the returned value
 * matches, because the exercise asked for a non-mutating solution.
 */
export function evaluateCase(input: CaseOutcomeInput): RunnerCaseResult {
  const { testCase, assertInputUnchanged, maxOutputBytes } = input;

  if (input.error !== undefined) {
    return {
      caseId: testCase.id,
      passed: false,
      hidden: testCase.hidden,
      error: input.error,
      durationMs: input.durationMs,
      ...(testCase.hidden
        ? {}
        : { expectedJson: boundedStringify(testCase.expected, maxOutputBytes).json }),
    };
  }

  const valueMatches = jsonEqual(input.actual, testCase.expected, testCase.tolerance);

  let inputMutated = false;
  if (assertInputUnchanged && input.argsAfter) {
    inputMutated = !jsonEqual(input.argsAfter, testCase.args);
  }

  const passed = valueMatches && !inputMutated;

  const result: RunnerCaseResult = {
    caseId: testCase.id,
    passed,
    hidden: testCase.hidden,
    durationMs: input.durationMs,
  };
  if (assertInputUnchanged) result.inputMutated = inputMutated;
  if (!testCase.hidden) {
    result.expectedJson = boundedStringify(testCase.expected, maxOutputBytes).json;
    result.actualJson = boundedStringify(input.actual, maxOutputBytes).json;
  }
  return result;
}

/** Bounded console buffer shared by both runner hosts. */
export class ConsoleBuffer {
  private readonly lines: string[] = [];
  private bytes = 0;
  private truncatedFlag = false;

  constructor(
    private readonly maxLines: number,
    private readonly maxBytes: number,
  ) {}

  push(line: string): void {
    if (this.lines.length >= this.maxLines) {
      this.truncatedFlag = true;
      return;
    }
    const size = utf8Length(line);
    if (this.bytes + size > this.maxBytes) {
      const remaining = Math.max(0, this.maxBytes - this.bytes);
      if (remaining > 0) this.lines.push(`${line.slice(0, remaining)}…`);
      this.bytes = this.maxBytes;
      this.truncatedFlag = true;
      return;
    }
    this.lines.push(line);
    this.bytes += size;
  }

  get output(): string[] {
    return this.lines;
  }

  get truncated(): boolean {
    return this.truncatedFlag;
  }
}
