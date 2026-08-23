import { z } from 'zod';
import { SAFE_GIT_REF_RE } from './git-ref.js';

// ─── Shared input fields ───────────────────────────────────────────────────

export const CwdInput = z.object({
  cwd: z
    .string()
    .describe(
      'Absolute path to a git repository root (directory containing .git/). Relative paths are rejected.',
    ),
});

/** Git ref constrained to a safe charset (no leading `-`, max 256). */
export const SafeGitRef = z
  .string()
  .min(1)
  .max(256)
  .regex(SAFE_GIT_REF_RE, {
    message:
      'base must be a safe git ref ([A-Za-z0-9_./@~^-], max 256, no leading -)',
  })
  .refine((v) => !v.startsWith('-'), {
    message: 'base must not start with -',
  });

export const BaseInput = CwdInput.extend({
  base: SafeGitRef.optional().describe(
    'Git ref to diff against (branch, tag, or SHA). If omitted, uses .tested.yaml base when that ref exists, otherwise origin/main, HEAD~1, or HEAD.',
  ),
});

// ─── Tool input schemas ────────────────────────────────────────────────────

export const GetUncoveredDiffInput = BaseInput;
export type GetUncoveredDiffInput = z.infer<typeof GetUncoveredDiffInput>;

export const ExplainInput = CwdInput.extend({
  location: z
    .string()
    .describe('File and line in the form "path/to/file.ts:42".'),
});
export type ExplainInput = z.infer<typeof ExplainInput>;

export const GetSummaryInput = BaseInput;
export type GetSummaryInput = z.infer<typeof GetSummaryInput>;

export const WriteAndVerifyInput = BaseInput.extend({
  path: z
    .string()
    .describe('Path to the test file, relative to cwd, e.g. "tests/foo.test.ts".'),
  content: z.string().describe('Complete contents of the test file (overwrites existing).'),
});
export type WriteAndVerifyInput = z.infer<typeof WriteAndVerifyInput>;

// ─── CLI raw output schema (v1) ────────────────────────────────────────────

export const CliRangeSchema = z.object({
  start: z.number().int(),
  end: z.number().int(),
  kind: z.enum(['line', 'branch', 'function']),
});

export const CliFileSchema = z.object({
  path: z.string(),
  patchCoverage: z.number().nullable(),
  projectCoverage: z.number().nullable(),
  uncoveredRanges: z.array(CliRangeSchema),
});

export const CliPatchSchema = z.object({
  executable: z.number(),
  covered: z.number(),
  pct: z.number(),
});

export const CliProjectSchema = z.object({
  executable: z.number(),
  covered: z.number(),
  pct: z.number(),
  delta: z.number().nullable().optional(),
});

export const CliDiffOutputSchema = z.object({
  schemaVersion: z.literal(1),
  base: z.string(),
  head: z.string(),
  patch: CliPatchSchema,
  project: CliProjectSchema,
  files: z.array(CliFileSchema),
});
export type CliDiffOutput = z.infer<typeof CliDiffOutputSchema>;

export const CliExplainOutputSchema = z.object({
  path: z.string(),
  line: z.number().int(),
  uncovered: z.boolean(),
  reason: z.string(),
  codeExcerpt: z.string(),
});
export type CliExplainOutput = z.infer<typeof CliExplainOutputSchema>;

// ─── Tool output schemas ───────────────────────────────────────────────────

export const RangeSchema = z.object({
  start: z.number().int(),
  end: z.number().int(),
  kind: z.enum(['line', 'branch', 'function']),
});

export const UncoveredDiffFileSchema = z.object({
  path: z.string(),
  ranges: z.array(RangeSchema),
});

export const GetUncoveredDiffOutput = z.object({
  files: z.array(UncoveredDiffFileSchema),
  /** Present when files[] was hard-truncated for payload size / count. */
  truncated: z.boolean().optional(),
});
export type GetUncoveredDiffOutput = z.infer<typeof GetUncoveredDiffOutput>;

export const ExplainOutput = z.object({
  path: z.string(),
  line: z.number().int(),
  uncovered: z.boolean(),
  reason: z.string(),
  codeExcerpt: z.string(),
});
export type ExplainOutput = z.infer<typeof ExplainOutput>;

export const SummaryFileSchema = z.object({
  path: z.string(),
  lines: z.object({
    total: z.number().int(),
    covered: z.number().int(),
    pct: z.number(),
  }),
});

export const CoverageStatsSchema = z.object({
  executable: z.number().int(),
  covered: z.number().int(),
  pct: z.number(),
});

export const GetSummaryOutput = z.object({
  patch: CoverageStatsSchema,
  project: CoverageStatsSchema,
  files: z.array(SummaryFileSchema),
  /** Present when files[] was hard-truncated for payload size / count. */
  truncated: z.boolean().optional(),
});
export type GetSummaryOutput = z.infer<typeof GetSummaryOutput>;

export const WriteAndVerifyOutput = z.object({
  bytesWritten: z.number().int(),
  success: z.boolean(),
  /** Vitest stderr captured when the test run failed. null on success. */
  vitestStderr: z.string().nullable(),
  /** Vitest stdout captured when the test run failed. Omitted on success. */
  vitestStdout: z.string().optional(),
  /** Coverage diff snapshot after the rerun. Omitted on test-runner failure. */
  diff: GetUncoveredDiffOutput.optional(),
});
export type WriteAndVerifyOutput = z.infer<typeof WriteAndVerifyOutput>;

export const CheckInput = BaseInput;
export type CheckInput = z.infer<typeof CheckInput>;

export const CheckOutput = z.object({
  skipped: z.boolean().optional(),
  patch: z
    .object({
      pct: z.number(),
      threshold: z.number(),
      pass: z.boolean(),
      skipped: z.boolean().optional(),
      reason: z.string().optional(),
    })
    .optional(),
  project: z
    .object({
      pct: z.number(),
      threshold: z.number(),
      pass: z.boolean(),
    })
    .optional(),
  overall: z.enum(['pass', 'fail']).optional(),
  note: z.string().optional(),
  detail: z.string().optional(),
});
export type CheckOutput = z.infer<typeof CheckOutput>;

export const PushInput = BaseInput.extend({
  token: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Ingest token. If omitted, uses TESTED_TOKEN from the MCP server environment. Never forwarded to the test runner.',
    ),
  pr: z.string().optional().describe('PR number. Required unless mainline is true.'),
  mainline: z
    .boolean()
    .optional()
    .describe('Upload default-branch coverage only (no share URL).'),
  owner: z.string().optional().describe('Repo owner (default: git remote origin).'),
  name: z.string().optional().describe('Repo name (default: git remote origin).'),
});
export type PushInput = z.infer<typeof PushInput>;

export const PushOutput = z.object({
  shareUrl: z.string().optional(),
  expiresAt: z.string().optional(),
  mainline: z.boolean().optional(),
  date: z.string().optional(),
  projectPct: z.number().optional(),
});
export type PushOutput = z.infer<typeof PushOutput>;

export const DoctorInput = CwdInput;
export type DoctorInput = z.infer<typeof DoctorInput>;

export const DoctorOutput = z.object({
  schemaVersion: z.literal(1),
  ok: z.boolean(),
  checks: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(['pass', 'fail', 'warn', 'skip']),
      detail: z.string(),
      optional: z.boolean().optional(),
    }),
  ),
});
export type DoctorOutput = z.infer<typeof DoctorOutput>;
