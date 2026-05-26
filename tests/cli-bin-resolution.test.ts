import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN_ABS = resolve(__dirname, '../../cli/dist/tested.js');

describe('TESTED_BIN resolution', () => {
  beforeAll(() => {
    // Ensure the module under test has *some* valid resolution path.
    // In CI without the sibling cli/, this test file only runs the
    // source-level assertion below.
    if (!process.env['TESTED_BIN'] && existsSync(CLI_BIN_ABS)) {
      process.env['TESTED_BIN'] = CLI_BIN_ABS;
    }
  });

  it('does not contain a developer-specific hardcoded absolute path in the source', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'cli.ts'), 'utf8');
    // No /Users/<name>/ or /home/<name>/ literal hardcoded in the resolver.
    expect(src).not.toMatch(/['"`]\/Users\/[a-zA-Z0-9_-]+\//);
    expect(src).not.toMatch(/['"`]\/home\/[a-zA-Z0-9_-]+\//);
  });

  it('resolves to a path ending in tested.js when resolvable', async () => {
    // Dynamic import so beforeAll-set env vars take effect.
    const mod = await import('../src/cli.js');
    expect(mod.TESTED_BIN).toMatch(/tested\.js$/);
  });

  it('points to a file that exists on disk when resolvable', async () => {
    const { access } = await import('node:fs/promises');
    const mod = await import('../src/cli.js');
    await expect(access(mod.TESTED_BIN)).resolves.toBeUndefined();
  });
});
