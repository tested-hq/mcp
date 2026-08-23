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

  it('rejects an unsafe git ref before calling the CLI', async () => {
    const { runCli } = await import('../../src/cli.js');
    vi.mocked(runCli).mockClear();
    await expect(
      getUncoveredDiff({ cwd: '/repo', base: '--output=/tmp/x' }),
    ).rejects.toThrow(/must not start with/);
    expect(vi.mocked(runCli)).not.toHaveBeenCalled();
  });

  it('marks the payload truncated when the CLI returns too many files', async () => {
    const { runCli } = await import('../../src/cli.js');
    const files = Array.from({ length: 250 }, (_, i) => ({
      path: `src/f${i}.ts`,
      patchCoverage: 50,
      projectCoverage: 50,
      uncoveredRanges: [{ start: 1, end: 2, kind: 'line' as const }],
    }));
    vi.mocked(runCli).mockResolvedValueOnce({
      ...MOCK_DIFF,
      files,
    });
    const result = await getUncoveredDiff({ cwd: '/repo', base: 'HEAD' });
    expect(result.truncated).toBe(true);
    expect(result.files.length).toBeLessThanOrEqual(200);
  });

  it('rejects CLI JSON that does not match the v1 schema', async () => {
    const { runCli } = await import('../../src/cli.js');
    vi.mocked(runCli).mockResolvedValueOnce({ schemaVersion: 2 });
    await expect(
      getUncoveredDiff({ cwd: '/repo', base: 'HEAD' }),
    ).rejects.toThrow();
  });
});
