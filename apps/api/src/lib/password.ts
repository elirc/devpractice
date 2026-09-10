import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Password hashing (spec 6): a maintained Argon2id implementation with
 * parameters taken from current OWASP guidance. No hand-rolled cryptography.
 *
 * OWASP's Password Storage Cheat Sheet gives m=19456 KiB, t=2, p=1 as the
 * minimum acceptable Argon2id configuration. This app authenticates a single
 * owner at human speed, so we sit comfortably above that floor at 64 MiB and
 * three iterations; the extra cost is unnoticeable at one login per session
 * and meaningfully raises the cost of an offline attack on a stolen hash.
 *
 * The encoded hash carries its own parameters, so raising these later still
 * verifies existing passwords — only newly set passwords use the new cost.
 */
export const ARGON2_PARAMS = {
  algorithm: Algorithm.Argon2id,
  /** Memory cost in KiB. */
  memoryCost: 65_536,
  /** Iterations. */
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

/** The OWASP floor these parameters must never fall below. */
export const OWASP_ARGON2_FLOOR = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/**
 * Deliberately cheap parameters used ONLY under NODE_ENV=test.
 *
 * The integration suite performs dozens of real sign-ins, and at production
 * cost a single test spends most of a minute inside Argon2 — tests were timing
 * out and their in-flight writes were landing in the next test's fixture. The
 * algorithm and the code path stay identical; only the work factor changes, and
 * a unit test asserts the production constant still clears the OWASP floor so
 * this can never quietly weaken real password storage.
 */
const TEST_ARGON2_PARAMS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 8_192,
  timeCost: 1,
  parallelism: 1,
  outputLen: 32,
} as const;

export function activeArgon2Params(): typeof ARGON2_PARAMS | typeof TEST_ARGON2_PARAMS {
  return process.env.NODE_ENV === 'test' ? TEST_ARGON2_PARAMS : ARGON2_PARAMS;
}

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, activeArgon2Params());
}

/**
 * Verify a password. Returns false on malformed stored hashes rather than
 * throwing, so a corrupted row cannot turn into a 500 that distinguishes
 * accounts.
 */
export async function verifyPassword(storedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext);
  } catch {
    return false;
  }
}

/**
 * A dummy hash used to equalise timing when the account does not exist, so a
 * response time cannot enumerate valid emails.
 */
let dummyHashPromise: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('devpractice-nonexistent-account-placeholder');
  return dummyHashPromise;
}

export interface PasswordPolicyResult {
  ok: boolean;
  problems: string[];
}

/** Minimal, non-annoying policy: length is what actually matters. */
export function checkPasswordPolicy(plaintext: string): PasswordPolicyResult {
  const problems: string[] = [];
  if (plaintext.length < 12) problems.push('Use at least 12 characters.');
  if (plaintext.length > 1024) problems.push('Use at most 1024 characters.');
  if (plaintext.trim().length === 0) problems.push('Password cannot be blank.');
  return { ok: problems.length === 0, problems };
}
