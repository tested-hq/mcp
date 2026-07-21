import { z } from 'zod';
import { SAFE_GIT_REF_RE } from './git-ref.js';

// ─── Shared input fields ───────────────────────────────────────────────────

export const CwdInput = z.object({
  cwd: z.string().describe('Absolute path to the repository root.'),
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
  base: SafeGitRef.optional()
    .default('origin/main')
    .describe('Git ref to diff against (branch, tag, or SHA). Defaults to origin/main.'),
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
