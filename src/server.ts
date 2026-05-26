/**
 * server.ts — MCP server setup and tool registration.
 *
 * Three tools are exposed:
 *   get_uncovered_diff    — uncovered line ranges in the current diff
 *   explain_line          — coverage status for a specific line
 *   get_coverage_summary  — per-file line-count summary for the diff
 *
 * Tool names use snake_case (no dots). Most MCP clients (Claude Code, Cursor)
 * flatten tool names to `mcp__<server>__<tool>`; dotted names break that
 * flattening. Reference servers (filesystem, github) all use snake_case.
 *
 * inputSchema is passed as a raw Zod shape (Record<string, ZodTypeAny>) so the
 * SDK can infer argument types in the callback via ShapeOutput<Args>. Passing a
 * z.object() wrapper instead would produce unknown callback args.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { explain } from './tools/explain.js';
import { getUncoveredDiff } from './tools/get_uncovered_diff.js';
import { getSummary } from './tools/get_summary.js';

// ── Shared raw shapes ──────────────────────────────────────────────────────

const cwdField = z.string().describe('Absolute path to the repository root.');
const baseField = z
  .string()
  .optional()
  .default('origin/main')
  .describe('Git ref to diff against. Defaults to origin/main.');

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'tested-mcp',
    version: '0.0.1',
  });

  // ── get_uncovered_diff ───────────────────────────────────────────────────
  server.registerTool(
    'get_uncovered_diff',
    {
      title: 'Get uncovered diff',
      description:
        'Returns the uncovered line/branch/function ranges for every file in the current diff. ' +
        'Use this to understand which code added in the current branch lacks test coverage.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
      },
    },
    async ({ cwd, base }) => {
      const result = await getUncoveredDiff({ cwd, base });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    },
  );

  // ── explain_line ─────────────────────────────────────────────────────────
  server.registerTool(
    'explain_line',
    {
      title: 'Explain coverage for a line',
      description:
        'Returns whether a specific line is covered and why, plus a code excerpt. ' +
        'Provide the location as "relative/path/to/file.ts:42".',
      inputSchema: {
        cwd: cwdField,
        location: z
          .string()
          .describe('File and line in the form "path/to/file.ts:42".'),
      },
    },
    async ({ cwd, location }) => {
      const result = await explain({ cwd, location });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    },
  );

  // ── get_coverage_summary ─────────────────────────────────────────────────
  server.registerTool(
    'get_coverage_summary',
    {
      title: 'Get coverage summary',
      description:
        'Returns a per-file line-count summary (total, covered, pct) for all files in the diff, ' +
        'plus rolled-up patch and project statistics.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
      },
    },
    async ({ cwd, base }) => {
      const result = await getSummary({ cwd, base });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    },
  );

  return server;
}
