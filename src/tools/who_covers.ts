import { findCoverageEntry, loadCoverageMap, testsCoveringLine } from '../coverage-json.js';
import { WhoCoversInput, WhoCoversOutput } from '../schemas.js';
import { validateCwd } from '../validate-cwd.js';

const NO_MAP =
  'coverage-final.json has no per-test hit map (Istanbul/V8 file entries lack testMap/tests)';

/**
 * Which tests execute this line. Uses a per-test map only when the
 * coverage file actually has one. Never invents names from fnMap.
 */
export async function whoCovers(input: WhoCoversInput): Promise<WhoCoversOutput> {
  await validateCwd(input.cwd);
  const file = input.file.replace(/\\/g, '/').replace(/^\.\//, '');
  const { line } = input;

  const loaded = loadCoverageMap(input.cwd);
  if (!loaded) {
    return {
      available: false,
      reason: 'coverage-final.json not found (looked in coverage/coverage-final.json)',
      file,
      line,
      tests: [],
    };
  }

  const row = findCoverageEntry(input.cwd, loaded.data, file);
  if (!row) {
    return {
      available: false,
      reason: `no coverage entry for ${file}`,
      file,
      line,
      tests: [],
    };
  }

  const tests = testsCoveringLine(row.entry, line);
  if (tests === null) {
    return { available: false, reason: NO_MAP, file, line, tests: [] };
  }
  return { available: true, file, line, tests };
}
