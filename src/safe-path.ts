/**
 * safe-path.ts — Path boundary checks for MCP write targets.
 *
 * String-prefix checks on path.resolve alone miss intermediate symlinks
 * (e.g. cwd/tests → /etc). We:
 *   1. Resolve the relative path under cwd (must not be absolute / contain NUL).
 *   2. realpath the deepest existing ancestor; it must stay under realpath(cwd).
 *   3. lstat-walk every path component; if a component is a symlink, its
 *      realpath must also stay under realpath(cwd).
 */

import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

/** True when `candidate` is equal to `root` or a path under it. */
export function isUnderRoot(root: string, candidate: string): boolean {
  const safeRoot = root.endsWith(sep) ? root : root + sep;
  return candidate === root || candidate.startsWith(safeRoot);
}

/**
 * realpath the deepest existing ancestor of `absPath`.
 * Walks parents on ENOENT until a path that exists is found.
 */
export async function realpathDeepestExisting(absPath: string): Promise<string> {
  let current = absPath;
  for (;;) {
    try {
      return await realpath(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = dirname(current);
      if (parent === current) {
        throw new Error(`cannot resolve any existing ancestor of ${absPath}`);
      }
      current = parent;
    }
  }
}

/**
 * Validate that a relative write path stays inside cwd even when intermediate
 * components are symlinks that point outside the tree.
 *
 * @returns Absolute path suitable for writeFile (logical path under cwd).
 */
export async function assertSafeWritePath(
  cwd: string,
  relativePath: string,
): Promise<string> {
  if (isAbsolute(relativePath)) {
    throw new Error(
      `path must be relative to cwd, got absolute: ${relativePath}`,
    );
  }
  if (relativePath.includes('\0')) {
    throw new Error('path must not contain null bytes');
  }

  const logicalRoot = resolve(cwd);
  const logicalTarget = resolve(cwd, relativePath);
  if (!isUnderRoot(logicalRoot, logicalTarget)) {
    throw new Error(
      `path resolves outside cwd: ${logicalTarget} not under ${logicalRoot}${sep}`,
    );
  }

  let realCwd: string;
  try {
    realCwd = await realpath(cwd);
  } catch (err) {
    throw new Error(
      `cwd cannot be realpath'd: ${cwd} (${(err as Error).message})`,
    );
  }

  // realpath deepest existing ancestor of the write target.
  const deep = await realpathDeepestExisting(logicalTarget);
  if (!isUnderRoot(realCwd, deep)) {
    throw new Error(
      `path escapes cwd via symlink or mount: resolved ancestor ${deep} not under ${realCwd}`,
    );
  }

  // lstat walk: refuse any component that is a symlink pointing outside the tree.
  const rel = logicalTarget.slice(logicalRoot.length).replace(/^[/\\]+/, '');
  const parts = rel.split(/[/\\]+/).filter(Boolean);
  let cursor = logicalRoot;

  for (const part of parts) {
    cursor = join(cursor, part);
    let st;
    try {
      st = await lstat(cursor);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Remaining components will be created under an already-verified parent.
        break;
      }
      throw err;
    }

    if (st.isSymbolicLink()) {
      let linkReal: string;
      try {
        linkReal = await realpath(cursor);
      } catch (err) {
        throw new Error(
          `path contains a broken symlink component: ${cursor} (${(err as Error).message})`,
        );
      }
      if (!isUnderRoot(realCwd, linkReal)) {
        throw new Error(
          `path component is a symlink outside cwd: ${cursor} → ${linkReal}`,
        );
      }
    }
  }

  return logicalTarget;
}
