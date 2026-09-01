import { runCli } from '../cli.js';
import {
  coverageEntries,
  loadCoverageMap,
  uncoveredBranchRanges,
} from '../coverage-json.js';
import { gitDiffNameOnly } from '../git-at.js';
import { applyPayloadCap, maybeWarnPayloadSize } from '../payload-cap.js';
import { resolveToolBase } from '../resolve-base.js';
import {
  CliDiffOutputSchema,
  UncoveredBranchesInput,
  UncoveredBranchesOutput,
} from '../schemas.js';
import { validateCwd } from '../validate-cwd.js';

/**
 * Uncovered branches in the patch. Prefer `kind: branch` ranges from
 * `tested diff --json`; if the CLI only emits lines, parse Istanbul
 * `branchMap` / `b` for the same files.
 */
export async function uncoveredBranches(
  input: UncoveredBranchesInput,
): Promise<UncoveredBranchesOutput> {
  await validateCwd(input.cwd);
  const base = resolveToolBase({
    cwd: input.cwd,
    ...(input.base !== undefined ? { base: input.base } : {}),
  });

  let cliFiles: Array<{
    path: string;
    ranges: Array<{ start: number; end: number; kind: 'line' | 'branch' | 'function' }>;
  }> = [];
  try {
    const raw = await runCli(['diff', '--base', base, '--json'], { cwd: input.cwd });
    const parsed = CliDiffOutputSchema.parse(raw);
    cliFiles = parsed.files.map((f) => ({
      path: f.path,
      ranges: f.uncoveredRanges.filter((r) => r.kind === 'branch'),
    }));
  } catch {
    cliFiles = [];
  }

  const fromCli = cliFiles.filter((f) => f.ranges.length > 0);
  if (fromCli.length > 0) {
    const result = applyPayloadCap({
      found: true,
      source: 'cli' as const,
      files: fromCli,
    });
    maybeWarnPayloadSize('uncovered_branches', JSON.stringify(result).length);
    return result;
  }

  const loaded = loadCoverageMap(input.cwd);
  if (!loaded) {
    return {
      found: false,
      reason: 'tested diff had no kind:branch ranges and coverage-final.json is missing',
      files: [],
    };
  }

  const patchFiles = new Set([
    ...cliFiles.map((f) => f.path),
    ...gitDiffNameOnly(input.cwd, base),
  ]);

  const files: UncoveredBranchesOutput['files'] = [];
  for (const row of coverageEntries(input.cwd, loaded.data)) {
    if (patchFiles.size > 0 && !patchFiles.has(row.rel)) continue;
    const ranges = uncoveredBranchRanges(row.entry);
    if (ranges.length === 0) continue;
    files.push({ path: row.rel, ranges });
  }

  if (files.length === 0) {
    return {
      found: false,
      source: 'coverage',
      reason: 'no uncovered branches in the patch coverage',
      files: [],
    };
  }

  const result = applyPayloadCap({
    found: true,
    source: 'coverage' as const,
    files,
  });
  maybeWarnPayloadSize('uncovered_branches', JSON.stringify(result).length);
  return result;
}
