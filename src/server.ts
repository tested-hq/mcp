/**
 * server.ts — MCP server setup and tool registration.
 *
 * Three tools are exposed:
 *   coverage.get_uncovered_diff — uncovered line ranges in the current diff
 *   coverage.explain            — coverage status for a specific line
 *   coverage.get_summary        — per-file line-count summary for the diff
 *
 * Tool names use dot notation which is supported by the SDK; some hosts
 * display them as "coverage > get_uncovered_diff" etc.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { explain } from './tools/explain.js';
import { getUncoveredDiff } from './tools/get_uncovered_diff.js';
import { getSummary } from './tools/get_summary.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'tested-mcp',
    version: '0.0.1',
  });

  // ── coverage.get_uncovered_diff ──────────────────────────────────────────
  server.registerTool(
    'coverage.get_uncovered_diff',
    {
      title: 'Get uncovered diff',
      description:
        'Returns the uncovered line/branch/function ranges for every file in the current diff. ' +
        'Use this to understand which code added in the current branch lacks test coverage.',
      inputSchema: z.object({
        cwd: z.string().describe('Absolute path to the repository root.'),
        base: z
          .string()
          .optional()
          .default('origin/main')
          .describe('Git ref to diff against. Defaults to origin/main.'),
      }),
      outputSchema: z.object({
        files: z.array(
          z.object({
            path: z.string(),
            ranges: z.array(
              z.object({
                start: z.number().int(),
                end: z.number().int(),
                kind: z.enum(['line', 'branch', 'function']),
              }),
            ),
          }),
        ),
      }),
    },
    async ({ cwd, base }) => {
      const result = await getUncoveredDiff({ cwd, base: base ?? 'origin/main' });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  // ── coverage.explain ─────────────────────────────────────────────────────
  server.registerTool(
    'coverage.explain',
    {
      title: 'Explain coverage for a line',
      description:
        'Returns whether a specific line is covered and why, plus a code excerpt. ' +
        'Provide the location as "relative/path/to/file.ts:42".',
      inputSchema: z.object({
        cwd: z.string().describe('Absolute path to the repository root.'),
        location: z
          .string()
          .describe('File and line in the form "path/to/file.ts:42".'),
      }),
      outputSchema: z.object({
        path: z.string(),
        line: z.number().int(),
        uncovered: z.boolean(),
        reason: z.string(),
        codeExcerpt: z.string(),
      }),
    },
    async ({ cwd, location }) => {
      const result = await explain({ cwd, location });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  // ── coverage.get_summary ─────────────────────────────────────────────────
  server.registerTool(
    'coverage.get_summary',
    {
      title: 'Get coverage summary',
      description:
        'Returns a per-file line-count summary (total, covered, pct) for all files in the diff, ' +
        'plus rolled-up patch and project statistics.',
      inputSchema: z.object({
        cwd: z.string().describe('Absolute path to the repository root.'),
        base: z
          .string()
          .optional()
          .default('origin/main')
          .describe('Git ref to diff against. Defaults to origin/main.'),
      }),
      outputSchema: z.object({
        patch: z.object({
          executable: z.number().int(),
          covered: z.number().int(),
          pct: z.number(),
        }),
        project: z.object({
          executable: z.number().int(),
          covered: z.number().int(),
          pct: z.number(),
        }),
        files: z.array(
          z.object({
            path: z.string(),
            lines: z.object({
              total: z.number().int(),
              covered: z.number().int(),
              pct: z.number(),
            }),
          }),
        ),
      }),
    },
    async ({ cwd, base }) => {
      const result = await getSummary({ cwd, base: base ?? 'origin/main' });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  return server;
}
