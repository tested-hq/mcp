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
 *
 * outputSchema is similarly a raw shape (from `.shape` on the zod object).
 * Clients use it to validate structuredContent.
 *
 * annotations advertise tool behavior to clients so safer auto-approve UX
 * is possible. All three tools are read-only file-system inspectors.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { explain } from './tools/explain.js';
import { getUncoveredDiff } from './tools/get_uncovered_diff.js';
import { getSummary } from './tools/get_summary.js';
import { writeAndVerify } from './tools/write_and_verify.js';
import {
  ExplainOutput,
  GetSummaryOutput,
  GetUncoveredDiffOutput,
  WriteAndVerifyOutput,
} from './schemas.js';
import { toErrorResult } from './tool-error.js';

// ── Shared raw shapes ──────────────────────────────────────────────────────

const cwdField = z.string().describe('Absolute path to the repository root.');
const baseField = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_./@~^-]{1,256}$/, {
    message: 'base must be a safe git ref charset',
  })
  .refine((v) => !v.startsWith('-'), { message: 'base must not start with -' })
  .optional()
  .default('origin/main')
  .describe('Git ref to diff against. Defaults to origin/main.');

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

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
        'Call ONCE at the start to see what is uncovered, and at most ONCE after write_and_verify to confirm closure.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
      },
      outputSchema: GetUncoveredDiffOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, base }) => {
      try {
        const result = await getUncoveredDiff({ cwd, base });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // ── explain_line ─────────────────────────────────────────────────────────
  server.registerTool(
    'explain_line',
    {
      title: 'Explain coverage for a line',
      description:
        'Returns whether a specific line is covered and why, plus a code excerpt. ' +
        'Use ONLY when you need source context AND coverage state together for one specific line. ' +
        'Provide the location as "relative/path/to/file.ts:42".',
      inputSchema: {
        cwd: cwdField,
        location: z
          .string()
          .describe('File and line in the form "path/to/file.ts:42".'),
      },
      outputSchema: ExplainOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, location }) => {
      try {
        const result = await explain({ cwd, location });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // ── get_coverage_summary ─────────────────────────────────────────────────
  server.registerTool(
    'get_coverage_summary',
    {
      title: 'Get coverage summary',
      description:
        'Returns a per-file line-count summary (total, covered, pct) for all files in the diff, ' +
        'plus rolled-up patch and project statistics. ' +
        'Use ONLY when you need rolled-up totals; for per-line gap analysis prefer get_uncovered_diff.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
      },
      outputSchema: GetSummaryOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, base }) => {
      try {
        const result = await getSummary({ cwd, base });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // ── write_and_verify ─────────────────────────────────────────────────────
  server.registerTool(
    'write_and_verify',
    {
      title: 'Write a test file and re-verify coverage',
      description:
        'Write the test file AND re-run coverage in one call. Returns success+diff on pass, ' +
        'or vitestStderr on failure. ALWAYS prefer this over a separate write + get_uncovered_diff sequence.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
        path: z
          .string()
          .describe('Path to the test file, relative to cwd, e.g. "tests/foo.test.ts".'),
        content: z.string().describe('Complete contents of the test file (overwrites existing).'),
      },
      outputSchema: WriteAndVerifyOutput.shape,
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ cwd, base, path, content }) => {
      try {
        const result = await writeAndVerify({ cwd, base, path, content });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  return server;
}
