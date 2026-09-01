import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/cli.js', () => ({
  runCli: vi.fn().mockRejectedValue(new Error('no cli')),
}));

const { uncoveredBranches } = await import('../../src/tools/uncovered_branches.js');
import { makeTmpGitRepo } from '../helpers/tmp-git.js';

describe('uncoveredBranches miss paths', () => {
  it('exposes kind:branch ranges from the CLI when present', async () => {
    const { runCli } = await import('../../src/cli.js');
    vi.mocked(runCli).mockResolvedValueOnce({
      schemaVersion: 1,
      base: 'HEAD',
      head: 'abc',
      patch: { executable: 1, covered: 0, pct: 0 },
      project: { executable: 1, covered: 0, pct: 0 },
      files: [
        {
          path: 'src/a.ts',
          patchCoverage: 0,
          projectCoverage: 0,
          uncoveredRanges: [{ start: 2, end: 2, kind: 'branch' }],
        },
      ],
    });
    const cwd = makeTmpGitRepo();
    const result = await uncoveredBranches({ cwd, base: 'HEAD' });
    expect(result.found).toBe(true);
    expect(result.source).toBe('cli');
    expect(result.files[0]?.ranges[0]).toEqual({ start: 2, end: 2, kind: 'branch' });
  });

  it('reports a structured miss when CLI fails and coverage is absent', async () => {
    const cwd = makeTmpGitRepo();
    const result = await uncoveredBranches({ cwd, base: 'HEAD' });
    expect(result.found).toBe(false);
    expect(result.reason).toMatch(/coverage-final.json is missing/);
    expect(result.files).toEqual([]);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/mock/);
  });
});
