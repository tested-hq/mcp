/**
 * server.ts — MCP server setup and tool registration.
 *
 * Tools:
 *   get_uncovered_diff    — uncovered line ranges in the current diff
 *   explain_line          — coverage status for a specific line
 *   get_coverage_summary  — per-file line-count summary for the diff
 *   write_and_verify      — write a test file and re-run coverage
 *   check                 — patch / project coverage gate
 *   push                  — upload coverage to tested.dev
 *   doctor                — local environment diagnostics
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
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { explain } from './tools/explain.js';
import { getUncoveredDiff } from './tools/get_uncovered_diff.js';
import { getSummary } from './tools/get_summary.js';
import { writeAndVerify } from './tools/write_and_verify.js';
import { check } from './tools/check.js';
import { push } from './tools/push.js';
import { doctor } from './tools/doctor.js';
import {
  CheckOutput,
  DoctorOutput,
  ExplainOutput,
  GetSummaryOutput,
  GetUncoveredDiffOutput,
  PushOutput,
  WriteAndVerifyOutput,
} from './schemas.js';
import { toErrorResult } from './tool-error.js';
import { MCP_VERSION } from './version.js';

// ── Shared raw shapes ──────────────────────────────────────────────────────

const cwdField = z
  .string()
  .describe(
    'Absolute path to a git repository root (directory containing .git/). Relative paths are rejected.',
  );
const baseField = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_./@~^-]{1,256}$/, {
    message: 'base must be a safe git ref charset',
  })
  .refine((v) => !v.startsWith('-'), { message: 'base must not start with -' })
  .optional()
  .describe(
    'Git ref to diff against. If omitted, uses .tested.yaml base when that ref exists, otherwise origin/main, HEAD~1, or HEAD.',
  );

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

const PUSH_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'tested-mcp',
    version: MCP_VERSION,
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
        const result = await getUncoveredDiff({
          cwd,
          ...(base !== undefined ? { base } : {}),
        });
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
        const result = await getSummary({
          cwd,
          ...(base !== undefined ? { base } : {}),
        });
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
        'or vitestStderr on failure. ALWAYS prefer this over a separate write + get_uncovered_diff sequence. ' +
        'Honors testRunner from .tested.yaml (vitest, jest, or pytest). If unset, runs npx vitest with coverage.',
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
        const result = await writeAndVerify({
          cwd,
          path,
          content,
          ...(base !== undefined ? { base } : {}),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // ── check ────────────────────────────────────────────────────────────────
  server.registerTool(
    'check',
    {
      title: 'Check coverage thresholds',
      description:
        'Runs `tested check --json` against cwd. Returns whether patch and project coverage meet .tested.yaml thresholds.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
      },
      outputSchema: CheckOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, base }) => {
      try {
        const result = await check({
          cwd,
          ...(base !== undefined ? { base } : {}),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // ── push ─────────────────────────────────────────────────────────────────
  server.registerTool(
    'push',
    {
      title: 'Push coverage to tested.dev',
      description:
        'Runs `tested push --json`. Requires a token argument or TESTED_TOKEN in the MCP server environment. ' +
        'The token is not forwarded to the test runner.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
        token: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Ingest token. If omitted, uses TESTED_TOKEN from the MCP server environment.',
          ),
        pr: z.string().optional().describe('PR number. Required unless mainline is true.'),
        mainline: z
          .boolean()
          .optional()
          .describe('Upload default-branch coverage only (no share URL).'),
        owner: z.string().optional(),
        name: z.string().optional(),
      },
      outputSchema: PushOutput.shape,
      annotations: PUSH_ANNOTATIONS,
    },
    async ({ cwd, base, token, pr, mainline, owner, name }) => {
      try {
        const result = await push({
          cwd,
          ...(base !== undefined ? { base } : {}),
          ...(token !== undefined ? { token } : {}),
          ...(pr !== undefined ? { pr } : {}),
          ...(mainline !== undefined ? { mainline } : {}),
          ...(owner !== undefined ? { owner } : {}),
          ...(name !== undefined ? { name } : {}),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // ── doctor ───────────────────────────────────────────────────────────────
  server.registerTool(
    'doctor',
    {
      title: 'Diagnose tested.dev environment',
      description:
        'Runs `tested doctor --json`. Reports Node version, git repo, config, coverage file, origin, and token presence. Never prints secret values.',
      inputSchema: {
        cwd: cwdField,
      },
      outputSchema: DoctorOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd }) => {
      try {
        const result = await doctor({ cwd });
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
