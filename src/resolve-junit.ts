/**
 * resolve-junit.ts — Locate and parse a local JUnit report.
 *
 * Path order matches `@tested/cli` `resolveJunitPath`:
 *   1. explicit `junit` argument
 *   2. TESTED_JUNIT env
 *   3. auto-detect junit.xml / test-results/junit.xml /
 *      coverage/junit.xml / reports/junit.xml
 *
 * Missing files are a quiet miss (null), not an error. Paths that escape
 * cwd still throw.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJunitToTestReport, type TestReport } from './junit.js';
import { assertSafeReadPath } from './safe-path.js';
import { validateCwd } from './validate-cwd.js';

/** Common vitest/jest/CI report paths. Keep in sync with CLI + action/run-push.sh. */
export const DEFAULT_JUNIT_CANDIDATES = [
  'junit.xml',
  'test-results/junit.xml',
  'coverage/junit.xml',
  'reports/junit.xml',
] as const;

export interface ResolveJunitOpts {
  cwd: string;
  junit?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve a JUnit XML path. Returns null when none is present
 * (analytics are optional).
 */
export async function resolveJunitPath(opts: ResolveJunitOpts): Promise<string | null> {
  const env = opts.env ?? process.env;
  if (opts.junit && opts.junit.trim()) {
    return existingSafePath(opts.cwd, opts.junit.trim());
  }
  const fromEnv = env['TESTED_JUNIT']?.trim();
  if (fromEnv) {
    return existingSafePath(opts.cwd, fromEnv);
  }
  for (const rel of DEFAULT_JUNIT_CANDIDATES) {
    const abs = join(opts.cwd, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

async function existingSafePath(cwd: string, pathInput: string): Promise<string | null> {
  const abs = await assertSafeReadPath(cwd, pathInput);
  if (!existsSync(abs)) return null;
  return abs;
}

/**
 * Validate cwd, locate JUnit XML, and parse it to the shared TestReport.
 * Returns null when no report file is present.
 */
export async function loadTestReport(opts: ResolveJunitOpts): Promise<TestReport | null> {
  await validateCwd(opts.cwd);
  const path = await resolveJunitPath(opts);
  if (!path) return null;
  const xml = readFileSync(path, 'utf8');
  return parseJunitToTestReport(xml);
}
