import { afterEach, describe, expect, it } from 'vitest';
import {
  MISSING_CLI_INSTALL,
  MISSING_CLI_MESSAGE,
  resolveTestedBin,
} from '../src/cli.js';

describe('resolveTestedBin', () => {
  const original = process.env['TESTED_BIN'];

  afterEach(() => {
    if (original === undefined) delete process.env['TESTED_BIN'];
    else process.env['TESTED_BIN'] = original;
  });

  it('uses TESTED_BIN when set', () => {
    expect(
      resolveTestedBin({
        env: { TESTED_BIN: '/abs/override/tested.js' },
        resolvePackage: () => {
          throw new Error('should not resolve package');
        },
        whichTested: () => {
          throw new Error('should not which');
        },
      }),
    ).toBe('/abs/override/tested.js');
  });

  it('resolves @tested/cli when TESTED_BIN is unset', () => {
    expect(
      resolveTestedBin({
        env: {},
        resolvePackage: () => '/node_modules/@tested/cli/dist/tested.js',
        whichTested: () => null,
      }),
    ).toBe('/node_modules/@tested/cli/dist/tested.js');
  });

  it('falls back to `which tested` when the package is not installed', () => {
    expect(
      resolveTestedBin({
        env: {},
        resolvePackage: () => {
          throw new Error('not found');
        },
        whichTested: () => '/usr/local/bin/tested',
      }),
    ).toBe('/usr/local/bin/tested');
  });

  it('ignores an empty which result and throws the npm i -D line', () => {
    expect(() =>
      resolveTestedBin({
        env: {},
        resolvePackage: () => {
          throw new Error('not found');
        },
        whichTested: () => null,
      }),
    ).toThrow(MISSING_CLI_INSTALL);
  });

  it('does not mention a placeholder TESTED_BIN in the missing-binary error', () => {
    expect(MISSING_CLI_MESSAGE).toContain(MISSING_CLI_INSTALL);
    expect(MISSING_CLI_MESSAGE).not.toMatch(/TESTED_BIN/);
    expect(MISSING_CLI_MESSAGE).not.toMatch(/absolute path of dist\/tested\.js/);
  });
});

describe('cli.ts import without TESTED_BIN', () => {
  it('loads without throwing when TESTED_BIN is unset', async () => {
    const prev = process.env['TESTED_BIN'];
    delete process.env['TESTED_BIN'];
    try {
      const mod = await import('../src/cli.js');
      expect(typeof mod.resolveTestedBin).toBe('function');
      expect(typeof mod.getTestedBin).toBe('function');
    } finally {
      if (prev === undefined) delete process.env['TESTED_BIN'];
      else process.env['TESTED_BIN'] = prev;
    }
  });
});
