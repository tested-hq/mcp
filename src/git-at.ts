/**
 * git-at.ts — Read a file or name-list at a git ref without inventing data.
 *
 * Missing blobs return null. Never fabricate JUnit or coverage.
 */

import { spawnSync } from 'node:child_process';
import { assertSafeGitRef } from './git-ref.js';

const MAX_GIT_BYTES = 8 * 1024 * 1024;

function assertSafeRelPath(relPath: string): string {
  const trimmed = relPath.trim();
  if (!trimmed) {
    throw new Error('git path must not be empty');
  }
  if (trimmed.includes('\0')) {
    throw new Error('git path must not contain null bytes');
  }
  if (trimmed.startsWith('-')) {
    throw new Error('git path must not start with -');
  }
  if (trimmed.startsWith('/') || trimmed.includes('..')) {
    throw new Error(`git path must be a relative path inside the repo: ${trimmed}`);
  }
  return trimmed;
}

/**
 * `git show <ref>:<path>`. Returns null when the blob does not exist
 * (or git fails) — a structured miss for the caller, not an exception.
 */
export function gitShowFile(
  cwd: string,
  ref: string,
  relPath: string,
): string | null {
  const safeRef = assertSafeGitRef(ref);
  const safePath = assertSafeRelPath(relPath);
  const result = spawnSync('git', ['show', `${safeRef}:${safePath}`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_BYTES,
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

/** First existing blob among `relPaths` at `ref`. */
export function gitShowFirst(
  cwd: string,
  ref: string,
  relPaths: readonly string[],
): { path: string; content: string } | null {
  for (const rel of relPaths) {
    const content = gitShowFile(cwd, ref, rel);
    if (content !== null) return { path: rel, content };
  }
  return null;
}

/**
 * Paths that differ between `base` and the working tree (including
 * unstaged). Empty on git failure.
 */
export function gitDiffNameOnly(cwd: string, base: string): string[] {
  const safeRef = assertSafeGitRef(base);
  const result = spawnSync('git', ['diff', '--name-only', safeRef], {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_BYTES,
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
