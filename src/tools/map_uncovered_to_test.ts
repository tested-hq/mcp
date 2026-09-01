import { mapSourceToTest } from '../map-test-file.js';
import { getUncoveredDiff } from './get_uncovered_diff.js';
import {
  MapUncoveredToTestInput,
  MapUncoveredToTestOutput,
} from '../schemas.js';
import { validateCwd } from '../validate-cwd.js';

/**
 * Given uncovered source files (or get_uncovered_diff), return the
 * existing/colocated test file each range should land in.
 */
export async function mapUncoveredToTest(
  input: MapUncoveredToTestInput,
): Promise<MapUncoveredToTestOutput> {
  await validateCwd(input.cwd);

  let sources: Array<{
    path: string;
    ranges?: MapUncoveredToTestOutput['mappings'][number]['ranges'];
  }>;

  if (input.paths && input.paths.length > 0) {
    sources = input.paths.map((path) => ({ path }));
  } else {
    const diff = await getUncoveredDiff({
      cwd: input.cwd,
      ...(input.base !== undefined ? { base: input.base } : {}),
    });
    sources = diff.files.map((f) => ({ path: f.path, ranges: f.ranges }));
  }

  const mappings = sources.map((s) => {
    const mapped = mapSourceToTest(input.cwd, s.path);
    return {
      source: mapped.source,
      ...(s.ranges ? { ranges: s.ranges } : {}),
      testFile: mapped.testFile,
      existing: mapped.existing,
      convention: mapped.convention,
    };
  });

  return { mappings };
}
