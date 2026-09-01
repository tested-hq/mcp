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
const getFlakes = vi.hoisted(() => vi.fn());
const getPerformance = vi.hoisted(() => vi.fn());
const getFailed = vi.hoisted(() => vi.fn());
const coverageFor = vi.hoisted(() => vi.fn());
const newSinceMain = vi.hoisted(() => vi.fn());
const whoCovers = vi.hoisted(() => vi.fn());
const durationDelta = vi.hoisted(() => vi.fn());
const uncoveredBranches = vi.hoisted(() => vi.fn());
const mapUncoveredToTest = vi.hoisted(() => vi.fn());
const writeAndVerify = vi.hoisted(() => vi.fn());
const check = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const doctor = vi.hoisted(() => vi.fn());

vi.mock('../src/tools/explain.js', () => ({ explain }));
vi.mock('../src/tools/get_uncovered_diff.js', () => ({ getUncoveredDiff }));
vi.mock('../src/tools/get_summary.js', () => ({ getSummary }));
vi.mock('../src/tools/get_flakes.js', () => ({ getFlakes }));
vi.mock('../src/tools/get_performance.js', () => ({ getPerformance }));
vi.mock('../src/tools/get_failed.js', () => ({ getFailed }));
vi.mock('../src/tools/coverage_for.js', () => ({ coverageFor }));
vi.mock('../src/tools/new_since_main.js', () => ({ newSinceMain }));
vi.mock('../src/tools/who_covers.js', () => ({ whoCovers }));
vi.mock('../src/tools/duration_delta.js', () => ({ durationDelta }));
vi.mock('../src/tools/uncovered_branches.js', () => ({ uncoveredBranches }));
vi.mock('../src/tools/map_uncovered_to_test.js', () => ({ mapUncoveredToTest }));
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

  it('check returns isError:true when the tool throws', async () => {
    check.mockRejectedValueOnce(new Error('cwd must be an absolute path to a git repository root'));
    const raw = await client.callTool({
      name: 'check',
      arguments: { cwd: '/repo' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/absolute path/);
  });

  it('doctor returns isError:true when the tool throws', async () => {
    doctor.mockRejectedValueOnce(new Error('cwd must be an absolute path to a git repository root'));
    const raw = await client.callTool({
      name: 'doctor',
      arguments: { cwd: '/repo' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/git repository/);
  });

  it('get_flakes returns structuredContent on success', async () => {
    getFlakes.mockResolvedValueOnce({
      found: true,
      tests: 5,
      failed: 1,
      errors: 0,
      skipped: 1,
      flaky: 1,
      flakes: [{ name: 'retry me', classname: 'auth', durationMs: 130, attempts: 2 }],
      failures: [{ name: 'login fail', classname: 'auth', durationMs: 200 }],
    });
    const raw = await client.callTool({
      name: 'get_flakes',
      arguments: { cwd: '/repo' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ found: true, flaky: 1 });
  });

  it('get_performance returns structuredContent on success', async () => {
    getPerformance.mockResolvedValueOnce({
      found: true,
      durationMs: 1630,
      slowest: [{ name: 'big', classname: 'slow', durationMs: 1200 }],
    });
    const raw = await client.callTool({
      name: 'get_performance',
      arguments: { cwd: '/repo' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ found: true, durationMs: 1630 });
  });

  it('new read tools return structuredContent on success', async () => {
    getFailed.mockResolvedValueOnce({
      found: true,
      failed: [{ name: 'x', durationMs: 1, alreadyFlaky: false }],
    });
    coverageFor.mockResolvedValueOnce({
      files: [{ path: 'src/a.ts', patchCoverage: 50, projectCoverage: 80, uncoveredRanges: [] }],
    });
    newSinceMain.mockResolvedValueOnce({
      base: 'HEAD',
      coverage: { found: false, lost: [], reason: 'missing' },
      junit: { found: false, newlyFailing: [], newlyFlaky: [], newlySlowest: [], reason: 'missing' },
    });
    whoCovers.mockResolvedValueOnce({
      available: false,
      reason: 'no per-test hit map',
      file: 'src/a.ts',
      line: 1,
      tests: [],
    });
    durationDelta.mockResolvedValueOnce({
      found: false,
      reason: 'base junit not found at HEAD',
      tests: [],
    });
    uncoveredBranches.mockResolvedValueOnce({
      found: true,
      source: 'coverage',
      files: [{ path: 'src/a.ts', ranges: [{ start: 2, end: 2, kind: 'branch' }] }],
    });
    mapUncoveredToTest.mockResolvedValueOnce({
      mappings: [
        {
          source: 'src/a.ts',
          testFile: 'src/a.test.ts',
          existing: false,
          convention: 'suggested',
        },
      ],
    });

    const failed = await client.callTool({ name: 'get_failed', arguments: { cwd: '/repo' } });
    expect((failed as unknown as CallResult).structuredContent?.found).toBe(true);

    const cov = await client.callTool({
      name: 'coverage_for',
      arguments: { cwd: '/repo', paths: ['src/a.ts'] },
    });
    expect((cov as unknown as CallResult).structuredContent?.files).toHaveLength(1);

    const since = await client.callTool({ name: 'new_since_main', arguments: { cwd: '/repo' } });
    expect((since as unknown as CallResult).structuredContent?.base).toBe('HEAD');

    const who = await client.callTool({
      name: 'who_covers',
      arguments: { cwd: '/repo', file: 'src/a.ts', line: 1 },
    });
    expect((who as unknown as CallResult).structuredContent?.available).toBe(false);

    const dur = await client.callTool({ name: 'duration_delta', arguments: { cwd: '/repo' } });
    expect((dur as unknown as CallResult).structuredContent?.found).toBe(false);

    const branches = await client.callTool({
      name: 'uncovered_branches',
      arguments: { cwd: '/repo' },
    });
    expect((branches as unknown as CallResult).structuredContent?.source).toBe('coverage');

    const mapped = await client.callTool({
      name: 'map_uncovered_to_test',
      arguments: { cwd: '/repo', paths: ['src/a.ts'] },
    });
    expect((mapped as unknown as CallResult).structuredContent?.mappings).toHaveLength(1);
  });

  it('new read tools return isError:true when the implementation throws', async () => {
    getFailed.mockRejectedValueOnce(new Error('cwd must be an absolute path'));
    const raw = await client.callTool({ name: 'get_failed', arguments: { cwd: '/repo' } });
    expect((raw as unknown as CallResult).isError).toBe(true);
    expect((raw as unknown as CallResult).content?.[0]?.text).toMatch(/absolute/);

    coverageFor.mockRejectedValueOnce(new Error('tested exited with code 1'));
    const cov = await client.callTool({
      name: 'coverage_for',
      arguments: { cwd: '/repo', paths: ['src/a.ts'] },
    });
    expect((cov as unknown as CallResult).isError).toBe(true);

    whoCovers.mockRejectedValueOnce(new Error('cwd must be an absolute path'));
    const who = await client.callTool({
      name: 'who_covers',
      arguments: { cwd: '/repo', file: 'a.ts', line: 1 },
    });
    expect((who as unknown as CallResult).isError).toBe(true);

    durationDelta.mockRejectedValueOnce(new Error('cwd must be an absolute path'));
    expect(
      ((await client.callTool({ name: 'duration_delta', arguments: { cwd: '/repo' } })) as unknown as CallResult)
        .isError,
    ).toBe(true);

    newSinceMain.mockRejectedValueOnce(new Error('cwd must be an absolute path'));
    expect(
      ((await client.callTool({ name: 'new_since_main', arguments: { cwd: '/repo' } })) as unknown as CallResult)
        .isError,
    ).toBe(true);

    uncoveredBranches.mockRejectedValueOnce(new Error('cwd must be an absolute path'));
    expect(
      ((await client.callTool({ name: 'uncovered_branches', arguments: { cwd: '/repo' } })) as unknown as CallResult)
        .isError,
    ).toBe(true);

    mapUncoveredToTest.mockRejectedValueOnce(new Error('cwd must be an absolute path'));
    expect(
      ((await client.callTool({
        name: 'map_uncovered_to_test',
        arguments: { cwd: '/repo' },
      })) as unknown as CallResult).isError,
    ).toBe(true);
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
