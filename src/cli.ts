/**
 * cli.ts — Subprocess invoker for the `tested` CLI binary.
 *
 * Spawns `node <TESTED_BIN> ...args` in the given cwd, collects stdout, and
 * parses the result as JSON.  stderr is forwarded to our own stderr so any
 * CLI warnings surface to the MCP host.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { validateCwd } from './validate-cwd.js';
import { truncate } from './tool-error.js';

/**
 * Resolve the path to the `tested` CLI binary.
 *
 * Resolution order:
 *   1. `TESTED_BIN` env var (explicit override).
 *   2. `require.resolve('@tested/cli/dist/tested.js')` — works when
 *      `@tested/cli` is installed as a dependency (e.g. via npm/pnpm).
 *   3. `which tested` — works when the user has the `tested` bin in PATH
 *      (e.g. installed globally or via `pnpm link`).
 *
 * Throws a clear error with install instructions if none of the above
 * succeed.
 */
function resolveTestedBin(): string {
  const envBin = process.env['TESTED_BIN'];
  if (envBin) return envBin;

  try {
    const require = createRequire(import.meta.url);
    return require.resolve('@tested/cli/dist/tested.js');
  } catch {
    // fall through to PATH lookup
  }

  try {
    const result = spawnSync('which', ['tested'], { encoding: 'utf8' });
    if (result.status === 0) {
      const path = result.stdout.trim();
      if (path) return path;
    }
  } catch {
    // fall through to error
  }

  throw new Error(
    '[tested-mcp] Cannot locate the `tested` CLI binary. ' +
      'Either install @tested/cli (pnpm add @tested/cli), ' +
      'install it globally (pnpm add -g @tested/cli), ' +
      'or set the TESTED_BIN env var to the absolute path of dist/tested.js.',
  );
}

export const TESTED_BIN = resolveTestedBin();

export interface CliOptions {
  cwd: string;
}

/**
 * Runs `tested <...args> --json` and returns the parsed JSON output.
 *
 * @throws {Error} if the process exits non-zero or stdout is not valid JSON.
 */
export async function runCli<T = unknown>(
  args: string[],
  opts: CliOptions,
): Promise<T> {
  await validateCwd(opts.cwd);
  return new Promise<T>((resolve, reject) => {
    const child = spawn('node', [TESTED_BIN, ...args], {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      // Forward CLI stderr to our stderr so warnings reach the MCP host
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      if (code !== 0) {
        reject(
          new Error(
            `tested exited with code ${code}.\nstderr: ${truncate(stderr)}\nstdout: ${truncate(stdout)}`,
          ),
        );
        return;
      }

      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        reject(
          new Error(
            `tested output is not valid JSON.\nstdout: ${truncate(stdout)}`,
          ),
        );
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn tested binary: ${err.message}`));
    });
  });
}
