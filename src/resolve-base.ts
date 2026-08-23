/**
 * resolve-base.ts — Pick a git base that works in a local repo.
 *
 * Tool schemas used to default `base` to `origin/main`. That raw-git-fatals
 * on a first-time clone with no remotes. Same policy as the CLI: prefer a
 * ref that exists, and if nothing does, say so in English instead of
 * dumping `fatal: Needed a single revision`.
 */

import { spawnSync } from 'node:child_process';
import { assertSafeGitRef } from './git-ref.js';
import { readTestedYamlFields } from './tested-config.js';

/** Tried in order after `.tested.yaml` `base` when the caller omits `base`. */
export const LOCAL_BASE_CANDIDATES = [
  'origin/main',
  'origin/master',
  'HEAD~1',
  'HEAD',
] as const;

export const NO_DEFAULT_BASE_MESSAGE =
  'Cannot resolve a default git base. This repository has no origin/main ' +
  '(or other local default) and no commits yet. Pass `base` (for example ' +
  'HEAD, a branch name, or a SHA).';

export function gitRefExists(cwd: string, ref: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
    cwd,
    encoding: 'utf8',
  });
  return result.status === 0;
}

export function pickDefaultBase(opts: {
  configuredBase?: string | null;
  refExists: (ref: string) => boolean;
}): string {
  const seen = new Set<string>();
  const candidates: string[] = [];
  if (opts.configuredBase) candidates.push(opts.configuredBase);
  for (const c of LOCAL_BASE_CANDIDATES) candidates.push(c);

  for (const ref of candidates) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    assertSafeGitRef(ref);
    if (opts.refExists(ref)) return ref;
  }
  throw new Error(NO_DEFAULT_BASE_MESSAGE);
}

/**
 * Resolve the ref passed to `tested diff --base`.
 *
 * An explicit `base` is charset-checked and returned as-is (the CLI still
 * fails if it does not exist; `friendlyGitRefError` rewrites that).
 * When omitted, pick the first existing candidate.
 */
export function resolveToolBase(opts: { cwd: string; base?: string }): string {
  if (opts.base !== undefined) {
    return assertSafeGitRef(opts.base);
  }
  const configured = readTestedYamlFields(opts.cwd).base;
  return pickDefaultBase({
    configuredBase: configured,
    refExists: (ref) => gitRefExists(opts.cwd, ref),
  });
}

const GIT_REF_FAIL_RE =
  /unknown revision|bad revision|ambiguous argument|needed a single revision|invalid object name|not a valid object name/i;

/**
 * Turn a raw git-fatal from `tested` into a sentence the caller can act on.
 * Returns null when the failure is not a missing-ref problem.
 */
export function friendlyGitRefError(
  stderrOrMessage: string,
  base?: string,
): string | null {
  if (!GIT_REF_FAIL_RE.test(stderrOrMessage)) return null;
  const ref = base ? `"${base}"` : 'the requested base';
  return (
    `git ref ${ref} does not exist in this repository. ` +
    `Pass a ref that exists (HEAD, HEAD~1, a local branch) or fetch the remote.`
  );
}
