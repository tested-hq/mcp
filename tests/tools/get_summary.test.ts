import { describe, expect, it, vi } from 'vitest';
import type { CliDiffOutput } from '../../src/schemas.js';

const MOCK_DIFF: CliDiffOutput = {
  schemaVersion: 1,
  base: 'origin/main',
  head: 'abc123',
  patch: { executable: 20, covered: 16, pct: 80 },
  project: { executable: 512, covered: 411, pct: 80.3 },
  files: [
    {
      path: 'src/cli.ts',
      patchCoverage: 100,
      projectCoverage: 100,
      uncoveredRanges: [],
    },
    {
      path: 'src/commands/run.ts',
      patchCoverage: 0,
      projectCoverage: 0,
      uncoveredRanges: [{ start: 1, end: 10, kind: 'line' }],
    },
  ],
};

vi.mock('../../src/cli.js', () => ({
  runCli: vi.fn().mockResolvedValue(MOCK_DIFF),
  TESTED_BIN: '/fake/tested.js',
}));

const { getSummary } = await import('../../src/tools/get_summary.js');

describe('getSummary', () => {
  it('returns patch and project stats', async () => {
    const result = await getSummary({ cwd: '/repo', base: 'origin/main' });
    expect(result.patch).toEqual({ executable: 20, covered: 16, pct: 80 });
    expect(result.project).toEqual({ executable: 512, covered: 411, pct: 80.3 });
  });

  it('includes all files in summary', async () => {
    const result = await getSummary({ cwd: '/repo', base: 'origin/main' });
    expect(result.files.map((f) => f.path)).toContain('src/cli.ts');
    expect(result.files.map((f) => f.path)).toContain('src/commands/run.ts');
  });

  it('0% file has correct covered=0', async () => {
    const result = await getSummary({ cwd: '/repo', base: 'origin/main' });
    const runFile = result.files.find((f) => f.path === 'src/commands/run.ts');
    expect(runFile?.lines.covered).toBe(0);
    expect(runFile?.lines.pct).toBe(0);
  });

  it('rejects an unsafe git ref before calling the CLI', async () => {
    const { runCli } = await import('../../src/cli.js');
    vi.mocked(runCli).mockClear();
    await expect(
      getSummary({ cwd: '/repo', base: 'foo;rm' }),
    ).rejects.toThrow(/invalid/);
    expect(vi.mocked(runCli)).not.toHaveBeenCalled();
  });

  it('rejects CLI JSON that does not match the v1 schema', async () => {
    const { runCli } = await import('../../src/cli.js');
    vi.mocked(runCli).mockResolvedValueOnce({ not: 'a-diff' });
    await expect(getSummary({ cwd: '/repo', base: 'HEAD' })).rejects.toThrow();
  });
});
