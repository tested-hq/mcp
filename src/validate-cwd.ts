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
 */

import { access, lstat, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export async function validateCwd(cwd: string): Promise<void> {
  if (!isAbsolute(cwd)) {
    throw new Error(`cwd must be an absolute path, got: ${cwd}`);
  }

  let st;
  try {
    const lst = await lstat(cwd);
    if (lst.isSymbolicLink()) {
      throw new Error(`cwd must not be a symlink: ${cwd}`);
    }
    st = await stat(cwd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`cwd does not exist: ${cwd}`);
    }
    throw err;
  }

  if (!st.isDirectory()) {
    throw new Error(`cwd is not a directory: ${cwd}`);
  }

  try {
    await access(join(cwd, '.git'));
  } catch {
    throw new Error(`cwd does not contain a .git/ directory: ${cwd}`);
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
