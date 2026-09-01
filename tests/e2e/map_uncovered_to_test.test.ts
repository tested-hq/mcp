import { describe, expect, it } from 'vitest';
import { mapUncoveredToTest } from '../../src/tools/map_uncovered_to_test.js';
import { writeRepoFile } from './helpers.js';
import { makeTmpGitRepo } from '../helpers/tmp-git.js';

describe('e2e: map_uncovered_to_test', () => {
  it('returns the existing colocated test file', async () => {
    const cwd = makeTmpGitRepo();
    writeRepoFile(cwd, 'src/math.js', 'export const add = (a, b) => a + b;\n');
    writeRepoFile(cwd, 'tests/math.test.js', 'import { add } from "../src/math.js";\n');

    const result = await mapUncoveredToTest({ cwd, paths: ['src/math.js'] });
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]).toMatchObject({
      source: 'src/math.js',
      testFile: 'tests/math.test.js',
      existing: true,
    });
    expect(['tests-dir', 'nearest']).toContain(result.mappings[0]?.convention);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/mock/);
  });

  it('prefers src/foo.test.ts when that file already exists', async () => {
    const cwd = makeTmpGitRepo();
    writeRepoFile(cwd, 'src/foo.ts', 'export const foo = 1;\n');
    writeRepoFile(cwd, 'src/foo.test.ts', 'import { foo } from "./foo.js";\n');

    const result = await mapUncoveredToTest({ cwd, paths: ['src/foo.ts'] });
    expect(result.mappings[0]).toMatchObject({
      source: 'src/foo.ts',
      testFile: 'src/foo.test.ts',
      existing: true,
      convention: 'colocate',
    });
  });
});
