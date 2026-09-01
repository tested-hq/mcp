import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { uncoveredBranches } from '../../src/tools/uncovered_branches.js';
import { commitAll, initMainRepo, writeRepoFile } from './helpers.js';

describe('e2e: uncovered_branches', () => {
  it('parses Istanbul branchMap when CLI has no kind:branch ranges', async () => {
    const cwd = initMainRepo();
    writeRepoFile(
      cwd,
      'src/branch.js',
      `export function pick(n) {
  return n > 0 ? 'pos' : 'neg';
}
`,
    );
    writeRepoFile(cwd, '.tested.yaml', 'base: HEAD~1\n');
    commitAll(cwd, 'base');
    writeRepoFile(
      cwd,
      'src/branch.js',
      `export function pick(n) {
  return n > 0 ? 'pos' : 'neg';
}
export const extra = 1;
`,
    );
    commitAll(cwd, 'patch');

    const abs = join(cwd, 'src', 'branch.js');
    mkdirSync(join(cwd, 'coverage'), { recursive: true });
    writeFileSync(
      join(cwd, 'coverage', 'coverage-final.json'),
      JSON.stringify({
        [abs]: {
          path: abs,
          statementMap: {
            '0': { start: { line: 2, column: 0 }, end: { line: 2, column: 30 } },
            '1': { start: { line: 4, column: 0 }, end: { line: 4, column: 20 } },
          },
          s: { '0': 1, '1': 1 },
          branchMap: {
            '0': {
              loc: { start: { line: 2, column: 9 }, end: { line: 2, column: 28 } },
              locations: [
                { start: { line: 2, column: 16 }, end: { line: 2, column: 21 } },
                { start: { line: 2, column: 24 }, end: { line: 2, column: 28 } },
              ],
            },
          },
          b: { '0': [1, 0] },
        },
      }),
    );

    const result = await uncoveredBranches({ cwd, base: 'HEAD~1' });
    expect(result.found).toBe(true);
    expect(result.source).toBe('coverage');
    expect(result.files.some((f) => f.path === 'src/branch.js')).toBe(true);
    const file = result.files.find((f) => f.path === 'src/branch.js');
    expect(file?.ranges.some((r) => r.kind === 'branch' && r.start === 2)).toBe(true);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/mock/);
  });
});
