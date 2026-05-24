/**
 * reshape.ts — Transforms raw CLI JSON output into MCP tool response shapes.
 *
 * None of these functions perform I/O; they are pure data transformations so
 * they can be unit-tested without spawning subprocesses.
 */

import type {
  CliDiffOutput,
  CliExplainOutput,
  ExplainOutput,
  GetSummaryOutput,
  GetUncoveredDiffOutput,
} from './schemas.js';

/**
 * Reduces the full diff output to only files that have uncovered ranges.
 * Files with zero uncovered ranges are omitted from the result so the agent
 * payload stays lean.
 */
export function toUncoveredDiff(raw: CliDiffOutput): GetUncoveredDiffOutput {
  const files = raw.files
    .filter((f) => f.uncoveredRanges.length > 0)
    .map((f) => ({
      path: f.path,
      ranges: f.uncoveredRanges.map((r) => ({
        start: r.start,
        end: r.end,
        kind: r.kind,
      })),
    }));

  return { files };
}

/**
 * Passes through explain output verbatim — the CLI schema already matches the
 * MCP output schema, but we still convert the type so callers are decoupled
 * from the raw CLI type.
 */
export function toExplainResult(raw: CliExplainOutput): ExplainOutput {
  return {
    path: raw.path,
    line: raw.line,
    uncovered: raw.uncovered,
    reason: raw.reason,
    codeExcerpt: raw.codeExcerpt,
  };
}

/**
 * Produces a per-file line-count summary plus rolled-up patch/project stats.
 *
 * The CLI reports `projectCoverage` as a percentage (0–100).  We back-calculate
 * covered/total from that percentage using `executable` lines as the total when
 * available, falling back to 0 for files where coverage data is absent.
 *
 * Line counts:
 *   total   = file.uncoveredRanges flattened line count + covered lines
 *             (we don't have exact per-file line counts from the CLI, so we
 *             approximate: total = uncovered + covered, where
 *             covered = round(total * pct/100) and total is derived from ranges)
 *
 * Because the CLI does not surface per-file line totals directly, we use a
 * pragmatic approximation:
 *   - uncoveredLines = sum of (end - start + 1) for all uncoveredRanges
 *   - if projectCoverage pct is available:
 *       total  = round(uncoveredLines / (1 - pct/100))  when pct < 100
 *       total  = uncoveredLines when pct === 0
 *       total  = uncoveredLines when pct is null/100 with no uncovered lines
 *   - covered = total - uncoveredLines
 */
export function toSummary(raw: CliDiffOutput): GetSummaryOutput {
  const files = raw.files.map((f) => {
    const uncoveredLines = f.uncoveredRanges.reduce(
      (acc, r) => acc + (r.end - r.start + 1),
      0,
    );

    const pct = f.projectCoverage ?? 0;

    let total: number;
    if (pct >= 100) {
      // Fully covered: no uncovered lines, total = uncoveredLines (likely 0)
      total = uncoveredLines;
    } else if (pct <= 0) {
      // Fully uncovered
      total = uncoveredLines;
    } else {
      // total * (1 - pct/100) = uncoveredLines  =>  total = uncoveredLines / (1 - pct/100)
      total = Math.round(uncoveredLines / (1 - pct / 100));
    }

    const covered = Math.max(0, total - uncoveredLines);

    return {
      path: f.path,
      lines: { total, covered, pct },
    };
  });

  return {
    patch: {
      executable: raw.patch.executable,
      covered: raw.patch.covered,
      pct: raw.patch.pct,
    },
    project: {
      executable: raw.project.executable,
      covered: raw.project.covered,
      pct: raw.project.pct,
    },
    files,
  };
}
