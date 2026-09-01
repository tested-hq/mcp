import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { whoCovers } from '../../src/tools/who_covers.js';
import { makeTmpGitRepo } from '../helpers/tmp-git.js';

describe('whoCovers miss paths', () => {
  it('misses when coverage-final.json is absent', async () => {
    const cwd = makeTmpGitRepo();
    const result = await whoCovers({ cwd, file: 'src/a.ts', line: 1 });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/not found/);
    expect(result.tests).toEqual([]);
  });

  it('misses when the file is not in coverage-final.json', async () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'coverage'), { recursive: true });
    const other = join(cwd, 'src', 'other.ts');
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(other, 'export const o = 1;\n');
    writeFileSync(
      join(cwd, 'coverage', 'coverage-final.json'),
      JSON.stringify({
        [other]: {
          path: other,
          statementMap: {
            '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
          },
          s: { '0': 1 },
        },
      }),
    );
    const result = await whoCovers({ cwd, file: 'src/missing.ts', line: 1 });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/no coverage entry/);
  });
});
