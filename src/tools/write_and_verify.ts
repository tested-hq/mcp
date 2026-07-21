/**
 * write_and_verify.ts — Fused "write a test file + re-run coverage" tool.
 *
 * Cuts the agent's write→re-check roundtrip in half: one tool call writes
 * the test file, runs the user's test runner with coverage enabled, then
 * (on success) calls `tested diff --json` and returns the fresh uncovered-
 * range snapshot. On runner failure, returns success:false with the
 * captured vitestStderr so the agent can self-correct without an extra
 * get_uncovered_diff tool call.
 *
 * Security:
 *   - validateCwd before any write or spawn (git repo, not a symlink,
 *     optional TESTED_ALLOWED_CWDS allowlist).
 *   - write target must resolve inside cwd.
 *   - content size is hard-capped to limit DoS / disk fill.
 */

import { writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { runCli } from '../cli.js';
import { toUncoveredDiff } from '../reshape.js';
import {
  CliDiffOutputSchema,
  WriteAndVerifyInput,
  WriteAndVerifyOutput,
} from '../schemas.js';
import { validateCwd } from '../validate-cwd.js';
import { runTestsWithCoverage } from './run-tests.js';

/** Hard cap on test-file content (1 MiB). Prevents unbounded disk fill. */
export const MAX_WRITE_CONTENT_BYTES = 1 * 1024 * 1024;

function assertWithinCwd(cwd: string, target: string): void {
  if (isAbsolute(target)) {
    throw new Error(`path must be relative to cwd, got absolute: ${target}`);
  }
  if (target.includes('\0')) {
    throw new Error('path must not contain null bytes');
  }
  const root = resolve(cwd) + sep;
  const resolved = resolve(cwd, target);
  if (!resolved.startsWith(root)) {
    throw new Error(`path resolves outside cwd: ${resolved} not under ${root}`);
  }
}

export async function writeAndVerify(
  input: WriteAndVerifyInput,
): Promise<WriteAndVerifyOutput> {
  const { cwd, base, path, content } = input;

  // 0. Validate cwd *before* writing or spawning — previously only runCli
  //    called validateCwd, so a non-repo / non-allowlisted cwd could still
  //    receive an arbitrary write + vitest spawn.
  await validateCwd(cwd);

  // 1. Validate the write target stays inside cwd (defense in depth — the
  //    user might be running this against a repo with sensitive siblings).
  assertWithinCwd(cwd, path);

  const bytesWritten = Buffer.byteLength(content, 'utf8');
  if (bytesWritten > MAX_WRITE_CONTENT_BYTES) {
    throw new Error(
      `content exceeds ${MAX_WRITE_CONTENT_BYTES} byte limit (got ${bytesWritten})`,
    );
  }

  // 2. Write the file.
  const abs = resolve(cwd, path);
  await writeFile(abs, content, 'utf8');

  // 3. Run the user's test runner with coverage.
  const runResult = await runTestsWithCoverage({ cwd });
  if (!runResult.success) {
    return {
      bytesWritten,
      success: false,
      vitestStderr: runResult.stderr,
      vitestStdout: runResult.stdout,
    };
  }

  // 4. Run `tested diff --json` to get the fresh uncovered-range snapshot.
  const raw = await runCli(['diff', '--base', base, '--json'], { cwd });
  const parsed = CliDiffOutputSchema.parse(raw);
  const diff = toUncoveredDiff(parsed);

  return {
    bytesWritten,
    success: true,
    vitestStderr: null,
    diff,
  };
}
