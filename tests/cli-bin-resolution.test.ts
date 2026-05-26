import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

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

  // The next two tests dynamically import the resolver, which throws in
  // standalone CI without the sibling cli/ checkout. skipIf keeps single-package
  // CI green; the full-tree CI (or any dev tree with cli built) still asserts.
  it.skipIf(!CLI_AVAILABLE && !process.env['TESTED_BIN'])(
    'resolves to a path ending in tested.js when resolvable',
    async () => {
      const mod = await import('../src/cli.js');
      expect(mod.TESTED_BIN).toMatch(/tested\.js$/);
    },
  );

  it.skipIf(!CLI_AVAILABLE && !process.env['TESTED_BIN'])(
    'points to a file that exists on disk when resolvable',
    async () => {
      const { access } = await import('node:fs/promises');
      const mod = await import('../src/cli.js');
      await expect(access(mod.TESTED_BIN)).resolves.toBeUndefined();
    },
  );
});
