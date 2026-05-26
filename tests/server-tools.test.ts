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

interface ListedTool {
  name: string;
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

describe('tools/list shape', () => {
  it('exposes exactly three tools with snake_case names', () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'explain_line',
      'get_coverage_summary',
      'get_uncovered_diff',
    ]);
  });

  it('every tool has an outputSchema', () => {
    for (const tool of tools) {
      expect(tool.outputSchema, `${tool.name} missing outputSchema`).toBeDefined();
      expect(tool.outputSchema).toHaveProperty('type', 'object');
    }
  });

  it('every tool has read-only annotations', () => {
    for (const tool of tools) {
      expect(tool.annotations, `${tool.name} missing annotations`).toBeDefined();
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.annotations?.idempotentHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(false);
    }
  });
});
