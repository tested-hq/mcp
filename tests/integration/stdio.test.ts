/**
 * Integration test: spawn the built tested-mcp binary over stdio, perform a
 * real JSON-RPC handshake, list tools, and call get_coverage_summary against
 * the CLI's own repository.
 *
 * Prerequisites:
 *   1. `npm run build` must have been run so dist/tested-mcp.js exists.
 *   2. The CLI repo at ../cli must have a coverage/coverage-final.json
 *      (run `npx vitest run --coverage --coverage.reporter=json` in cli/).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MCP_BIN = resolve(__dirname, '../../dist/tested-mcp.js');
const CLI_REPO = resolve(__dirname, '../../../cli');
const CLI_BIN = resolve(CLI_REPO, 'dist/tested.js');

// Integration tests need the sibling @tested/cli repo to be checked out
// and built. That holds in local dev but not in the per-package CI
// workflow that only checks out this repo.
const CLI_AVAILABLE = existsSync(CLI_BIN);

// The callTool return type has an index signature [x: string]: unknown which
// shadows the typed properties. We use a local interface to recover them.
interface ToolContent {
  type: string;
  text?: string;
}
interface CallToolResult {
  isError?: boolean;
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
}

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  if (!CLI_AVAILABLE) return;
  transport = new StdioClientTransport({
    command: 'node',
    args: [MCP_BIN],
    env: { ...process.env, TESTED_BIN: CLI_BIN },
  });

  client = new Client({ name: 'test-client', version: '0.0.1' });
  await client.connect(transport);
}, 15_000);

afterAll(async () => {
  if (!CLI_AVAILABLE) return;
  await client.close();
}, 10_000);

describe.skipIf(!CLI_AVAILABLE)('stdio integration', () => {
  it('lists the coverage and CLI-wrapper tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'check',
      'coverage_for',
      'doctor',
      'duration_delta',
      'explain_line',
      'get_coverage_summary',
      'get_failed',
      'get_flakes',
      'get_performance',
      'get_uncovered_diff',
      'map_uncovered_to_test',
      'new_since_main',
      'push',
      'uncovered_branches',
      'who_covers',
      'write_and_verify',
    ]);
    console.log('Tool list:', names);
  });

  it('get_coverage_summary returns valid shape against CLI repo', async () => {
    const raw = await client.callTool({
      name: 'get_coverage_summary',
      arguments: {
        cwd: CLI_REPO,
        base: 'HEAD',
      },
    });
    const result = raw as unknown as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);

    const textContent = result.content[0];
    expect(textContent?.type).toBe('text');
    if (textContent?.type !== 'text' || !textContent.text) throw new Error('expected text');

    const payload = JSON.parse(textContent.text) as {
      patch: { executable: number; covered: number; pct: number };
      project: { executable: number; covered: number; pct: number };
      files: Array<{ path: string; lines: { total: number; covered: number; pct: number } }>;
    };

    console.log('get_summary patch:', payload.patch, 'project:', payload.project);
    console.log('files count:', payload.files.length);

    // Structural assertions
    expect(payload).toHaveProperty('patch');
    expect(payload).toHaveProperty('project');
    expect(Array.isArray(payload.files)).toBe(true);
    expect(payload.files.length).toBeGreaterThan(0);

    // src/cli.ts must be in the summary
    const cliFile = payload.files.find((f) => f.path === 'src/cli.ts');
    expect(cliFile).toBeDefined();
    expect(cliFile?.lines).toHaveProperty('total');
    expect(cliFile?.lines).toHaveProperty('covered');
    expect(cliFile?.lines).toHaveProperty('pct');

    // project stats must be numbers
    expect(typeof payload.project.executable).toBe('number');
    expect(typeof payload.project.covered).toBe('number');
    expect(typeof payload.project.pct).toBe('number');

    // structuredContent check
    if (result.structuredContent) {
      expect(result.structuredContent).toHaveProperty('files');
      console.log('structuredContent.files count:', (result.structuredContent as { files: unknown[] }).files.length);
    }
  }, 30_000);

  it('get_uncovered_diff returns valid shape against CLI repo', async () => {
    const raw = await client.callTool({
      name: 'get_uncovered_diff',
      arguments: {
        cwd: CLI_REPO,
        base: 'HEAD',
      },
    });
    const result = raw as unknown as CallToolResult;

    expect(result.isError).toBeFalsy();

    const textContent = result.content[0];
    expect(textContent?.type).toBe('text');
    if (textContent?.type !== 'text' || !textContent.text) throw new Error('expected text');

    const payload = JSON.parse(textContent.text) as {
      files: Array<{
        path: string;
        ranges: Array<{ start: number; end: number; kind: string }>;
      }>;
    };

    expect(Array.isArray(payload.files)).toBe(true);
    console.log('get_uncovered_diff files with ranges:', payload.files.length);
  }, 30_000);

  it('explain_line returns valid shape for a CLI source file', async () => {
    const raw = await client.callTool({
      name: 'explain_line',
      arguments: {
        cwd: CLI_REPO,
        location: 'src/cli.ts:1',
      },
    });
    const result = raw as unknown as CallToolResult;

    expect(result.isError).toBeFalsy();

    const textContent = result.content[0];
    expect(textContent?.type).toBe('text');
    if (textContent?.type !== 'text' || !textContent.text) throw new Error('expected text');

    const payload = JSON.parse(textContent.text) as {
      path: string;
      line: number;
      uncovered: boolean;
      reason: string;
      codeExcerpt: string;
    };

    console.log('explain result:', payload);
    expect(payload.path).toBe('src/cli.ts');
    expect(payload.line).toBe(1);
    expect(typeof payload.uncovered).toBe('boolean');
    expect(typeof payload.reason).toBe('string');
    expect(typeof payload.codeExcerpt).toBe('string');
  }, 30_000);
});
