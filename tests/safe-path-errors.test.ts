import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lstat = vi.hoisted(() => vi.fn());
const realpath = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat, realpath };
});

const { assertSafeWritePath, realpathDeepestExisting } = await import(
  '../src/safe-path.js'
);

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mcp-safe-err-'));
  mkdirSync(join(tmpDir, '.git'));
  lstat.mockReset();
  realpath.mockReset();
});

describe('safe-path error passthrough', () => {
  it('rethrows a non-ENOENT error from realpathDeepestExisting', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    realpath.mockRejectedValueOnce(err);
    await expect(realpathDeepestExisting(join(tmpDir, 'x.ts'))).rejects.toThrow(
      /EACCES/,
    );
  });

  it('rethrows a non-ENOENT lstat error during the walk', async () => {
    realpath.mockImplementation(async (p: string) => p);
    const err = Object.assign(new Error('EPERM'), { code: 'EPERM' });
    lstat.mockRejectedValueOnce(err);
    await expect(assertSafeWritePath(tmpDir, 'tests/a.test.ts')).rejects.toThrow(
      /EPERM/,
    );
  });
});
