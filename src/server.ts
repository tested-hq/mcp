/**
 * server.ts — MCP server setup and tool registration.
 *
 * Tools:
 *   get_uncovered_diff    — uncovered line ranges in the current diff
 *   explain_line          — coverage status for a specific line
 *   get_coverage_summary  — per-file line-count summary for the diff
 *   get_flakes            — Tests-tab flake / failure analytics from JUnit
 *   get_performance       — Performance-tab duration / slowest from JUnit
 *   get_failed            — failed tests from the same TestReport (alreadyFlaky)
 *   coverage_for          — patch coverage filtered to requested paths
 *   new_since_main        — coverage/junit delta vs git base
 *   who_covers            — tests that execute a line (or available:false)
 *   duration_delta        — suite/per-test duration vs base junit
 *   uncovered_branches    — uncovered branch ranges in the patch
 *   map_uncovered_to_test — colocate / nearest *.test.* for uncovered files
 *   write_and_verify      — write a test file and re-run coverage
 *   check                 — patch / project coverage gate
 *   push                  — upload coverage to tested.dev
 *   doctor                — local environment diagnostics
 *
 * Skills (MCP prompts + tested://skills/* resources):
 *   triage                — CI red → tests vs flake vs holes
 *   close-patch           — uncovered ranges → write_and_verify → check
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
import { getFlakes } from './tools/get_flakes.js';
import { getPerformance } from './tools/get_performance.js';
import { getFailed } from './tools/get_failed.js';
import { coverageFor } from './tools/coverage_for.js';
import { newSinceMain } from './tools/new_since_main.js';
import { whoCovers } from './tools/who_covers.js';
import { durationDelta } from './tools/duration_delta.js';
import { uncoveredBranches } from './tools/uncovered_branches.js';
import { mapUncoveredToTest } from './tools/map_uncovered_to_test.js';
import { writeAndVerify } from './tools/write_and_verify.js';
import { check } from './tools/check.js';
import { push } from './tools/push.js';
import { doctor } from './tools/doctor.js';
import { registerSkills } from './skills.js';
import {
  CheckOutput,
  CoverageForOutput,
  DoctorOutput,
  DurationDeltaOutput,
  ExplainOutput,
  GetFailedOutput,
  GetFlakesOutput,
  GetPerformanceOutput,
  GetSummaryOutput,
  GetUncoveredDiffOutput,
  MapUncoveredToTestOutput,
  NewSinceMainOutput,
  PushOutput,
  UncoveredBranchesOutput,
  WhoCoversOutput,
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
const junitField = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Path to JUnit XML (relative to cwd, or absolute under cwd). If omitted, uses TESTED_JUNIT or auto-detects junit.xml, test-results/junit.xml, coverage/junit.xml, reports/junit.xml — same as the CLI.',
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

  // ── get_flakes ───────────────────────────────────────────────────────────
  server.registerTool(
    'get_flakes',
    {
      title: 'Get flake and failure analytics',
      description:
        'Returns flake and failure counts from a local JUnit report — the same TestReport ' +
        'schema as the tested.dev Tests tab. Intra-run flakes only (fail+pass in one XML, or flaky=true). ' +
        'Read-only; does not gate the PR. When no JUnit file is found, returns found:false and empty lists.',
      inputSchema: {
        cwd: cwdField,
        junit: junitField,
      },
      outputSchema: GetFlakesOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, junit }) => {
      try {
        const result = await getFlakes({
          cwd,
          ...(junit !== undefined ? { junit } : {}),
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

  // ── get_performance ──────────────────────────────────────────────────────
  server.registerTool(
    'get_performance',
    {
      title: 'Get suite duration and slowest tests',
      description:
        'Returns suite durationMs and the slowest tests from a local JUnit report — the same ' +
        'TestReport schema as the tested.dev Performance tab. Read-only; does not gate the PR. ' +
        'When no JUnit file is found, returns found:false and an empty slowest list.',
      inputSchema: {
        cwd: cwdField,
        junit: junitField,
      },
      outputSchema: GetPerformanceOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, junit }) => {
      try {
        const result = await getPerformance({
          cwd,
          ...(junit !== undefined ? { junit } : {}),
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
        'The token is not forwarded to the test runner. Optional junit is passed through as --junit.',
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
        junit: junitField,
      },
      outputSchema: PushOutput.shape,
      annotations: PUSH_ANNOTATIONS,
    },
    async ({ cwd, base, token, pr, mainline, owner, name, junit }) => {
      try {
        const result = await push({
          cwd,
          ...(base !== undefined ? { base } : {}),
          ...(token !== undefined ? { token } : {}),
          ...(pr !== undefined ? { pr } : {}),
          ...(mainline !== undefined ? { mainline } : {}),
          ...(owner !== undefined ? { owner } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(junit !== undefined ? { junit } : {}),
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

  // ── get_failed ───────────────────────────────────────────────────────────
  server.registerTool(
    'get_failed',
    {
      title: 'Get failed tests',
      description:
        'Failed tests from the same JUnit TestReport as get_flakes: name, file, message, duration, alreadyFlaky ' +
        '(true if that test is also in flakes[] this run). Quiet miss when no JUnit file is present.',
      inputSchema: {
        cwd: cwdField,
        junit: junitField,
      },
      outputSchema: GetFailedOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, junit }) => {
      try {
        const result = await getFailed({
          cwd,
          ...(junit !== undefined ? { junit } : {}),
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

  // ── coverage_for ─────────────────────────────────────────────────────────
  server.registerTool(
    'coverage_for',
    {
      title: 'Coverage for paths',
      description:
        'Patch coverage for the files the agent touched. Filter of `tested diff --json` files[] ' +
        '(same CliFileSchema as get_uncovered_diff / get_coverage_summary). Only requested paths are returned.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
        paths: z
          .array(z.string().min(1))
          .min(1)
          .describe('Source paths relative to cwd to keep from the coverage diff.'),
      },
      outputSchema: CoverageForOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, base, paths }) => {
      try {
        const result = await coverageFor({
          cwd,
          paths,
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

  // ── new_since_main ───────────────────────────────────────────────────────
  server.registerTool(
    'new_since_main',
    {
      title: 'What changed since base',
      description:
        'Informational delta vs git base (default origin/main): files that lost coverage, tests newly failing/flaky, ' +
        'tests newly in slowest[]. If base junit or coverage is missing, the matching section is a structured miss — never invented.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
        junit: junitField,
      },
      outputSchema: NewSinceMainOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, base, junit }) => {
      try {
        const result = await newSinceMain({
          cwd,
          ...(base !== undefined ? { base } : {}),
          ...(junit !== undefined ? { junit } : {}),
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

  // ── who_covers ───────────────────────────────────────────────────────────
  server.registerTool(
    'who_covers',
    {
      title: 'Which tests cover a line',
      description:
        'Which tests execute this line, from V8/Istanbul coverage-final.json. ' +
        'If the file has no per-test hit map, returns available:false and a reason — never invents test names.',
      inputSchema: {
        cwd: cwdField,
        file: z.string().min(1).describe('Source file, relative to cwd.'),
        line: z.number().int().positive().describe('1-based line number.'),
      },
      outputSchema: WhoCoversOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, file, line }) => {
      try {
        const result = await whoCovers({ cwd, file, line });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  // ── duration_delta ───────────────────────────────────────────────────────
  server.registerTool(
    'duration_delta',
    {
      title: 'Duration delta vs base',
      description:
        'Suite duration and per-test delta vs base/main JUnit. Maps the suite change to the tests that caused it. ' +
        'If base junit is not in git, returns found:false with a reason — never invents timings.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
        junit: junitField,
      },
      outputSchema: DurationDeltaOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, base, junit }) => {
      try {
        const result = await durationDelta({
          cwd,
          ...(base !== undefined ? { base } : {}),
          ...(junit !== undefined ? { junit } : {}),
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

  // ── uncovered_branches ───────────────────────────────────────────────────
  server.registerTool(
    'uncovered_branches',
    {
      title: 'Uncovered branches in the patch',
      description:
        'Uncovered branches in the patch, not only lines. Exposes kind:branch ranges from `tested diff --json` ' +
        'when present; otherwise parses Istanbul branchMap for the same files.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
      },
      outputSchema: UncoveredBranchesOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, base }) => {
      try {
        const result = await uncoveredBranches({
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

  // ── map_uncovered_to_test ────────────────────────────────────────────────
  server.registerTool(
    'map_uncovered_to_test',
    {
      title: 'Map uncovered files to a test file',
      description:
        'Given uncovered source files (or get_uncovered_diff), return the existing colocated `*.test.*` / `__tests__` file ' +
        'they should land in. Used by the close-patch skill. Does not guess when a conventional file already exists.',
      inputSchema: {
        cwd: cwdField,
        base: baseField,
        paths: z
          .array(z.string().min(1))
          .optional()
          .describe('Source files to map. If omitted, uses files from get_uncovered_diff.'),
      },
      outputSchema: MapUncoveredToTestOutput.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ cwd, base, paths }) => {
      try {
        const result = await mapUncoveredToTest({
          cwd,
          ...(base !== undefined ? { base } : {}),
          ...(paths !== undefined ? { paths } : {}),
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

  registerSkills(server);
  return server;
}
