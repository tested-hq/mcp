import { describe, expect, it } from 'vitest';
import { toErrorResult, truncate } from '../src/tool-error.js';

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello')).toBe('hello');
  });

  it('caps long strings and marks truncation', () => {
    const long = 'x'.repeat(600);
    const out = truncate(long);
    expect(out.endsWith('…[truncated]')).toBe(true);
    expect(out.length).toBeLessThan(long.length);
    expect(out.startsWith('x'.repeat(500))).toBe(true);
  });

  it('honors a custom max', () => {
    expect(truncate('abcdef', 3)).toBe('abc…[truncated]');
  });
});

describe('toErrorResult', () => {
  it('uses Error.message and sets isError', () => {
    const result = toErrorResult(new Error('cwd does not exist: /tmp/x'));
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'cwd does not exist: /tmp/x' },
    ]);
  });

  it('stringifies non-Error throws', () => {
    const result = toErrorResult('boom');
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('boom');
  });

  it('truncates a very long error message', () => {
    const result = toErrorResult(new Error('e'.repeat(800)));
    expect(result.content[0]?.text?.endsWith('…[truncated]')).toBe(true);
  });
});
