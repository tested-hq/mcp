import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { whoCovers } from '../../src/tools/who_covers.js';
import { makeTmpGitRepo } from '../helpers/tmp-git.js';

function istanbulNoTestMap(absFile: string): string {
  return JSON.stringify({
    [absFile]: {
      path: absFile,
      statementMap: {
        '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 20 } },
      },
      s: { '0': 1, '1': 0 },
      branchMap: {},
      b: {},
      fnMap: {},
      f: {},
    },
  });
}

function istanbulWithTestMap(absFile: string): string {
  return JSON.stringify({
    [absFile]: {
      path: absFile,
      statementMap: {
        '0': { start: { line: 3, column: 0 }, end: { line: 3, column: 12 } },
      },
      s: { '0': 1 },
      testMap: {
        'tests/math.test.js > math > adds': { s: { '0': 1 } },
        'tests/math.test.js > math > unused': { s: { '0': 0 } },
      },
    },
  });
}

describe('e2e: who_covers', () => {
  it('returns available:false when coverage-final.json has no per-test map', async () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    const src = join(cwd, 'src', 'math.js');
    writeFileSync(src, 'export const x = 1;\nexport const y = 2;\n');
    mkdirSync(join(cwd, 'coverage'), { recursive: true });
    writeFileSync(join(cwd, 'coverage', 'coverage-final.json'), istanbulNoTestMap(src));

    const result = await whoCovers({ cwd, file: 'src/math.js', line: 1 });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/no per-test hit map/);
    expect(result.tests).toEqual([]);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/mock/);
  });

  it('returns real test names when the fixture has a test-to-line map', async () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    const src = join(cwd, 'src', 'math.js');
    writeFileSync(src, 'export function add(a, b) { return a + b; }\n');
    mkdirSync(join(cwd, 'coverage'), { recursive: true });
    writeFileSync(join(cwd, 'coverage', 'coverage-final.json'), istanbulWithTestMap(src));

    const result = await whoCovers({ cwd, file: 'src/math.js', line: 3 });
    expect(result.available).toBe(true);
    expect(result.tests).toEqual(['tests/math.test.js > math > adds']);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/mock/);
  });
});
