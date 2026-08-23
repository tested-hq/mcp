/**
 * run-tests.ts — Spawn the user's test runner with coverage enabled.
 *
 * write_and_verify needs the suite to actually execute (otherwise the
 * subsequent `tested diff --json` reads stale coverage). We default to
 * `npx vitest run --coverage --coverage.reporter=json` because that's the
 * runner the eval prototype validated and it matches the README install
 * instructions; jest/pytest are reachable through the same wiring once
 * the production CLI exposes the runner-config plumbing.
 *
 * Returns the captured stdout/stderr + a success boolean instead of
 * throwing so the calling tool can return success:false to the model
 * with the actual error message — matches the Arm B feedback loop
 * pattern from the eval harness.
 *
 * Resource limits: timeout + capped stdout/stderr buffers prevent a
 * runaway suite (or malicious fixture) from DoS-ing the MCP host.
 *
 * The runner inherits a sanitized copy of process.env (see sanitizeChildEnv)
 * so agent-written tests cannot read TESTED_TOKEN from the MCP host.
 */

import { spawn } from 'node:child_process';
import { trackChild } from '../cli.js';
import { sanitizeChildEnv } from '../sanitize-env.js';

export interface RunTestsResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

export interface RunTestsOptions {
  cwd: string;
  /** Kill the runner after this many ms. Default 5 minutes. */
  timeoutMs?: number;
}

const DEFAULT_RUN_COMMAND = 'npx';
const DEFAULT_RUN_ARGS = [
  'vitest',
  'run',
  '--coverage',
  '--coverage.reporter=json',
];

/** Default wall-clock budget for a single coverage run. */
export const DEFAULT_TEST_TIMEOUT_MS = 5 * 60 * 1000;

/** Cap captured stdout/stderr so a noisy suite cannot exhaust memory. */
export const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

function pushCapped(chunks: Buffer[], total: { n: number }, chunk: Buffer): void {
  if (total.n >= MAX_CAPTURE_BYTES) return;
  const room = MAX_CAPTURE_BYTES - total.n;
  if (chunk.length <= room) {
    chunks.push(chunk);
    total.n += chunk.length;
  } else {
    chunks.push(chunk.subarray(0, room));
    total.n = MAX_CAPTURE_BYTES;
  }
}

export async function runTestsWithCoverage(
  opts: RunTestsOptions,
): Promise<RunTestsResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
  return new Promise<RunTestsResult>((resolve, reject) => {
    const child = spawn(DEFAULT_RUN_COMMAND, DEFAULT_RUN_ARGS, {
      cwd: opts.cwd,
      env: sanitizeChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackChild(child);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutTotal = { n: 0 };
    const stderrTotal = { n: 0 };
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // best effort
      }
      // Escalate if the process ignores SIGTERM.
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // best effort
        }
      }, 5_000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) =>
      pushCapped(stdoutChunks, stdoutTotal, chunk),
    );
    child.stderr.on('data', (chunk: Buffer) =>
      pushCapped(stderrChunks, stderrTotal, chunk),
    );

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      let stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (timedOut) {
        stderr =
          `test runner timed out after ${timeoutMs}ms\n` + stderr;
        resolve({ success: false, stdout, stderr });
        return;
      }
      resolve({ success: code === 0, stdout, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn test runner: ${err.message}`));
    });
  });
}
