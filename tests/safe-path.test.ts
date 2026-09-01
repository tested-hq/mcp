import { describe, it, expect, beforeEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSafeReadPath,
  assertSafeWritePath,
  isUnderRoot,
  realpathDeepestExisting,
} from '../src/safe-path.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mcp-safe-path-'));
  mkdirSync(join(tmpDir, '.git'));
});

describe('isUnderRoot', () => {
  it('accepts the root itself and children', () => {
    expect(isUnderRoot('/repo', '/repo')).toBe(true);
    expect(isUnderRoot('/repo', '/repo/src/a.ts')).toBe(true);
  });

  it('rejects sibling prefix collisions', () => {
    expect(isUnderRoot('/repo', '/repo-evil/x')).toBe(false);
    expect(isUnderRoot('/repo', '/etc/passwd')).toBe(false);
  });
});

describe('assertSafeReadPath', () => {
  it('accepts a relative path and an absolute path under cwd', async () => {
    writeFileSync(join(tmpDir, 'junit.xml'), '<testsuite/>');
    const rel = await assertSafeReadPath(tmpDir, 'junit.xml');
    expect(rel).toBe(join(tmpDir, 'junit.xml'));
    const abs = await assertSafeReadPath(tmpDir, join(tmpDir, 'junit.xml'));
    expect(abs).toBe(join(tmpDir, 'junit.xml'));
  });

  it('rejects an absolute path outside cwd', async () => {
    await expect(assertSafeReadPath(tmpDir, '/etc/passwd')).rejects.toThrow(
      /outside/,
    );
  });
});

describe('assertSafeWritePath', () => {
  it('accepts a normal relative path under cwd', async () => {
    mkdirSync(join(tmpDir, 'tests'));
    const abs = await assertSafeWritePath(tmpDir, 'tests/foo.test.ts');
    expect(abs).toBe(join(tmpDir, 'tests/foo.test.ts'));
  });

  it('rejects absolute paths', async () => {
    await expect(assertSafeWritePath(tmpDir, '/etc/passwd')).rejects.toThrow(
      /absolute/,
    );
  });

  it('rejects .. escapes', async () => {
    await expect(assertSafeWritePath(tmpDir, '../escape.ts')).rejects.toThrow(
      /outside/,
    );
  });

  it('rejects intermediate symlink that points outside the tree', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'mcp-outside-'));
    const linkPath = join(tmpDir, 'tests');
    try {
      symlinkSync(outside, linkPath);
    } catch {
      // Skip on platforms that cannot create symlinks.
      return;
    }

    await expect(
      assertSafeWritePath(tmpDir, 'tests/evil.test.ts'),
    ).rejects.toThrow(/symlink|escapes/i);

    // Ensure we never wrote outside.
    expect(existsSync(join(outside, 'evil.test.ts'))).toBe(false);
  });

  it('rejects when deepest existing ancestor realpath is outside cwd', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'mcp-outside2-'));
    writeFileSync(join(outside, 'seed.txt'), 'x');
    const linkPath = join(tmpDir, 'out');
    try {
      symlinkSync(outside, linkPath);
    } catch {
      return;
    }

    await expect(assertSafeWritePath(tmpDir, 'out/nested/x.ts')).rejects.toThrow(
      /escapes|symlink/i,
    );
  });

  it('allows a symlink that stays inside the tree', async () => {
    mkdirSync(join(tmpDir, 'real-tests'));
    const linkPath = join(tmpDir, 'tests');
    try {
      symlinkSync(join(tmpDir, 'real-tests'), linkPath);
    } catch {
      return;
    }

    const abs = await assertSafeWritePath(tmpDir, 'tests/ok.test.ts');
    expect(abs).toBe(join(tmpDir, 'tests/ok.test.ts'));
  });
});

describe('realpathDeepestExisting', () => {
  it('returns realpath of an existing path', async () => {
    const f = join(tmpDir, 'a.txt');
    writeFileSync(f, 'hi');
    const r = await realpathDeepestExisting(f);
    expect(readFileSync(r, 'utf8')).toBe('hi');
  });

  it('walks up to an existing parent for a missing leaf', async () => {
    const missing = join(tmpDir, 'no', 'such', 'file.ts');
    const r = await realpathDeepestExisting(missing);
    // deepest existing is tmpDir (or an intermediate we didn't create)
    expect(r).toBeTruthy();
  });
});

describe('assertSafeWritePath extra guards', () => {
  it('rejects a path containing a NUL byte', async () => {
    await expect(assertSafeWritePath(tmpDir, 'tests/\0evil.ts')).rejects.toThrow(
      /null/,
    );
  });

  it('rejects a cwd that cannot be realpath\'d', async () => {
    await expect(
      assertSafeWritePath(join(tmpDir, 'missing-cwd'), 'a.ts'),
    ).rejects.toThrow(/realpath/);
  });

  it('rejects a broken symlink component', async () => {
    const linkPath = join(tmpDir, 'broken');
    try {
      symlinkSync(join(tmpDir, 'does-not-exist-target'), linkPath);
    } catch {
      return;
    }
    await expect(assertSafeWritePath(tmpDir, 'broken/x.ts')).rejects.toThrow(
      /broken symlink|escapes/i,
    );
  });

  it('accepts a root that already ends with a separator', () => {
    expect(isUnderRoot('/repo/', '/repo/src/a.ts')).toBe(true);
    expect(isUnderRoot('/repo/', '/repo-evil/a.ts')).toBe(false);
  });
});
