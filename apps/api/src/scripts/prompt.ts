import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/**
 * Interactive secret entry for the administration commands (spec 6).
 *
 * The password is NEVER accepted as a command-line argument — argv is visible
 * in the process list and lands in shell history. It is read from a TTY with
 * echo suppressed, or injected through an environment variable for automated
 * provisioning. It is never logged, echoed, or written to disk.
 */

class MutedOutput extends Writable {
  muted = false;

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) process.stdout.write(chunk);
    callback();
  }
}

export async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'No interactive terminal available. Supply the password through the documented environment variable instead.',
    );
  }

  const output = new MutedOutput();
  const rl = createInterface({ input: process.stdin, output, terminal: true });

  return new Promise<string>((resolve, reject) => {
    process.stdout.write(question);
    output.muted = true;
    rl.question('', (answer) => {
      output.muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
    rl.on('error', (error) => {
      output.muted = false;
      rl.close();
      reject(error);
    });
  });
}

export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Read a secret from an injected environment variable, falling back to an
 * interactive prompt. Confirms the value when typed by hand.
 */
export async function readPassword(envVar: string, label: string): Promise<string> {
  const injected = process.env[envVar];
  if (injected && injected.length > 0) {
    return injected;
  }
  const first = await promptSecret(`${label}: `);
  const second = await promptSecret('Confirm password: ');
  if (first !== second) {
    throw new Error('Passwords did not match.');
  }
  return first;
}
