import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/cli.js', () => ({
  runCli: vi.fn(),
}));

const { check } = await import('../../src/tools/check.js');
const { runCli } = await import('../../src/cli.js');
const runCliMock = vi.mocked(runCli);

beforeEach(() => {
  runCliMock.mockReset();
});

function repoWithCommits(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-check-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Dev'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), '1\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'c1'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), '2\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'c2'], { cwd: dir });
  return dir;
}

describe('check', () => {
  it('forwards --json and a resolved base to the CLI', async () => {
    runCliMock.mockResolvedValueOnce({
      patch: { pct: 90, threshold: 80, pass: true },
      project: { pct: 92, threshold: 90, pass: true },
      overall: 'pass',
    });
    const cwd = repoWithCommits();
    const result = await check({ cwd });
    expect(result.overall).toBe('pass');
    expect(runCliMock).toHaveBeenCalledWith(
      ['check', '--json', '--base', 'HEAD~1'],
      expect.objectContaining({ cwd, allowNonZero: true }),
    );
  });

  it('returns skipped when the CLI prints no JSON', async () => {
    runCliMock.mockRejectedValueOnce(new Error('tested output is not valid JSON.\nstdout: '));
    const cwd = repoWithCommits();
    const result = await check({ cwd, base: 'HEAD' });
    expect(result.skipped).toBe(true);
    expect(result.detail).toMatch(/not valid JSON/);
  });

  it('rethrows errors that are not a missing JSON payload', async () => {
    runCliMock.mockRejectedValueOnce(new Error('cwd must be an absolute path to a git repository root'));
    const cwd = repoWithCommits();
    await expect(check({ cwd, base: 'HEAD' })).rejects.toThrow(/absolute path/);
  });
});
