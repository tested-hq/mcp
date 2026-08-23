import { describe, expect, it } from 'vitest';
import { toExplainResult, toSummary, toUncoveredDiff } from '../src/reshape.js';
import type { CliDiffOutput, CliExplainOutput } from '../src/schemas.js';

// ── Fixture: a small CLI diff output ───────────────────────────────────────

const FIXTURE_DIFF: CliDiffOutput = {
  schemaVersion: 1,
  base: 'HEAD',
  head: 'abc123',
  patch: { executable: 10, covered: 7, pct: 70 },
  project: { executable: 512, covered: 411, pct: 80.3 },
  files: [
    {
      path: 'src/cli.ts',
      patchCoverage: 100,
      projectCoverage: 100,
      uncoveredRanges: [],
    },
    {
      path: 'src/commands/diff.ts',
      patchCoverage: 17.5,
      projectCoverage: 17.5,
      uncoveredRanges: [
        { start: 19, end: 26, kind: 'line' },
        { start: 28, end: 35, kind: 'line' },
      ],
    },
    {
      path: 'src/commands/explain.ts',
      patchCoverage: 72.5,
      projectCoverage: 72.5,
      uncoveredRanges: [{ start: 74, end: 95, kind: 'line' }],
    },
    {
      path: 'src/commands/run.ts',
      patchCoverage: 0,
      projectCoverage: 0,
      uncoveredRanges: [{ start: 1, end: 5, kind: 'line' }],
    },
  ],
};

// ── toUncoveredDiff ─────────────────────────────────────────────────────────

describe('toUncoveredDiff', () => {
  it('omits fully-covered files', () => {
    const result = toUncoveredDiff(FIXTURE_DIFF);
    const paths = result.files.map((f) => f.path);
    expect(paths).not.toContain('src/cli.ts');
  });

  it('includes files with uncovered ranges', () => {
    const result = toUncoveredDiff(FIXTURE_DIFF);
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain('src/commands/diff.ts');
    expect(paths).toContain('src/commands/explain.ts');
    expect(paths).toContain('src/commands/run.ts');
  });

  it('preserves range start/end/kind', () => {
    const result = toUncoveredDiff(FIXTURE_DIFF);
    const diffFile = result.files.find((f) => f.path === 'src/commands/diff.ts');
    expect(diffFile).toBeDefined();
    expect(diffFile?.ranges).toHaveLength(2);
    expect(diffFile?.ranges[0]).toEqual({ start: 19, end: 26, kind: 'line' });
    expect(diffFile?.ranges[1]).toEqual({ start: 28, end: 35, kind: 'line' });
  });

  it('returns empty files array when all files are covered', () => {
    const allCovered: CliDiffOutput = {
      ...FIXTURE_DIFF,
      files: [{ path: 'src/foo.ts', patchCoverage: 100, projectCoverage: 100, uncoveredRanges: [] }],
    };
    expect(toUncoveredDiff(allCovered).files).toHaveLength(0);
  });
});

// ── toExplainResult ─────────────────────────────────────────────────────────

describe('toExplainResult', () => {
  const FIXTURE_EXPLAIN: CliExplainOutput = {
    path: 'src/cli.ts',
    line: 1,
    uncovered: false,
    reason: 'hit 3 times',
    codeExcerpt: "1  import { Command } from 'commander';",
  };

  it('passes through all fields', () => {
    const result = toExplainResult(FIXTURE_EXPLAIN);
    expect(result.path).toBe('src/cli.ts');
    expect(result.line).toBe(1);
    expect(result.uncovered).toBe(false);
    expect(result.reason).toBe('hit 3 times');
    expect(result.codeExcerpt).toBe("1  import { Command } from 'commander';");
  });

  it('handles uncovered=true case', () => {
    const uncovered: CliExplainOutput = {
      path: 'src/commands/diff.ts',
      line: 42,
      uncovered: true,
      reason: 'not executed',
      codeExcerpt: '42  throw new Error("unreachable");',
    };
    const result = toExplainResult(uncovered);
    expect(result.uncovered).toBe(true);
    expect(result.line).toBe(42);
  });
});

// ── toSummary ───────────────────────────────────────────────────────────────

describe('toSummary', () => {
  it('includes rolled-up patch and project stats', () => {
    const result = toSummary(FIXTURE_DIFF);
    expect(result.patch).toEqual({ executable: 10, covered: 7, pct: 70 });
    expect(result.project).toEqual({ executable: 512, covered: 411, pct: 80.3 });
  });

  it('includes all files (even fully covered)', () => {
    const result = toSummary(FIXTURE_DIFF);
    expect(result.files.map((f) => f.path)).toContain('src/cli.ts');
  });

  it('computes pct from projectCoverage', () => {
    const result = toSummary(FIXTURE_DIFF);
    const diffFile = result.files.find((f) => f.path === 'src/commands/diff.ts');
    expect(diffFile?.lines.pct).toBe(17.5);
  });

  it('fully covered file has covered === total', () => {
    const result = toSummary(FIXTURE_DIFF);
    const cliFile = result.files.find((f) => f.path === 'src/cli.ts');
    // 100% covered, no uncovered ranges
    expect(cliFile?.lines.covered).toBe(cliFile?.lines.total);
  });

  it('0% covered file has covered=0', () => {
    const result = toSummary(FIXTURE_DIFF);
    const runFile = result.files.find((f) => f.path === 'src/commands/run.ts');
    expect(runFile?.lines.covered).toBe(0);
    expect(runFile?.lines.total).toBe(5); // 5 uncovered lines (1-5)
  });

  it('partial coverage approximates total correctly', () => {
    const result = toSummary(FIXTURE_DIFF);
    const explainFile = result.files.find((f) => f.path === 'src/commands/explain.ts');
    // uncoveredLines = 95 - 74 + 1 = 22, pct = 72.5
    // total = round(22 / (1 - 0.725)) = round(22 / 0.275) = round(80) = 80
    expect(explainFile?.lines.total).toBe(80);
    expect(explainFile?.lines.covered).toBe(58); // 80 - 22
  });

  it('treats a null projectCoverage as 0%', () => {
    const raw: CliDiffOutput = {
      ...FIXTURE_DIFF,
      files: [
        {
          path: 'src/unknown.ts',
          patchCoverage: null,
          projectCoverage: null,
          uncoveredRanges: [{ start: 3, end: 6, kind: 'branch' }],
        },
      ],
    };
    const result = toSummary(raw);
    expect(result.files[0]?.lines).toEqual({ total: 4, covered: 0, pct: 0 });
  });

  it('preserves branch and function range kinds in the uncovered diff', () => {
    const raw: CliDiffOutput = {
      ...FIXTURE_DIFF,
      files: [
        {
          path: 'src/kinds.ts',
          patchCoverage: 50,
          projectCoverage: 50,
          uncoveredRanges: [
            { start: 1, end: 1, kind: 'branch' },
            { start: 8, end: 12, kind: 'function' },
          ],
        },
      ],
    };
    expect(toUncoveredDiff(raw).files[0]?.ranges).toEqual([
      { start: 1, end: 1, kind: 'branch' },
      { start: 8, end: 12, kind: 'function' },
    ]);
  });
});
