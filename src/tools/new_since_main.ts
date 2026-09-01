import { gitShowFile, gitShowFirst } from '../git-at.js';
import {
  coverageEntries,
  loadCoverageMap,
  parseCoverageMap,
  statementStats,
} from '../coverage-json.js';
import { parseJunitToTestReport, testCaseKey } from '../junit.js';
import { DEFAULT_JUNIT_CANDIDATES, loadTestReport } from '../resolve-junit.js';
import { resolveToolBase } from '../resolve-base.js';
import { NewSinceMainInput, NewSinceMainOutput } from '../schemas.js';
import { validateCwd } from '../validate-cwd.js';

function caseLabel(name: string, classname?: string): string {
  return classname ? `${classname} ${name}` : name;
}

/**
 * Informational delta vs git base (default origin/main via resolveToolBase).
 * Local git + coverage + junit vs base when the blobs exist. Missing base
 * junit is a structured miss — never invented.
 */
export async function newSinceMain(
  input: NewSinceMainInput,
): Promise<NewSinceMainOutput> {
  await validateCwd(input.cwd);
  const base = resolveToolBase({
    cwd: input.cwd,
    ...(input.base !== undefined ? { base: input.base } : {}),
  });

  return {
    base,
    coverage: compareCoverage(input.cwd, base),
    junit: await compareJunit(input.cwd, base, input.junit),
  };
}

function compareCoverage(
  cwd: string,
  base: string,
): NewSinceMainOutput['coverage'] {
  const head = loadCoverageMap(cwd);
  if (!head) {
    return {
      found: false,
      reason: 'coverage-final.json not found on the working tree',
      lost: [],
    };
  }
  const baseRaw =
    gitShowFile(cwd, base, 'coverage/coverage-final.json') ??
    gitShowFile(cwd, base, 'coverage-final.json');
  if (baseRaw === null) {
    return {
      found: false,
      reason: `base coverage-final.json not found at ${base}`,
      lost: [],
    };
  }
  const baseMap = parseCoverageMap(baseRaw);
  if (!baseMap) {
    return {
      found: false,
      reason: `base coverage-final.json at ${base} is not valid JSON`,
      lost: [],
    };
  }

  const before = new Map(
    coverageEntries(cwd, baseMap).map((r) => [r.rel, statementStats(r.entry)]),
  );
  const after = new Map(
    coverageEntries(cwd, head.data).map((r) => [r.rel, statementStats(r.entry)]),
  );
  const lost: NewSinceMainOutput['coverage']['lost'] = [];
  for (const [path, afterStats] of after) {
    const beforeStats = before.get(path);
    if (!beforeStats) continue;
    if (afterStats.pct < beforeStats.pct) {
      lost.push({
        path,
        beforePct: beforeStats.pct,
        afterPct: afterStats.pct,
      });
    }
  }
  lost.sort((a, b) => a.path.localeCompare(b.path));
  return { found: true, lost };
}

async function compareJunit(
  cwd: string,
  base: string,
  junit?: string,
): Promise<NewSinceMainOutput['junit']> {
  const empty = {
    newlyFailing: [] as string[],
    newlyFlaky: [] as string[],
    newlySlowest: [] as string[],
  };

  const head = await loadTestReport({
    cwd,
    ...(junit !== undefined ? { junit } : {}),
  });
  if (!head) {
    return { found: false, reason: 'no current junit', ...empty };
  }
  const baseBlob = gitShowFirst(cwd, base, DEFAULT_JUNIT_CANDIDATES);
  if (!baseBlob) {
    return {
      found: false,
      reason: `base junit not found at ${base} (tried ${DEFAULT_JUNIT_CANDIDATES.join(', ')})`,
      ...empty,
    };
  }
  const baseReport = parseJunitToTestReport(baseBlob.content);
  const baseFail = new Set(
    baseReport.failures.map((f) => testCaseKey(f.classname, f.name)),
  );
  const baseFlake = new Set(
    baseReport.flakes.map((f) => testCaseKey(f.classname, f.name)),
  );
  const baseSlow = new Set(
    baseReport.slowest.map((f) => testCaseKey(f.classname, f.name)),
  );
  return {
    found: true,
    newlyFailing: head.failures
      .filter((f) => !baseFail.has(testCaseKey(f.classname, f.name)))
      .map((f) => caseLabel(f.name, f.classname)),
    newlyFlaky: head.flakes
      .filter((f) => !baseFlake.has(testCaseKey(f.classname, f.name)))
      .map((f) => caseLabel(f.name, f.classname)),
    newlySlowest: head.slowest
      .filter((f) => !baseSlow.has(testCaseKey(f.classname, f.name)))
      .map((f) => caseLabel(f.name, f.classname)),
  };
}
