/**
 * server-tools.test.ts — Unit assertions on the in-process server's tool registry.
 *
 * Uses an in-memory MCP client/server pair via InMemoryTransport so we can
 * snapshot the tools/list response shape without spawning the built binary.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { MCP_VERSION } from '../src/version.js';
import { makeTmpGitRepo } from './helpers/tmp-git.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/flake-slow.junit.xml', import.meta.url)),
  'utf8',
);

interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

let client: Client;
let tools: ListedTool[] = [];

beforeAll(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.1' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const result = await client.listTools();
  tools = result.tools as unknown as ListedTool[];
});

afterAll(async () => {
  await client.close();
});

describe('serverInfo', () => {
  it('reports the package version, not a hardcoded 0.0.1', async () => {
    const info = client.getServerVersion();
    expect(info?.version).toBe(MCP_VERSION);
    expect(info?.version).not.toBe('0.0.1');
    expect(info?.name).toBe('tested-mcp');
  });
});

interface CallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

const READ_ONLY_TOOLS = new Set([
  'check',
  'doctor',
  'explain_line',
  'get_coverage_summary',
  'get_flakes',
  'get_performance',
  'get_uncovered_diff',
]);

describe('tools/list shape', () => {
  it('exposes the coverage and CLI-wrapper tools with snake_case names', () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'check',
      'doctor',
      'explain_line',
      'get_coverage_summary',
      'get_flakes',
      'get_performance',
      'get_uncovered_diff',
      'push',
      'write_and_verify',
    ]);
  });

  it('every tool has an outputSchema', () => {
    for (const tool of tools) {
      expect(tool.outputSchema, `${tool.name} missing outputSchema`).toBeDefined();
      expect(tool.outputSchema).toHaveProperty('type', 'object');
    }
  });

  it('read-only tools advertise read-only annotations', () => {
    for (const tool of tools) {
      if (!READ_ONLY_TOOLS.has(tool.name)) continue;
      expect(tool.annotations, `${tool.name} missing annotations`).toBeDefined();
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.annotations?.idempotentHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(false);
    }
  });

  it('write_and_verify advertises destructive write annotations', () => {
    const tool = tools.find((t) => t.name === 'write_and_verify');
    expect(tool, 'write_and_verify not registered').toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    expect(tool?.annotations?.destructiveHint).toBe(true);
    expect(tool?.annotations?.idempotentHint).toBe(false);
    expect(tool?.annotations?.openWorldHint).toBe(false);
  });

  it('write_and_verify describes testRunner from .tested.yaml', () => {
    const tool = tools.find((t) => t.name === 'write_and_verify');
    expect(tool?.description).toMatch(/testRunner/);
    expect(tool?.description).toMatch(/vitest/);
  });

  it('push advertises open-world write annotations', () => {
    const tool = tools.find((t) => t.name === 'push');
    expect(tool, 'push not registered').toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    expect(tool?.annotations?.openWorldHint).toBe(true);
  });
});

describe('tool execution error handling', () => {
  it('get_uncovered_diff returns isError:true on a bad cwd, not a protocol error', async () => {
    const raw = await client.callTool({
      name: 'get_uncovered_diff',
      arguments: { cwd: '/no/such/dir-xyzzy', base: 'HEAD' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.type).toBe('text');
    expect(result.content?.[0]?.text).toMatch(/does not exist/);
  });

  it('explain_line returns isError:true on a bad cwd', async () => {
    const raw = await client.callTool({
      name: 'explain_line',
      arguments: { cwd: 'relative-not-absolute', location: 'foo.ts:1' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/absolute/);
  });

  it('get_coverage_summary returns isError:true on a bad cwd', async () => {
    const raw = await client.callTool({
      name: 'get_coverage_summary',
      arguments: { cwd: '/no/such/dir-xyzzy', base: 'HEAD' },
    });
    const result = raw as unknown as CallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/does not exist/);
  });
});

describe('get_flakes + get_performance (real JUnit fixture)', () => {
  const prevJunit = process.env['TESTED_JUNIT'];
  beforeAll(() => {
    delete process.env['TESTED_JUNIT'];
  });
  afterAll(() => {
    if (prevJunit === undefined) delete process.env['TESTED_JUNIT'];
    else process.env['TESTED_JUNIT'] = prevJunit;
  });

  it('return real flake and duration numbers from a fixture with a flake and a slow test', async () => {
    const cwd = makeTmpGitRepo();
    writeFileSync(join(cwd, 'junit.xml'), FIXTURE);

    const flakesRaw = await client.callTool({
      name: 'get_flakes',
      arguments: { cwd },
    });
    const flakes = flakesRaw as unknown as CallResult & {
      structuredContent?: Record<string, unknown>;
    };
    expect(flakes.isError).toBeFalsy();
    const flakeBody = flakes.structuredContent as {
      found: boolean;
      tests: number;
      failed: number;
      flaky: number;
      flakes: Array<{ name: string; attempts: number; durationMs: number }>;
      failures: Array<{ name: string; durationMs: number }>;
    };
    expect(flakeBody.found).toBe(true);
    expect(flakeBody.tests).toBe(5);
    expect(flakeBody.failed).toBe(1);
    expect(flakeBody.flaky).toBe(1);
    expect(flakeBody.flakes[0]?.name).toBe('retry me');
    expect(flakeBody.flakes[0]?.attempts).toBe(2);
    expect(flakeBody.flakes[0]?.durationMs).toBe(130);
    expect(flakeBody.failures.some((f) => f.name === 'login fail')).toBe(true);
    expect(JSON.stringify(flakeBody).toLowerCase()).not.toMatch(/mock/);

    const perfRaw = await client.callTool({
      name: 'get_performance',
      arguments: { cwd },
    });
    const perf = perfRaw as unknown as CallResult & {
      structuredContent?: Record<string, unknown>;
    };
    expect(perf.isError).toBeFalsy();
    const perfBody = perf.structuredContent as {
      found: boolean;
      durationMs: number;
      slowest: Array<{ name: string; durationMs: number }>;
    };
    expect(perfBody.found).toBe(true);
    expect(perfBody.durationMs).toBe(1630);
    expect(perfBody.slowest[0]?.name).toBe('big');
    expect(perfBody.slowest[0]?.durationMs).toBe(1200);
    expect(JSON.stringify(perfBody).toLowerCase()).not.toMatch(/mock/);
  });

  it('missing junit is a quiet structured miss and never says mock', async () => {
    const cwd = makeTmpGitRepo();
    for (const name of ['get_flakes', 'get_performance'] as const) {
      const raw = await client.callTool({ name, arguments: { cwd } });
      const result = raw as unknown as CallResult & {
        structuredContent?: Record<string, unknown>;
      };
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent?.found).toBe(false);
      const text = JSON.stringify(result);
      expect(text.toLowerCase()).not.toMatch(/mock/);
    }
  });
});
