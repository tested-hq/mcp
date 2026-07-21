/**
 * cli.ts — Subprocess invoker for the `tested` CLI binary.
 *
 * Spawns `node <TESTED_BIN> ...args` in the given cwd, collects stdout, and
 * parses the result as JSON.  stderr is forwarded to our own stderr so any
 * CLI warnings surface to the MCP host.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { validateCwd } from './validate-cwd.js';
import { truncate } from './tool-error.js';

// ── In-flight subprocess tracking (for graceful shutdown) ───────────────────

const inFlight = new Set<ChildProcess>();

export function trackChild(c: ChildProcess): void {
  inFlight.add(c);
  c.once('exit', () => inFlight.delete(c));
}

export function killAllChildren(signal: NodeJS.Signals = 'SIGTERM'): void {
  for (const c of inFlight) {
    try {
      c.kill(signal);
    } catch {
      // best effort
    }
  }
}

export function inFlightCount(): number {
  return inFlight.size;
}

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
/**
 * Validate an explicit TESTED_BIN override.
 * Must be absolute (no PATH search / relative CWD tricks) and free of NULs.
 * Existence is checked at spawn time so test setups can inject placeholders.
 */
export function assertSafeTestedBin(envBin: string): string {
  const trimmed = envBin.trim();
  if (!trimmed) {
    throw new Error('[tested-mcp] TESTED_BIN is empty');
  }
  if (trimmed.includes('\0')) {
    throw new Error('[tested-mcp] TESTED_BIN must not contain null bytes');
  }
  if (!isAbsolute(trimmed)) {
    throw new Error(
      `[tested-mcp] TESTED_BIN must be an absolute path, got: ${trimmed}`,
    );
  }
  return trimmed;
}

function resolveTestedBin(): string {
  const envBin = process.env['TESTED_BIN'];
  if (envBin) return assertSafeTestedBin(envBin);

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
/** Default wall-clock budget for a CLI subprocess. */
export const DEFAULT_CLI_TIMEOUT_MS = 2 * 60 * 1000;

/** Cap CLI stdout capture (JSON payloads should be far smaller). */
export const MAX_CLI_STDOUT_BYTES = 8 * 1024 * 1024;

export async function runCli<T = unknown>(
  args: string[],
  opts: CliOptions & { timeoutMs?: number },
): Promise<T> {
  await validateCwd(opts.cwd);
  // Refuse flag-like injection into fixed slots (e.g. --base value).
  for (const a of args) {
    if (a.includes('\0')) {
      throw new Error('CLI argument must not contain null bytes');
    }
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
    const child = spawn('node', [TESTED_BIN, ...args], {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackChild(child);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // best effort
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // best effort
        }
      }, 5_000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= MAX_CLI_STDOUT_BYTES) return;
      const room = MAX_CLI_STDOUT_BYTES - stdoutBytes;
      if (chunk.length <= room) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      } else {
        stdoutChunks.push(chunk.subarray(0, room));
        stdoutBytes = MAX_CLI_STDOUT_BYTES;
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      // Forward CLI stderr to our stderr so warnings reach the MCP host
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      if (timedOut) {
        reject(
          new Error(
            `tested timed out after ${timeoutMs}ms.\nstderr: ${truncate(stderr)}`,
          ),
        );
        return;
      }

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
      clearTimeout(timer);
      reject(new Error(`Failed to spawn tested binary: ${err.message}`));
    });
  });
}
