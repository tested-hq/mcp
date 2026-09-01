import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findCoverageEntry,
  loadCoverageMap,
  parseCoverageMap,
  statementStats,
  testsCoveringLine,
  uncoveredBranchRanges,
} from '../src/coverage-json.js';
import { makeTmpGitRepo } from './helpers/tmp-git.js';

describe('coverage-json', () => {
  it('returns null for invalid JSON and non-objects', () => {
    expect(parseCoverageMap('not-json')).toBeNull();
    expect(parseCoverageMap('[]')).toBeNull();
    expect(loadCoverageMap(makeTmpGitRepo())).toBeNull();
  });

  it('parses file:// paths and statement stats', () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    const abs = join(cwd, 'src', 'a.ts');
    writeFileSync(abs, 'export const a = 1;\n');
    const data = parseCoverageMap(
      JSON.stringify({
        [abs]: {
          path: `file://${abs}`,
          statementMap: {
            '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
          },
          s: { '0': 1 },
        },
      }),
    );
    expect(data).not.toBeNull();
    const row = findCoverageEntry(cwd, data!, 'src/a.ts');
    expect(row?.rel).toBe('src/a.ts');
    expect(statementStats(row!.entry)).toEqual({ total: 1, covered: 1, pct: 100 });
  });

  it('reads tests[] as a per-test map', () => {
    const entry = {
      statementMap: {
        '0': { start: { line: 4, column: 0 }, end: { line: 4, column: 8 } },
      },
      s: { '0': 1 },
      tests: [
        { name: 'covers line', lines: [4] },
        { name: 'via statements', s: { '0': 1 } },
        { name: 'miss', s: { '0': 0 } },
      ],
    };
    expect(testsCoveringLine(entry, 4)).toEqual(['covers line', 'via statements']);
    expect(testsCoveringLine({ statementMap: {}, s: {} }, 1)).toBeNull();
  });

  it('falls back to loc when locations are empty and ignores bad file://', () => {
    const ranges = uncoveredBranchRanges({
      branchMap: {
        '0': {
          loc: { start: { line: 9, column: 0 }, end: { line: 9, column: 2 } },
        },
      },
      b: { '0': [0] },
    });
    expect(ranges).toEqual([{ start: 9, end: 9, kind: 'branch' }]);

    const cwd = makeTmpGitRepo();
    const data = parseCoverageMap(
      JSON.stringify({
        x: { path: 'file://%E0%A4%A', statementMap: {}, s: {} },
      }),
    );
    expect(findCoverageEntry(cwd, data!, 'nope.ts')).toBeNull();
  });

  it('emits uncovered branch ranges from branchMap', () => {
    const ranges = uncoveredBranchRanges({
      branchMap: {
        '0': {
          loc: { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
          locations: [
            { start: { line: 2, column: 0 }, end: { line: 2, column: 4 } },
            { start: { line: 3, column: 0 }, end: { line: 3, column: 4 } },
          ],
        },
      },
      b: { '0': [1, 0] },
    });
    expect(ranges).toEqual([{ start: 3, end: 3, kind: 'branch' }]);
  });
});
