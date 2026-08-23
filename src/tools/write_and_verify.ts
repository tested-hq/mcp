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
 *   - write target must resolve inside cwd, including after realpath of the
 *     deepest existing ancestor and an lstat walk that refuses symlink
 *     components pointing outside the tree.
 *   - content size is hard-capped to limit DoS / disk fill.
 *   - CLI and test-runner children get a sanitized env (no TESTED_TOKEN).
 */

import { writeFile } from 'node:fs/promises';
import { runCli } from '../cli.js';
import { applyPayloadCap } from '../payload-cap.js';
import { resolveToolBase } from '../resolve-base.js';
import { toUncoveredDiff } from '../reshape.js';
import { assertSafeWritePath } from '../safe-path.js';
import {
  CliDiffOutputSchema,
  WriteAndVerifyInput,
  WriteAndVerifyOutput,
} from '../schemas.js';
import { validateCwd } from '../validate-cwd.js';
import { runTestsWithCoverage } from './run-tests.js';

/** Hard cap on test-file content (1 MiB). Prevents unbounded disk fill. */
export const MAX_WRITE_CONTENT_BYTES = 1 * 1024 * 1024;

export async function writeAndVerify(
  input: WriteAndVerifyInput,
): Promise<WriteAndVerifyOutput> {
  const { cwd, path, content } = input;

  // 0. Validate cwd *before* writing or spawning — previously only runCli
  //    called validateCwd, so a non-repo / non-allowlisted cwd could still
  //    receive an arbitrary write + vitest spawn.
  await validateCwd(cwd);
  const base = resolveToolBase({
    cwd,
    ...(input.base !== undefined ? { base: input.base } : {}),
  });

  // 1. Validate the write target stays inside cwd even through intermediate
  //    symlinks (realpath deepest ancestor + lstat walk).
  const abs = await assertSafeWritePath(cwd, path);

  const bytesWritten = Buffer.byteLength(content, 'utf8');
  if (bytesWritten > MAX_WRITE_CONTENT_BYTES) {
    throw new Error(
      `content exceeds ${MAX_WRITE_CONTENT_BYTES} byte limit (got ${bytesWritten})`,
    );
  }

  // 2. Write the file.
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
  const diff = applyPayloadCap(toUncoveredDiff(parsed));

  return {
    bytesWritten,
    success: true,
    vitestStderr: null,
    diff,
  };
}
