import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/cli.js', () => ({
  runCli: vi.fn(),
}));

const { doctor } = await import('../../src/tools/doctor.js');
const { runCli } = await import('../../src/cli.js');
const runCliMock = vi.mocked(runCli);

beforeEach(() => {
  runCliMock.mockReset();
});

describe('doctor', () => {
  it('calls tested doctor --json', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mcp-doctor-'));
    execFileSync('git', ['init', '-q'], { cwd });
    runCliMock.mockResolvedValueOnce({
      schemaVersion: 1,
      ok: true,
      checks: [{ id: 'git', label: 'Git repo', status: 'pass', detail: cwd }],
    });
    const result = await doctor({ cwd });
    expect(result.ok).toBe(true);
    expect(runCliMock).toHaveBeenCalledWith(
      ['doctor', '--json'],
      expect.objectContaining({ cwd, allowNonZero: true }),
    );
  });
});
