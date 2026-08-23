/**
 * child-tracking.test.ts — verifies trackChild + killAllChildren behavior.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { trackChild, killAllChildren, inFlightCount } from '../src/cli.js';

describe('trackChild / killAllChildren', () => {
  it('removes child from in-flight set when it exits naturally', async () => {
    const before = inFlightCount();
    const c = spawn('node', ['-e', 'setTimeout(()=>{},10)']);
    trackChild(c);
    expect(inFlightCount()).toBe(before + 1);
    await new Promise<void>((resolve) => c.once('exit', () => resolve()));
    // exit handler is async — give microtask queue a tick
    await new Promise((r) => setImmediate(r));
    expect(inFlightCount()).toBe(before);
  });

  it('killAllChildren sends a signal to every tracked child', async () => {
    const before = inFlightCount();
    const c1 = spawn('node', ['-e', 'setTimeout(()=>{},10_000)']);
    const c2 = spawn('node', ['-e', 'setTimeout(()=>{},10_000)']);
    trackChild(c1);
    trackChild(c2);
    expect(inFlightCount()).toBe(before + 2);

    const p1 = new Promise<void>((r) => c1.once('exit', () => r()));
    const p2 = new Promise<void>((r) => c2.once('exit', () => r()));

    killAllChildren('SIGTERM');
    await Promise.all([p1, p2]);
    await new Promise((r) => setImmediate(r));
    expect(inFlightCount()).toBe(before);
  });

  it('swallows kill errors so one dead child cannot abort shutdown', () => {
    const before = inFlightCount();
    const fake = {
      kill() {
        throw new Error('ESRCH');
      },
      once(event: string, cb: () => void) {
        if (event === 'exit') {
          queueMicrotask(cb);
        }
        return fake;
      },
    };
    trackChild(fake as unknown as Parameters<typeof trackChild>[0]);
    expect(inFlightCount()).toBe(before + 1);
    expect(() => killAllChildren('SIGTERM')).not.toThrow();
  });
});
