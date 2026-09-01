import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coverageFor } from '../../src/tools/coverage_for.js';
import {
  addUncoveredMul,
  commitAll,
  initMainRepo,
  linkWorkspaceNodeModules,
  runVitestCoverage,
  writeMathPackage,
} from './helpers.js';

describe('e2e: coverage_for (real CLI + coverage JSON)', () => {
  const prev = process.env['TESTED_JUNIT'];
  beforeEach(() => {
    delete process.env['TESTED_JUNIT'];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env['TESTED_JUNIT'];
    else process.env['TESTED_JUNIT'] = prev;
  });

  it('only returns requested paths from tested diff --json', async () => {
    const cwd = initMainRepo();
    linkWorkspaceNodeModules(cwd);
    writeMathPackage(cwd);
    commitAll(cwd, 'add only');
    addUncoveredMul(cwd);
    commitAll(cwd, 'add mul uncovered');
    runVitestCoverage(cwd);

    const onlyMath = await coverageFor({
      cwd,
      base: 'HEAD~1',
      paths: ['src/math.js'],
    });
    expect(onlyMath.files.length).toBeGreaterThan(0);
    expect(onlyMath.files.every((f) => f.path === 'src/math.js' || f.path.endsWith('/src/math.js'))).toBe(
      true,
    );

    const missing = await coverageFor({
      cwd,
      base: 'HEAD~1',
      paths: ['src/does-not-exist.js'],
    });
    expect(missing.files).toEqual([]);
    expect(JSON.stringify({ onlyMath, missing }).toLowerCase()).not.toMatch(/mock/);
  });
});
