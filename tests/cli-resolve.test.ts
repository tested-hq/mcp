import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync };
});

describe('resolveTestedBin fallbacks', () => {
  const original = process.env['TESTED_BIN'];

  afterEach(() => {
    if (original === undefined) delete process.env['TESTED_BIN'];
    else process.env['TESTED_BIN'] = original;
    spawnSync.mockReset();
    vi.resetModules();
  });

  it('uses TESTED_BIN when set', async () => {
    process.env['TESTED_BIN'] = '/abs/override/tested.js';
    vi.resetModules();
    const { TESTED_BIN } = await import('../src/cli.js');
    expect(TESTED_BIN).toBe('/abs/override/tested.js');
  });

  it('falls back to `which tested` when the package is not installed', async () => {
    delete process.env['TESTED_BIN'];
    spawnSync.mockReturnValue({ status: 0, stdout: '/usr/local/bin/tested\n' });
    vi.resetModules();
    const { TESTED_BIN } = await import('../src/cli.js');
    expect(TESTED_BIN).toBe('/usr/local/bin/tested');
    expect(spawnSync).toHaveBeenCalledWith('which', ['tested'], { encoding: 'utf8' });
  });

  it('ignores a zero-status which with empty stdout', async () => {
    delete process.env['TESTED_BIN'];
    spawnSync.mockReturnValue({ status: 0, stdout: '   \n' });
    vi.resetModules();
    await expect(import('../src/cli.js')).rejects.toThrow(/Cannot locate/);
  });

  it('throws install instructions when nothing resolves', async () => {
    delete process.env['TESTED_BIN'];
    spawnSync.mockReturnValue({ status: 1, stdout: '' });
    vi.resetModules();
    await expect(import('../src/cli.js')).rejects.toThrow(/pnpm add @tested\/cli/);
  });

  it('throws when which itself throws', async () => {
    delete process.env['TESTED_BIN'];
    spawnSync.mockImplementation(() => {
      throw new Error('which missing');
    });
    vi.resetModules();
    await expect(import('../src/cli.js')).rejects.toThrow(/Cannot locate/);
  });
});
