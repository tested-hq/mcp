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
 * Path traversal protection: the write target must resolve inside cwd.
 * (validateCwd, which we don't call directly here, is already invoked by
 * runCli for the subsequent diff call.)
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
import { runTestsWithCoverage } from './run-tests.js';

function assertWithinCwd(cwd: string, target: string): void {
  if (isAbsolute(target)) {
    throw new Error(`path must be relative to cwd, got absolute: ${target}`);
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

  // 1. Validate the write target stays inside cwd (defense in depth — the
  //    user might be running this against a repo with sensitive siblings).
  assertWithinCwd(cwd, path);

  // 2. Write the file.
  const abs = resolve(cwd, path);
  await writeFile(abs, content, 'utf8');
  const bytesWritten = Buffer.byteLength(content, 'utf8');

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
