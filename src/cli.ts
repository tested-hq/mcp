/**
 * cli.ts — Subprocess invoker for the `tested` CLI binary.
 *
 * Spawns `node <TESTED_BIN> ...args` in the given cwd, collects stdout, and
 * parses the result as JSON.  stderr is forwarded to our own stderr so any
 * CLI warnings surface to the MCP host.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, isAbsolute, resolve, sep } from 'node:path';
import { sanitizeChildEnv } from './sanitize-env.js';
import { friendlyGitRefError } from './resolve-base.js';
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

/** Basename must look like the tested CLI when an override is used. */
export const TESTED_BIN_BASENAME_RE = /^tested(\.js)?$/;

export interface AssertSafeTestedBinOpts {
  env?: NodeJS.ProcessEnv;
  /** Warning sink (defaults to process.stderr.write). */
  warn?: (msg: string) => void;
}

/**
 * Validate an explicit TESTED_BIN override.
 *
 * Must be absolute (no PATH search / relative CWD tricks) and free of NULs.
 * When `TESTED_BIN_ALLOW_PREFIX` is set (colon-separated realpath prefixes),
 * the resolved realpath must start with one of those prefixes, and basename
 * must match `/^tested(\.js)?$/` (hard-fail). Without the prefix policy,
 * a non-matching basename only warns.
 *
 * Existence is required when the prefix policy is set; otherwise existence
 * is checked at spawn time so test setups can inject placeholders.
 */
export function assertSafeTestedBin(
  envBin: string,
  opts: AssertSafeTestedBinOpts = {},
): string {
  const env = opts.env ?? process.env;
  const warn =
    opts.warn ??
    ((msg: string) => {
      process.stderr.write(msg);
    });

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

  const base = basename(trimmed);
  const prefixRaw = env['TESTED_BIN_ALLOW_PREFIX'];
  const prefixes = prefixRaw
    ? prefixRaw
        .split(':')
        .map((p) => p.trim())
        .filter(Boolean)
    : [];
  const hasPrefixPolicy = prefixes.length > 0;

  if (!TESTED_BIN_BASENAME_RE.test(base)) {
    if (hasPrefixPolicy) {
      throw new Error(
        `[tested-mcp] TESTED_BIN basename must match /^tested(\\.js)?$/ when ` +
          `TESTED_BIN_ALLOW_PREFIX is set, got: ${base}`,
      );
    }
    warn(
      `[tested-mcp] warning: TESTED_BIN basename "${base}" does not match ` +
        `tested or tested.js — prefer the official CLI binary\n`,
    );
  }

  if (hasPrefixPolicy) {
    let realBin: string;
    try {
      realBin = realpathSync(trimmed);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new Error(
        `[tested-mcp] TESTED_BIN cannot be resolved (realpath failed` +
          `${code ? `: ${code}` : ''}): ${trimmed}`,
      );
    }

    const allowed = prefixes.some((prefix) => {
      let realPrefix: string;
      try {
        realPrefix = realpathSync(prefix);
      } catch {
        // Fall back to absolute resolve if prefix path does not exist yet.
        realPrefix = resolve(prefix);
      }
      return (
        realBin === realPrefix ||
        realBin.startsWith(realPrefix.endsWith(sep) ? realPrefix : realPrefix + sep)
      );
    });

    if (!allowed) {
      throw new Error(
        `[tested-mcp] TESTED_BIN realpath "${realBin}" is not under any ` +
          `TESTED_BIN_ALLOW_PREFIX entry`,
      );
    }
  }

  return trimmed;
}

/** Exact install line for a first-time project. Keep this copy-pasteable. */
export const MISSING_CLI_INSTALL = 'npm i -D @tested/cli @tested/mcp';

export const MISSING_CLI_MESSAGE =
  '[tested-mcp] Cannot locate the `tested` CLI binary.\n' +
  'Install both packages in this project, then restart the MCP server:\n\n' +
  `  ${MISSING_CLI_INSTALL}\n`;

export interface ResolveTestedBinDeps {
  env?: NodeJS.ProcessEnv;
  resolvePackage?: () => string;
  whichTested?: () => string | null;
}

function defaultResolvePackage(): string {
  const require = createRequire(import.meta.url);
  return require.resolve('@tested/cli/dist/tested.js');
}

function defaultWhichTested(): string | null {
  try {
    const result = spawnSync('which', ['tested'], { encoding: 'utf8' });
    if (result.status === 0) {
      const path = result.stdout.trim();
      if (path) return path;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Resolve the path to the `tested` CLI binary.
 *
 * Resolution order:
 *   1. `TESTED_BIN` env var (explicit override).
 *   2. `require.resolve('@tested/cli/dist/tested.js')` — works when
 *      `@tested/cli` is installed (including as a dependency of this
 *      package, so `npx -y @tested/mcp` can resolve it).
 *   3. `which tested` — global / PATH install.
 *
 * Lazy: do not call this at module load. A missing binary must not
 * prevent the MCP server from starting; tools return MISSING_CLI_MESSAGE.
 */
export function resolveTestedBin(deps: ResolveTestedBinDeps = {}): string {
  const env = deps.env ?? process.env;
  const envBin = env['TESTED_BIN'];
  if (envBin) return assertSafeTestedBin(envBin, { env });

  try {
    const resolved = (deps.resolvePackage ?? defaultResolvePackage)();
    if (resolved) return resolved;
  } catch {
    // fall through to PATH lookup
  }

  const fromPath = (deps.whichTested ?? defaultWhichTested)();
  if (fromPath) return fromPath;

  throw new Error(MISSING_CLI_MESSAGE);
}

export function getTestedBin(): string {
  return resolveTestedBin();
}

export interface CliOptions {
  cwd: string;
  /** Override the sanitized child env (push re-adds TESTED_TOKEN here). */
  env?: NodeJS.ProcessEnv;
  /** When true, a non-zero exit still parses JSON stdout (check / doctor / push). */
  allowNonZero?: boolean;
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

function baseArgFrom(args: string[]): string | undefined {
  const i = args.indexOf('--base');
  if (i === -1) return undefined;
  return args[i + 1];
}

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
  const childEnv = opts.env ?? sanitizeChildEnv();
  const bin = getTestedBin();
  return new Promise<T>((resolvePromise, reject) => {
    const child = spawn('node', [bin, ...args], {
      cwd: opts.cwd,
      env: childEnv,
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

      if (code !== 0 && !opts.allowNonZero) {
        const friendly = friendlyGitRefError(stderr, baseArgFrom(args));
        reject(
          new Error(
            friendly ??
              `tested exited with code ${code}.\nstderr: ${truncate(stderr)}\nstdout: ${truncate(stdout)}`,
          ),
        );
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout) as T);
      } catch {
        if (code !== 0) {
          const friendly = friendlyGitRefError(stderr, baseArgFrom(args));
          reject(
            new Error(
              friendly ??
                `tested exited with code ${code}.\nstderr: ${truncate(stderr)}\nstdout: ${truncate(stdout)}`,
            ),
          );
          return;
        }
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
