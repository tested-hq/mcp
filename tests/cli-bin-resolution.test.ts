import { describe, it, expect, beforeAll, vi } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN_ABS = resolve(__dirname, '../../cli/dist/tested.js');
const CLI_AVAILABLE = existsSync(CLI_BIN_ABS);

describe('TESTED_BIN resolution', () => {
  beforeAll(() => {
    // Ensure the module under test has *some* valid resolution path.
    // In CI without the sibling cli/, the resolver-dependent assertions
    // below are skipped; only the source-level pattern check runs.
    if (!process.env['TESTED_BIN'] && CLI_AVAILABLE) {
      process.env['TESTED_BIN'] = CLI_BIN_ABS;
    }
  });

  it('does not contain a developer-specific hardcoded absolute path in the source', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'cli.ts'), 'utf8');
    // No /Users/<name>/ or /home/<name>/ literal hardcoded in the resolver.
    expect(src).not.toMatch(/['"`]\/Users\/[a-zA-Z0-9_-]+\//);
    expect(src).not.toMatch(/['"`]\/home\/[a-zA-Z0-9_-]+\//);
  });

  it('assertSafeTestedBin rejects relative and empty overrides', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    expect(() => assertSafeTestedBin('relative/tested.js')).toThrow(/absolute/);
    expect(() => assertSafeTestedBin('')).toThrow(/empty/);
    expect(() => assertSafeTestedBin('/abs/tested.js\0')).toThrow(/null/);
    expect(assertSafeTestedBin('/abs/path/tested.js')).toBe('/abs/path/tested.js');
  });

  it('warns on unexpected basename when no prefix policy', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    const warnings: string[] = [];
    expect(
      assertSafeTestedBin('/abs/path/evil.js', {
        env: {},
        warn: (m) => warnings.push(m),
      }),
    ).toBe('/abs/path/evil.js');
    expect(warnings.some((w) => /basename/.test(w))).toBe(true);
  });

  it('hard-fails unexpected basename when TESTED_BIN_ALLOW_PREFIX is set', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    const dir = mkdtempSync(join(tmpdir(), 'tested-bin-'));
    const bin = join(dir, 'evil.js');
    writeFileSync(bin, 'console.log(1)');
    expect(() =>
      assertSafeTestedBin(bin, {
        env: { TESTED_BIN_ALLOW_PREFIX: dir },
      }),
    ).toThrow(/basename/);
  });

  it('enforces TESTED_BIN_ALLOW_PREFIX against realpath', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    const allowed = mkdtempSync(join(tmpdir(), 'tested-bin-ok-'));
    const other = mkdtempSync(join(tmpdir(), 'tested-bin-bad-'));
    const okBin = join(allowed, 'tested.js');
    const badBin = join(other, 'tested.js');
    writeFileSync(okBin, '// ok');
    writeFileSync(badBin, '// bad');

    expect(
      assertSafeTestedBin(okBin, {
        env: { TESTED_BIN_ALLOW_PREFIX: allowed },
      }),
    ).toBe(okBin);

    expect(() =>
      assertSafeTestedBin(badBin, {
        env: { TESTED_BIN_ALLOW_PREFIX: allowed },
      }),
    ).toThrow(/TESTED_BIN_ALLOW_PREFIX/);
  });

  it('accepts basename "tested" under prefix policy', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    const allowed = mkdtempSync(join(tmpdir(), 'tested-bin-plain-'));
    const bin = join(allowed, 'tested');
    writeFileSync(bin, '#!/usr/bin/env node\n');
    expect(
      assertSafeTestedBin(bin, {
        env: { TESTED_BIN_ALLOW_PREFIX: allowed },
      }),
    ).toBe(bin);
  });

  it('resolves symlinks when checking allow prefix', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    const allowed = mkdtempSync(join(tmpdir(), 'tested-bin-real-'));
    const linkDir = mkdtempSync(join(tmpdir(), 'tested-bin-link-'));
    const realBin = join(allowed, 'tested.js');
    writeFileSync(realBin, '// ok');
    const linkBin = join(linkDir, 'tested.js');
    try {
      symlinkSync(realBin, linkBin);
    } catch {
      // platforms without symlink support — skip
      return;
    }
    // Prefix is the real dir; link path should still pass after realpath.
    expect(
      assertSafeTestedBin(linkBin, {
        env: { TESTED_BIN_ALLOW_PREFIX: realpathSync(allowed) },
      }),
    ).toBe(linkBin);
  });

  // Resolution is lazy; tests do not need a placeholder TESTED_BIN.
  it('rejects a whitespace-only override', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    expect(() => assertSafeTestedBin('   ')).toThrow(/empty/);
  });

  it('warns to stderr by default when basename is unexpected', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(assertSafeTestedBin('/abs/path/evil.js', { env: {} })).toBe(
      '/abs/path/evil.js',
    );
    expect(write.mock.calls.some((c) => String(c[0]).includes('basename'))).toBe(
      true,
    );
    write.mockRestore();
  });

  it('treats an empty prefix policy as unset (warn-only basename)', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    const warnings: string[] = [];
    expect(
      assertSafeTestedBin('/abs/path/evil.js', {
        env: { TESTED_BIN_ALLOW_PREFIX: '  :  : ' },
        warn: (m) => warnings.push(m),
      }),
    ).toBe('/abs/path/evil.js');
    expect(warnings.some((w) => /basename/.test(w))).toBe(true);
  });

  it('fails closed when the bin cannot be realpath\'d under a prefix policy', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    expect(() =>
      assertSafeTestedBin('/no/such/tested.js', {
        env: { TESTED_BIN_ALLOW_PREFIX: '/tmp' },
      }),
    ).toThrow(/cannot be resolved/);
  });

  it('skips a missing prefix entry and accepts a later matching one', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    const allowed = mkdtempSync(join(tmpdir(), 'tested-bin-skip-'));
    const bin = join(allowed, 'tested.js');
    writeFileSync(bin, '// ok');
    expect(
      assertSafeTestedBin(bin, {
        env: {
          TESTED_BIN_ALLOW_PREFIX: `/no/such/prefix-xyz:${allowed}`,
        },
      }),
    ).toBe(bin);
  });

  it('accepts a prefix that already ends with a separator', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    const allowed = mkdtempSync(join(tmpdir(), 'tested-bin-sep-'));
    const bin = join(allowed, 'tested.js');
    writeFileSync(bin, '// ok');
    expect(
      assertSafeTestedBin(bin, {
        env: { TESTED_BIN_ALLOW_PREFIX: `${realpathSync(allowed)}/` },
      }),
    ).toBe(bin);
  });

  it('accepts a bin that is exactly the allowed prefix', async () => {
    const { assertSafeTestedBin } = await import('../src/cli.js');
    const allowed = mkdtempSync(join(tmpdir(), 'tested-bin-eq-'));
    const bin = join(allowed, 'tested.js');
    writeFileSync(bin, '// ok');
    expect(
      assertSafeTestedBin(bin, {
        env: { TESTED_BIN_ALLOW_PREFIX: realpathSync(bin) },
      }),
    ).toBe(bin);
  });

  it('resolves to a path ending in tested.js', async () => {
    const mod = await import('../src/cli.js');
    expect(mod.getTestedBin()).toMatch(/tested(\.js)?$/);
  });

  // The on-disk existence check only makes sense when the resolver returned
  // a real path (sibling cli built, or @tested/cli installed, or TESTED_BIN
  // explicitly pointed at a real file). Single-package CI has none of those,
  // so skip — the source-pattern check above already proves the original
  // hardcoded /Users/jorgemodesto path bug is fixed.
  it.skipIf(!CLI_AVAILABLE)('points to a file that exists on disk when resolvable', async () => {
    const { access } = await import('node:fs/promises');
    const mod = await import('../src/cli.js');
    await expect(access(mod.getTestedBin())).resolves.toBeUndefined();
  });
});
