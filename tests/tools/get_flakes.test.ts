import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFlakes } from '../../src/tools/get_flakes.js';
import { getPerformance } from '../../src/tools/get_performance.js';
import { makeTmpGitRepo } from '../helpers/tmp-git.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('../fixtures/flake-slow.junit.xml', import.meta.url)),
  'utf8',
);

describe('getFlakes / getPerformance', () => {
  const prevJunit = process.env['TESTED_JUNIT'];
  beforeEach(() => {
    delete process.env['TESTED_JUNIT'];
  });
  afterEach(() => {
    if (prevJunit === undefined) delete process.env['TESTED_JUNIT'];
    else process.env['TESTED_JUNIT'] = prevJunit;
  });

  it('auto-detects junit.xml and returns real flake + duration numbers', async () => {
    const cwd = makeTmpGitRepo();
    writeFileSync(join(cwd, 'junit.xml'), FIXTURE);

    const flakes = await getFlakes({ cwd });
    expect(flakes.found).toBe(true);
    expect(flakes.tests).toBe(5);
    expect(flakes.failed).toBe(1);
    expect(flakes.errors).toBe(0);
    expect(flakes.skipped).toBe(1);
    expect(flakes.flaky).toBe(1);
    expect(flakes.flakes[0]).toMatchObject({
      name: 'retry me',
      classname: 'auth',
      attempts: 2,
      durationMs: 130,
    });
    expect(flakes.failures[0]).toMatchObject({
      name: 'login fail',
      message: 'expected 200',
      durationMs: 200,
    });

    const perf = await getPerformance({ cwd });
    expect(perf.found).toBe(true);
    expect(perf.durationMs).toBe(1630);
    expect(perf.slowest[0]).toMatchObject({ name: 'big', durationMs: 1200 });
  });

  it('reads an explicit junit path under test-results/', async () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'test-results'));
    writeFileSync(join(cwd, 'test-results', 'junit.xml'), FIXTURE);

    const flakes = await getFlakes({ cwd, junit: 'test-results/junit.xml' });
    expect(flakes.found).toBe(true);
    expect(flakes.flaky).toBe(1);

    const auto = await getPerformance({ cwd });
    expect(auto.found).toBe(true);
    expect(auto.durationMs).toBe(1630);
  });

  it('missing or empty-path miss is quiet, structured, and never says mock', async () => {
    const cwd = makeTmpGitRepo();
    const flakes = await getFlakes({ cwd });
    const perf = await getPerformance({ cwd, junit: 'no-such.xml' });
    expect(flakes).toEqual({
      found: false,
      tests: 0,
      failed: 0,
      errors: 0,
      skipped: 0,
      flaky: 0,
      flakes: [],
      failures: [],
    });
    expect(perf).toEqual({ found: false, durationMs: 0, slowest: [] });
    expect(JSON.stringify({ flakes, perf }).toLowerCase()).not.toMatch(/mock/);
  });

  it('rejects a junit path that escapes cwd', async () => {
    const cwd = makeTmpGitRepo();
    await expect(getFlakes({ cwd, junit: '../outside.xml' })).rejects.toThrow(
      /outside/,
    );
  });
});
