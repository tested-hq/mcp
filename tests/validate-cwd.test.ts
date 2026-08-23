import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateCwd } from '../src/validate-cwd.js';

function makeTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tested-cwd-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanups.splice(0)) {
    try {
      fn();
    } catch {
      // best effort
    }
  }
  delete process.env['TESTED_ALLOWED_CWDS'];
});

describe('validateCwd', () => {
  it('accepts a real git repo root', async () => {
    const dir = makeTmpGitRepo();
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    await expect(validateCwd(dir)).resolves.toBeUndefined();
  });

  it('rejects a relative path', async () => {
    await expect(validateCwd('relative/path')).rejects.toThrow(/absolute/);
  });

  it('rejects a non-existent path', async () => {
    await expect(validateCwd('/no/such/dir-xyzzy-tested-mcp')).rejects.toThrow(
      /does not exist/,
    );
  });

  it('rejects a directory without .git/', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-git-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    await expect(validateCwd(dir)).rejects.toThrow(/\.git/);
  });

  it('rejects a path that is a file, not a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'file-cwd-'));
    const file = join(dir, 'a-file');
    writeFileSync(file, 'x');
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    await expect(validateCwd(file)).rejects.toThrow(/not a directory/);
  });

  it('rejects a symlink to a git repo', async () => {
    const real = makeTmpGitRepo();
    const link = real + '-link';
    symlinkSync(real, link);
    cleanups.push(() => {
      rmSync(link, { force: true });
      rmSync(real, { recursive: true, force: true });
    });
    await expect(validateCwd(link)).rejects.toThrow(/symlink/);
  });

  it('respects TESTED_ALLOWED_CWDS allowlist', async () => {
    const dir = makeTmpGitRepo();
    const other = makeTmpGitRepo();
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    });
    process.env['TESTED_ALLOWED_CWDS'] = dir;
    await expect(validateCwd(dir)).resolves.toBeUndefined();
    await expect(validateCwd(other)).rejects.toThrow(/TESTED_ALLOWED_CWDS/);
  });

  it('ignores empty allowlist segments', async () => {
    const dir = makeTmpGitRepo();
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    process.env['TESTED_ALLOWED_CWDS'] = `:${dir}:`;
    await expect(validateCwd(dir)).resolves.toBeUndefined();
  });
});
