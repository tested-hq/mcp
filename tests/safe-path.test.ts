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
