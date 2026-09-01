import { readFileSync } from 'node:fs';
import { listFailedFromCases, parseJunitXml } from '../junit.js';
import { resolveJunitPath } from '../resolve-junit.js';
import { GetFailedInput, GetFailedOutput } from '../schemas.js';
import { validateCwd } from '../validate-cwd.js';

const MISS: GetFailedOutput = { found: false, failed: [] };

/**
 * Failed tests from the same JUnit parse as get_flakes.
 * Includes intra-run flakes that failed at least once (`alreadyFlaky`).
 */
export async function getFailed(input: GetFailedInput): Promise<GetFailedOutput> {
  await validateCwd(input.cwd);
  const path = await resolveJunitPath({
    cwd: input.cwd,
    ...(input.junit !== undefined ? { junit: input.junit } : {}),
  });
  if (!path) return MISS;
  const failed = listFailedFromCases(parseJunitXml(readFileSync(path, 'utf8')));
  return { found: true, failed };
}
