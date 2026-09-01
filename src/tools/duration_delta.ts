import { readFileSync } from 'node:fs';
import { gitShowFirst } from '../git-at.js';
import { listCaseDurations, parseJunitToTestReport, parseJunitXml, testCaseKey } from '../junit.js';
import { DEFAULT_JUNIT_CANDIDATES, resolveJunitPath } from '../resolve-junit.js';
import { resolveToolBase } from '../resolve-base.js';
import { DurationDeltaInput, DurationDeltaOutput } from '../schemas.js';
import { validateCwd } from '../validate-cwd.js';

/**
 * Suite + per-test duration vs base. Same miss rule as new_since_main:
 * if the base JUnit blob is not in git, say so — never invent deltas.
 */
export async function durationDelta(
  input: DurationDeltaInput,
): Promise<DurationDeltaOutput> {
  await validateCwd(input.cwd);
  const base = resolveToolBase({
    cwd: input.cwd,
    ...(input.base !== undefined ? { base: input.base } : {}),
  });

  const currentPath = await resolveJunitPath({
    cwd: input.cwd,
    ...(input.junit !== undefined ? { junit: input.junit } : {}),
  });
  if (!currentPath) {
    return {
      found: false,
      reason: 'no current junit (TESTED_JUNIT / junit.xml / test-results/junit.xml / coverage/junit.xml / reports/junit.xml)',
      tests: [],
    };
  }

  const baseBlob = gitShowFirst(input.cwd, base, DEFAULT_JUNIT_CANDIDATES);
  if (!baseBlob) {
    return {
      found: false,
      base,
      reason: `base junit not found at ${base} (tried ${DEFAULT_JUNIT_CANDIDATES.join(', ')})`,
      tests: [],
    };
  }

  const headCases = parseJunitXml(readFileSync(currentPath, 'utf8'));
  const baseCases = parseJunitXml(baseBlob.content);
  const headRefs = listCaseDurations(headCases);
  const baseRefs = listCaseDurations(baseCases);
  const headReport = parseJunitToTestReport(readFileSync(currentPath, 'utf8'));
  const baseReport = parseJunitToTestReport(baseBlob.content);

  const beforeByKey = new Map(baseRefs.map((r) => [testCaseKey(r.classname, r.name), r]));
  const afterByKey = new Map(headRefs.map((r) => [testCaseKey(r.classname, r.name), r]));
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);

  const tests: DurationDeltaOutput['tests'] = [];
  for (const key of keys) {
    const before = beforeByKey.get(key);
    const after = afterByKey.get(key);
    const beforeMs = before?.durationMs ?? null;
    const afterMs = after?.durationMs ?? null;
    const deltaMs = (afterMs ?? 0) - (beforeMs ?? 0);
    const ref = after ?? before;
    if (!ref) continue;
    tests.push({
      name: ref.name,
      ...(ref.classname ? { classname: ref.classname } : {}),
      ...(ref.file ? { file: ref.file } : {}),
      beforeMs,
      afterMs,
      deltaMs,
    });
  }
  tests.sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs) || a.name.localeCompare(b.name));

  return {
    found: true,
    base,
    suite: {
      beforeMs: baseReport.totals.durationMs,
      afterMs: headReport.totals.durationMs,
      deltaMs: headReport.totals.durationMs - baseReport.totals.durationMs,
    },
    tests: tests.slice(0, 50),
  };
}
