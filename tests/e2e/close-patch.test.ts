/**
 * Runtime close-patch skill: uncovered patch lines → map → write_and_verify → check.
 * Uses a real vitest fixture and the @tested/cli binary.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';
import {
  CLOSED_MATH_TEST,
  addUncoveredMul,
  commitAll,
  initMainRepo,
  linkWorkspaceNodeModules,
  runVitestCoverage,
  writeMathPackage,
} from './helpers.js';

interface CallResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallResult> {
  const raw = await client.callTool({ name, arguments: args });
  return raw as unknown as CallResult;
}

describe('e2e: close-patch skill loop', () => {
  const prev = process.env['TESTED_JUNIT'];
  beforeEach(() => {
    delete process.env['TESTED_JUNIT'];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env['TESTED_JUNIT'];
    else process.env['TESTED_JUNIT'] = prev;
  });

  it('writes a test for uncovered patch lines and tested check passes', async () => {
    const cwd = initMainRepo();
    linkWorkspaceNodeModules(cwd);
    writeMathPackage(cwd);
    commitAll(cwd, 'covered add');
    addUncoveredMul(cwd);
    commitAll(cwd, 'uncovered mul');
    runVitestCoverage(cwd);

    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'close-patch-e2e', version: '0.0.1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const uncovered = await call(client, 'get_uncovered_diff', { cwd, base: 'HEAD~1' });
      expect(uncovered.isError).toBeFalsy();
      const files = uncovered.structuredContent?.files as Array<{
        path: string;
        ranges: Array<{ start: number; end: number }>;
      }>;
      expect(files.some((f) => f.path === 'src/math.js' && f.ranges.length > 0)).toBe(true);

      const mapped = await call(client, 'map_uncovered_to_test', { cwd, base: 'HEAD~1' });
      expect(mapped.isError).toBeFalsy();
      const mappings = mapped.structuredContent?.mappings as Array<{
        source: string;
        testFile: string;
        existing: boolean;
      }>;
      const mathMap = mappings.find((m) => m.source === 'src/math.js');
      expect(mathMap?.testFile).toBe('tests/math.test.js');
      expect(mathMap?.existing).toBe(true);

      const written = await call(client, 'write_and_verify', {
        cwd,
        base: 'HEAD~1',
        path: mathMap!.testFile,
        content: CLOSED_MATH_TEST,
      });
      expect(written.isError).toBeFalsy();
      expect(written.structuredContent?.success).toBe(true);
      expect(JSON.stringify(written.structuredContent).toLowerCase()).not.toMatch(/mock/);

      const checked = await call(client, 'check', { cwd, base: 'HEAD~1' });
      expect(checked.isError).toBeFalsy();
      expect(checked.structuredContent?.overall).toBe('pass');
      expect(JSON.stringify(checked.structuredContent).toLowerCase()).not.toMatch(/mock/);
    } finally {
      await client.close();
    }
  }, 90_000);
});
