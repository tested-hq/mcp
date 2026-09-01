import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newSinceMain } from '../../src/tools/new_since_main.js';
import { makeTmpGitRepo } from '../helpers/tmp-git.js';

describe('newSinceMain miss paths', () => {
  it('coverage and junit sections miss independently', async () => {
    const cwd = makeTmpGitRepo();
    const result = await newSinceMain({ cwd, base: 'HEAD' });
    expect(result.coverage.found).toBe(false);
    expect(result.coverage.reason).toMatch(/not found on the working tree/);
    expect(result.junit.found).toBe(false);
    expect(result.junit.reason).toMatch(/no current junit/);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/mock/);
  });

  it('coverage found:false when only the working tree JSON exists', async () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'coverage'), { recursive: true });
    writeFileSync(join(cwd, 'coverage', 'coverage-final.json'), '{}');
    const result = await newSinceMain({ cwd, base: 'HEAD' });
    expect(result.coverage.found).toBe(false);
    expect(result.coverage.reason).toMatch(/base coverage-final.json not found/);
  });
});
