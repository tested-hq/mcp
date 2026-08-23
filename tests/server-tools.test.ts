/**
 * server-tools.test.ts — Unit assertions on the in-process server's tool registry.
 *
 * Uses an in-memory MCP client/server pair via InMemoryTransport so we can
 * snapshot the tools/list response shape without spawning the built binary.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { MCP_VERSION } from '../src/version.js';

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
