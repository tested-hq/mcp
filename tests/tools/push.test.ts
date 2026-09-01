import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/cli.js', () => ({
  runCli: vi.fn(),
}));

const { envForPushCli, push, resolvePushToken, MISSING_PUSH_TOKEN_MESSAGE } =
  await import('../../src/tools/push.js');
const { runCli } = await import('../../src/cli.js');
const runCliMock = vi.mocked(runCli);

beforeEach(() => {
  runCliMock.mockReset();
});

function repoWithCommits(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-push-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Dev'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), '1\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'c1'], { cwd: dir });
  return dir;
}

describe('resolvePushToken', () => {
  it('prefers the explicit argument over env', () => {
    expect(
      resolvePushToken({ token: 'from-arg', env: { TESTED_TOKEN: 'from-env' } }),
    ).toBe('from-arg');
  });

  it('uses TESTED_TOKEN from the MCP process env', () => {
    expect(resolvePushToken({ env: { TESTED_TOKEN: '  env-token  ' } })).toBe(
      'env-token',
    );
  });

  it('throws when neither argument nor TESTED_TOKEN is set', () => {
    expect(() => resolvePushToken({ env: {} })).toThrow(MISSING_PUSH_TOKEN_MESSAGE);
  });

  it('reads TESTED_TOKEN from process.env when env is omitted', () => {
    const prev = process.env['TESTED_TOKEN'];
    process.env['TESTED_TOKEN'] = 'proc-token';
    try {
      expect(resolvePushToken({})).toBe('proc-token');
    } finally {
      if (prev === undefined) delete process.env['TESTED_TOKEN'];
      else process.env['TESTED_TOKEN'] = prev;
    }
  });
});

describe('envForPushCli', () => {
  it('re-adds only the ingest token after sanitizeChildEnv', () => {
    const env = envForPushCli('ingest-secret', {
      TESTED_TOKEN: 'host-secret',
      GITHUB_TOKEN: 'gh',
      PATH: '/usr/bin',
    });
    expect(env.TESTED_TOKEN).toBe('ingest-secret');
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('push', () => {
  it('passes the token via child env, not argv, and does not use host TESTED_TOKEN as-is', async () => {
    runCliMock.mockResolvedValueOnce({ shareUrl: 'https://app.tested.dev/s/x' });
    const cwd = repoWithCommits();
    const prev = process.env['TESTED_TOKEN'];
    process.env['TESTED_TOKEN'] = 'host-token';
    try {
      const result = await push({ cwd, token: 'arg-token', mainline: true });
      expect(result.shareUrl).toMatch(/tested\.dev/);
      const [args, opts] = runCliMock.mock.calls[0] ?? [];
      expect(args).toContain('--json');
      expect(args).toContain('--mainline');
      expect(args).not.toContain('--token');
      expect(opts?.env?.TESTED_TOKEN).toBe('arg-token');
    } finally {
      if (prev === undefined) delete process.env['TESTED_TOKEN'];
      else process.env['TESTED_TOKEN'] = prev;
    }
  });

  it('forwards pr, owner, name, and an explicit base', async () => {
    runCliMock.mockResolvedValueOnce({ shareUrl: 'https://app.tested.dev/s/y' });
    const cwd = repoWithCommits();
    await push({
      cwd,
      token: 't',
      pr: '12',
      owner: 'acme',
      name: 'app',
      base: 'HEAD',
    });
      expect(runCliMock).toHaveBeenCalledWith(
      [
        'push',
        '--json',
        '--base',
        'HEAD',
        '--pr',
        '12',
        '--owner',
        'acme',
        '--name',
        'app',
      ],
      expect.objectContaining({ cwd, allowNonZero: true }),
    );
  });

  it('forwards a safe junit path as --junit', async () => {
    runCliMock.mockResolvedValueOnce({ shareUrl: 'https://app.tested.dev/s/z' });
    const cwd = repoWithCommits();
    writeFileSync(join(cwd, 'junit.xml'), '<testsuite/>');
    await push({ cwd, token: 't', mainline: true, junit: 'junit.xml' });
    expect(runCliMock).toHaveBeenCalledWith(
      ['push', '--json', '--base', expect.any(String), '--mainline', '--junit', 'junit.xml'],
      expect.objectContaining({ cwd, allowNonZero: true }),
    );
  });

  it('rejects a junit path that escapes cwd', async () => {
    const cwd = repoWithCommits();
    await expect(
      push({ cwd, token: 't', mainline: true, junit: '../escape.xml' }),
    ).rejects.toThrow(/outside/);
    expect(runCliMock).not.toHaveBeenCalled();
  });
});
