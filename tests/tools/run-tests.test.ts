import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn };
});

const { runTestsWithCoverage, MAX_CAPTURE_BYTES } = await import(
  '../../src/tools/run-tests.js'
);

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  (child as { stdout: EventEmitter }).stdout = new EventEmitter();
  (child as { stderr: EventEmitter }).stderr = new EventEmitter();
  child.kill = vi.fn(() => true);
  return child;
}

afterEach(() => {
  spawn.mockReset();
});

describe('runTestsWithCoverage', () => {
  it('returns success when the runner exits 0', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);
    const pending = runTestsWithCoverage({ cwd: '/tmp' });
    child.stdout!.emit('data', Buffer.from('ok\n'));
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({
      success: true,
      stdout: 'ok\n',
      stderr: '',
    });
    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['vitest', 'run', '--coverage', '--coverage.reporter=json'],
      expect.objectContaining({ cwd: '/tmp', env: expect.any(Object) }),
    );
  });

  it('does not forward TESTED_TOKEN to the test runner', async () => {
    const prev = process.env['TESTED_TOKEN'];
    process.env['TESTED_TOKEN'] = 'must-not-reach-vitest';
    try {
      const child = fakeChild();
      spawn.mockReturnValue(child);
      const pending = runTestsWithCoverage({ cwd: '/tmp' });
      child.emit('close', 0);
      await pending;
      const spawnOpts = spawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
      expect(spawnOpts.env?.TESTED_TOKEN).toBeUndefined();
      expect(spawnOpts.env?.PATH).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env['TESTED_TOKEN'];
      else process.env['TESTED_TOKEN'] = prev;
    }
  });

  it('returns success:false when the runner exits non-zero', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);
    const pending = runTestsWithCoverage({ cwd: '/tmp' });
    child.stderr!.emit('data', Buffer.from('FAIL'));
    child.emit('close', 1);
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.stderr).toBe('FAIL');
  });

  it('treats a timeout as a failed run and SIGTERMs the child', async () => {
    const child = fakeChild();
    child.kill = vi.fn(() => {
      child.emit('close', null);
      return true;
    });
    spawn.mockReturnValue(child);
    const pending = runTestsWithCoverage({ cwd: '/tmp', timeoutMs: 20 });
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/timed out after 20ms/);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('is best-effort when kill throws on timeout', async () => {
    const child = fakeChild();
    child.kill = vi.fn(() => {
      setImmediate(() => child.emit('close', null));
      throw new Error('gone');
    });
    spawn.mockReturnValue(child);
    const result = await runTestsWithCoverage({ cwd: '/tmp', timeoutMs: 15 });
    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/timed out/);
  });

  it('caps captured stdout and stderr', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);
    const pending = runTestsWithCoverage({ cwd: '/tmp' });
    child.stdout!.emit('data', Buffer.alloc(MAX_CAPTURE_BYTES, 0x61));
    child.stdout!.emit('data', Buffer.from('DROPPED'));
    child.stderr!.emit('data', Buffer.alloc(MAX_CAPTURE_BYTES, 0x62));
    child.stderr!.emit('data', Buffer.from('DROPPED'));
    child.emit('close', 0);
    const result = await pending;
    expect(result.stdout.length).toBe(MAX_CAPTURE_BYTES);
    expect(result.stderr.length).toBe(MAX_CAPTURE_BYTES);
    expect(result.stdout.includes('DROPPED')).toBe(false);
    expect(result.stderr.includes('DROPPED')).toBe(false);
  });

  it('keeps a partial last chunk when the cap is hit mid-buffer', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);
    const pending = runTestsWithCoverage({ cwd: '/tmp' });
    child.stdout!.emit('data', Buffer.from('HEAD'));
    child.stdout!.emit(
      'data',
      Buffer.concat([Buffer.from('-TAIL'), Buffer.alloc(MAX_CAPTURE_BYTES, 0x78)]),
    );
    child.emit('close', 0);
    const result = await pending;
    expect(result.stdout.startsWith('HEAD-TAIL')).toBe(true);
    expect(result.stdout.length).toBe(MAX_CAPTURE_BYTES);
  });

  it('rejects when the runner cannot be spawned', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);
    const pending = runTestsWithCoverage({ cwd: '/tmp' });
    child.emit('error', new Error('ENOENT'));
    await expect(pending).rejects.toThrow(/Failed to spawn test runner/);
  });
});
