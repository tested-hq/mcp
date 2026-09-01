import { loadTestReport } from '../resolve-junit.js';
import { GetPerformanceInput, GetPerformanceOutput } from '../schemas.js';

const MISS: GetPerformanceOutput = {
  found: false,
  durationMs: 0,
  slowest: [],
};

/**
 * Performance-tab analytics from a local JUnit report (same TestReport
 * schema as tested.dev): suite duration + slowest tests.
 */
export async function getPerformance(
  input: GetPerformanceInput,
): Promise<GetPerformanceOutput> {
  const report = await loadTestReport({
    cwd: input.cwd,
    ...(input.junit !== undefined ? { junit: input.junit } : {}),
  });
  if (!report) return MISS;
  return {
    found: true,
    durationMs: report.totals.durationMs,
    slowest: report.slowest,
  };
}
