import { describe, expect, it, vi } from 'vitest';
import type { CliDiffOutput } from '../../src/schemas.js';

// ── Mock the cli module before importing the tool ────────────────────────────
const MOCK_DIFF: CliDiffOutput = {
  schemaVersion: 1,
  base: 'origin/main',
  head: 'abc123',
  patch: { executable: 5, covered: 3, pct: 60 },
  project: { executable: 200, covered: 160, pct: 80 },
  files: [
    {
      path: 'src/foo.ts',
      patchCoverage: 50,
      projectCoverage: 50,
      uncoveredRanges: [{ start: 10, end: 15, kind: 'line' }],
    },
    {
      path: 'src/bar.ts',
      patchCoverage: 100,
      projectCoverage: 100,
      uncoveredRanges: [],
    },
  ],
};

vi.mock('../../src/cli.js', () => ({
  runCli: vi.fn().mockResolvedValue(MOCK_DIFF),
  TESTED_BIN: '/fake/tested.js',
}));

const { getUncoveredDiff } = await import('../../src/tools/get_uncovered_diff.js');

describe('getUncoveredDiff', () => {
  it('returns only files with uncovered ranges', async () => {
    const result = await getUncoveredDiff({ cwd: '/repo', base: 'origin/main' });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe('src/foo.ts');
  });

  it('includes correct range data', async () => {
    const result = await getUncoveredDiff({ cwd: '/repo', base: 'origin/main' });
    expect(result.files[0]?.ranges[0]).toEqual({ start: 10, end: 15, kind: 'line' });
  });
});
