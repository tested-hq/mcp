/**
 * validate-cwd.ts — Defense-in-depth check before spawning a CLI subprocess
 * in a directory supplied by the MCP client.
 *
 * Rejects:
 *   - non-absolute paths
 *   - non-existent paths
 *   - paths that are not directories
 *   - symlinks (avoid traversal via crafted links)
 *   - directories without a `.git/` (we're a coverage tool for git repos;
 *     refusing to run elsewhere narrows the attack surface)
 *
 * Optionally enforces an allowlist via `TESTED_ALLOWED_CWDS=/path1:/path2`.
 *
 * Every error names the rule up front: cwd must be an absolute path to a
 * git repository root (a directory containing `.git/`).
 */

import { access, lstat, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const CWD_RULE =
  'cwd must be an absolute path to a git repository root (a directory containing .git/)';

export async function validateCwd(cwd: string): Promise<void> {
  if (!isAbsolute(cwd)) {
    throw new Error(`${CWD_RULE}; got a relative path: ${cwd}`);
  }

  let st;
  try {
    const lst = await lstat(cwd);
    if (lst.isSymbolicLink()) {
      throw new Error(`${CWD_RULE}; cwd must not be a symlink: ${cwd}`);
    }
    st = await stat(cwd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${CWD_RULE}; this path does not exist: ${cwd}`);
    }
    throw err;
  }

  if (!st.isDirectory()) {
    throw new Error(`${CWD_RULE}; this path is not a directory: ${cwd}`);
  }

  try {
    await access(join(cwd, '.git'));
  } catch {
    throw new Error(`${CWD_RULE}; this path has no .git/: ${cwd}`);
  }

  const allowlist = process.env['TESTED_ALLOWED_CWDS'];
  if (allowlist) {
    const allowed = allowlist
      .split(':')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!allowed.includes(cwd)) {
      throw new Error(`cwd is not in TESTED_ALLOWED_CWDS: ${cwd}`);
    }
  }
}
