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
 */

import { spawn } from 'node:child_process';
import { trackChild } from '../cli.js';

export interface RunTestsResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

export interface RunTestsOptions {
  cwd: string;
}

const DEFAULT_RUN_COMMAND = 'npx';
const DEFAULT_RUN_ARGS = [
  'vitest',
  'run',
  '--coverage',
  '--coverage.reporter=json',
];

export async function runTestsWithCoverage(
  opts: RunTestsOptions,
): Promise<RunTestsResult> {
  return new Promise<RunTestsResult>((resolve, reject) => {
    const child = spawn(DEFAULT_RUN_COMMAND, DEFAULT_RUN_ARGS, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackChild(child);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      resolve({ success: code === 0, stdout, stderr });
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn test runner: ${err.message}`));
    });
  });
}
