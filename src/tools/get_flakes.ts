import { loadTestReport } from '../resolve-junit.js';
import { GetFlakesInput, GetFlakesOutput } from '../schemas.js';

const MISS: GetFlakesOutput = {
  found: false,
  tests: 0,
  failed: 0,
  errors: 0,
  skipped: 0,
  flaky: 0,
  flakes: [],
  failures: [],
};

/**
 * Tests-tab analytics from a local JUnit report (same TestReport schema
 * as tested.dev). Intra-run flakes only.
 */
export async function getFlakes(input: GetFlakesInput): Promise<GetFlakesOutput> {
  const report = await loadTestReport({
    cwd: input.cwd,
    ...(input.junit !== undefined ? { junit: input.junit } : {}),
  });
  if (!report) return MISS;
  return {
    found: true,
    tests: report.totals.tests,
    failed: report.totals.failed,
    errors: report.totals.errors,
    skipped: report.totals.skipped,
    flaky: report.totals.flaky,
    flakes: report.flakes,
    failures: report.failures,
  };
}
