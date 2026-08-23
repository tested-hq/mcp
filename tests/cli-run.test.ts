import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { makeTmpGitRepo } from './helpers/tmp-git.js';

const spawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn };
});

const { runCli, MAX_CLI_STDOUT_BYTES } = await import('../src/cli.js');

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  (child as { stdout: EventEmitter }).stdout = new EventEmitter();
  (child as { stderr: EventEmitter }).stderr = new EventEmitter();
  child.kill = vi.fn(() => true);
  return child;
}

const repo = makeTmpGitRepo('mcp-runcli-');

afterEach(() => {
  spawn.mockReset();
});

async function startRun(
  args: string[] = ['diff', '--json'],
  opts: { timeoutMs?: number } = {},
): Promise<{
  child: ReturnType<typeof fakeChild>;
  pending: Promise<unknown>;
}> {
  const child = fakeChild();
  spawn.mockReturnValue(child);
  const pending = runCli(args, { cwd: repo, ...opts });
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
  return { child, pending };
}

describe('runCli', () => {
  it('parses JSON stdout on a successful exit', async () => {
    const { child, pending } = await startRun();
    child.stdout!.emit('data', Buffer.from('{"ok":1}\n'));
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({ ok: 1 });
  });

  it('does not forward TESTED_TOKEN to the CLI child', async () => {
    const prev = process.env['TESTED_TOKEN'];
    process.env['TESTED_TOKEN'] = 'must-not-reach-cli';
    try {
      const { child, pending } = await startRun();
      child.stdout!.emit('data', Buffer.from('{"ok":1}\n'));
      child.emit('close', 0);
      await pending;
      const spawnOpts = spawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
      expect(spawnOpts.env).toBeDefined();
      expect(spawnOpts.env?.TESTED_TOKEN).toBeUndefined();
      expect(spawnOpts.env?.PATH).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env['TESTED_TOKEN'];
      else process.env['TESTED_TOKEN'] = prev;
    }
  });

  it('rejects null-byte arguments before spawn', async () => {
    await expect(runCli(['foo\0bar'], { cwd: repo })).rejects.toThrow(/null/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rewrites a missing origin/main git fatal into a friendly error', async () => {
    const { child, pending } = await startRun(['diff', '--base', 'origin/main', '--json']);
    child.stderr!.emit(
      'data',
      Buffer.from(
        "fatal: ambiguous argument 'origin/main': unknown revision or path not in the working tree.",
      ),
    );
    child.emit('close', 128);
    await expect(pending).rejects.toThrow(/does not exist in this repository/);
  });

  it('rejects a non-zero exit and includes truncated streams', async () => {
    const { child, pending } = await startRun();
    child.stderr!.emit('data', Buffer.from('boom-stderr'));
    child.stdout!.emit('data', Buffer.from('boom-stdout'));
    child.emit('close', 2);
    await expect(pending).rejects.toThrow(/exited with code 2/);
  });

  it('rejects invalid JSON on a zero exit', async () => {
    const { child, pending } = await startRun();
    child.stdout!.emit('data', Buffer.from('not-json'));
    child.emit('close', 0);
    await expect(pending).rejects.toThrow(/not valid JSON/);
  });

  it('forwards CLI stderr to the host', async () => {
    const { child, pending } = await startRun();
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    child.stderr!.emit('data', Buffer.from('cli-warning\n'));
    child.stdout!.emit('data', Buffer.from('{"ok":true}'));
    child.emit('close', 0);
    await pending;
    expect(write.mock.calls.some((c) => String(c[0]).includes('cli-warning'))).toBe(
      true,
    );
    write.mockRestore();
  });

  it('times out and kills the child', async () => {
    const child = fakeChild();
    child.kill = vi.fn(() => {
      child.emit('close', null);
      return true;
    });
    spawn.mockReturnValue(child);
    const pending = runCli(['diff'], { cwd: repo, timeoutMs: 20 });
    await expect(pending).rejects.toThrow(/timed out after 20ms/);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('caps captured stdout at MAX_CLI_STDOUT_BYTES', async () => {
    const { child, pending } = await startRun();
    child.stdout!.emit('data', Buffer.alloc(MAX_CLI_STDOUT_BYTES, 0x78));
    child.stdout!.emit('data', Buffer.from('{"this":"is-dropped"}'));
    child.emit('close', 0);
    await expect(pending).rejects.toThrow(/not valid JSON/);
  });

  it('keeps a partial last chunk when the cap is hit mid-buffer', async () => {
    const { child, pending } = await startRun();
    child.stdout!.emit('data', Buffer.from('{"ok":'));
    child.stdout!.emit(
      'data',
      Buffer.concat([Buffer.from('true}'), Buffer.alloc(MAX_CLI_STDOUT_BYTES, 0x20)]),
    );
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('rejects when spawn emits an error', async () => {
    const { child, pending } = await startRun();
    child.emit('error', new Error('ENOENT'));
    await expect(pending).rejects.toThrow(/Failed to spawn tested binary/);
  });

  it('kill during timeout is best-effort when kill throws', async () => {
    const child = fakeChild();
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit('close', null));
      throw new Error('already gone');
    });
    spawn.mockReturnValue(child);
    const pending = runCli(['diff'], { cwd: repo, timeoutMs: 15 });
    await expect(pending).rejects.toThrow(/timed out/);
  });
});
