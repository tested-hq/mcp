/**
 * In-process handler success/error paths with tool implementations mocked.
 * Complements server-tools.test.ts (registry + real error paths).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const explain = vi.hoisted(() => vi.fn());
const getUncoveredDiff = vi.hoisted(() => vi.fn());
const getSummary = vi.hoisted(() => vi.fn());
const writeAndVerify = vi.hoisted(() => vi.fn());
const check = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const doctor = vi.hoisted(() => vi.fn());

vi.mock('../src/tools/explain.js', () => ({ explain }));
vi.mock('../src/tools/get_uncovered_diff.js', () => ({ getUncoveredDiff }));
vi.mock('../src/tools/get_summary.js', () => ({ getSummary }));
vi.mock('../src/tools/write_and_verify.js', () => ({ writeAndVerify }));
vi.mock('../src/tools/check.js', () => ({ check }));
vi.mock('../src/tools/push.js', () => ({ push }));
vi.mock('../src/tools/doctor.js', () => ({ doctor }));

const { createServer } = await import('../src/server.js');

interface CallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

let client: Client;

beforeAll(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'handler-client', version: '0.0.1' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('registered tool handlers', () => {
  it('get_uncovered_diff returns structuredContent on success', async () => {
    getUncoveredDiff.mockResolvedValueOnce({
      files: [{ path: 'src/a.ts', ranges: [{ start: 1, end: 2, kind: 'line' }] }],
    });
    const raw = await client.callTool({
      name: 'get_uncovered_diff',
      arguments: { cwd: '/repo', base: 'HEAD' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.files).toHaveLength(1);
    expect(result.content?.[0]?.text).toContain('src/a.ts');
  });

  it('explain_line returns structuredContent on success', async () => {
    explain.mockResolvedValueOnce({
      path: 'src/a.ts',
      line: 4,
      uncovered: false,
      reason: 'hit 2 times',
      codeExcerpt: '4  export const x = 1;',
    });
    const raw = await client.callTool({
      name: 'explain_line',
      arguments: { cwd: '/repo', location: 'src/a.ts:4' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      path: 'src/a.ts',
      line: 4,
      uncovered: false,
    });
  });

  it('get_coverage_summary returns structuredContent on success', async () => {
    getSummary.mockResolvedValueOnce({
      patch: { executable: 4, covered: 4, pct: 100 },
      project: { executable: 10, covered: 9, pct: 90 },
      files: [{ path: 'src/a.ts', lines: { total: 10, covered: 9, pct: 90 } }],
    });
    const raw = await client.callTool({
      name: 'get_coverage_summary',
      arguments: { cwd: '/repo', base: 'origin/main' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.project).toMatchObject({ pct: 90 });
  });

  it('write_and_verify returns structuredContent on success', async () => {
    writeAndVerify.mockResolvedValueOnce({
      bytesWritten: 12,
      success: true,
      vitestStderr: null,
      diff: { files: [] },
    });
    const raw = await client.callTool({
      name: 'write_and_verify',
      arguments: {
        cwd: '/repo',
        base: 'HEAD',
        path: 'tests/foo.test.ts',
        content: 'export {}',
      },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      bytesWritten: 12,
      success: true,
      vitestStderr: null,
    });
  });

  it('write_and_verify returns isError:true when the tool throws', async () => {
    writeAndVerify.mockRejectedValueOnce(new Error('path resolves outside cwd'));
    const raw = await client.callTool({
      name: 'write_and_verify',
      arguments: {
        cwd: '/repo',
        path: '../escape.ts',
        content: 'x',
      },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/outside/);
  });

  it('maps a non-Error throw to isError:true', async () => {
    getUncoveredDiff.mockRejectedValueOnce('raw-string-fail');
    const raw = await client.callTool({
      name: 'get_uncovered_diff',
      arguments: { cwd: '/repo' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toBe('raw-string-fail');
  });

  it('check returns structuredContent on success', async () => {
    check.mockResolvedValueOnce({
      patch: { pct: 90, threshold: 80, pass: true },
      project: { pct: 92, threshold: 90, pass: true },
      overall: 'pass',
    });
    const raw = await client.callTool({
      name: 'check',
      arguments: { cwd: '/repo', base: 'HEAD' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ overall: 'pass' });
  });

  it('push returns isError:true when the tool throws', async () => {
    push.mockRejectedValueOnce(new Error('push requires a token argument'));
    const raw = await client.callTool({
      name: 'push',
      arguments: { cwd: '/repo', mainline: true },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/token/);
  });

  it('doctor returns structuredContent on success', async () => {
    doctor.mockResolvedValueOnce({
      schemaVersion: 1,
      ok: true,
      checks: [{ id: 'node', label: 'Node.js', status: 'pass', detail: 'v24' }],
    });
    const raw = await client.callTool({
      name: 'doctor',
      arguments: { cwd: '/repo' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ ok: true });
  });
});
