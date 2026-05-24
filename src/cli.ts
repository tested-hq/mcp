/**
 * cli.ts — Subprocess invoker for the `tested` CLI binary.
 *
 * Spawns `node <TESTED_BIN> ...args` in the given cwd, collects stdout, and
 * parses the result as JSON.  stderr is forwarded to our own stderr so any
 * CLI warnings surface to the MCP host.
 */

import { spawn } from 'node:child_process';

export const TESTED_BIN =
  process.env['TESTED_BIN'] ??
  '/Users/jorgemodesto/projects/tested/tested-hq/cli/dist/tested.js';

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
            `tested exited with code ${code}.\nstderr: ${stderr}\nstdout: ${stdout}`,
          ),
        );
        return;
      }

      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        reject(
          new Error(
            `tested output is not valid JSON.\nstdout: ${stdout}`,
          ),
        );
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn tested binary: ${err.message}`));
    });
  });
}
