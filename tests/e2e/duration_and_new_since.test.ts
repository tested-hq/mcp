import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { durationDelta } from '../../src/tools/duration_delta.js';
import { newSinceMain } from '../../src/tools/new_since_main.js';
import { commitAll, initMainRepo, writeRepoFile } from './helpers.js';

const FLAKE_SLOW = readFileSync(
  fileURLToPath(new URL('../fixtures/flake-slow.junit.xml', import.meta.url)),
  'utf8',
);

const BASE_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="a" tests="2" failures="0" time="0.2">
    <testcase classname="auth" name="login ok" time="0.10"/>
    <testcase classname="slow" name="big" time="0.10"/>
  </testsuite>
</testsuites>
`;

describe('e2e: duration_delta + new_since_main', () => {
  const prev = process.env['TESTED_JUNIT'];
  beforeEach(() => {
    delete process.env['TESTED_JUNIT'];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env['TESTED_JUNIT'];
    else process.env['TESTED_JUNIT'] = prev;
  });

  it('misses honestly when base junit is not in git', async () => {
    const cwd = initMainRepo();
    writeRepoFile(cwd, 'README.md', 'x\n');
    commitAll(cwd, 'init');
    writeRepoFile(cwd, 'junit.xml', FLAKE_SLOW);

    const delta = await durationDelta({ cwd, base: 'HEAD' });
    expect(delta.found).toBe(false);
    expect(delta.reason).toMatch(/base junit not found/);
    expect(JSON.stringify(delta).toLowerCase()).not.toMatch(/mock/);

    const since = await newSinceMain({ cwd, base: 'HEAD' });
    expect(since.junit.found).toBe(false);
    expect(since.junit.reason).toMatch(/base junit not found/);
    expect(JSON.stringify(since).toLowerCase()).not.toMatch(/mock/);
  });

  it('maps suite and per-test duration to the test that slowed down', async () => {
    const cwd = initMainRepo();
    writeRepoFile(cwd, 'junit.xml', BASE_JUNIT);
    commitAll(cwd, 'fast suite');
    writeRepoFile(cwd, 'junit.xml', FLAKE_SLOW);

    const delta = await durationDelta({ cwd, base: 'HEAD' });
    expect(delta.found).toBe(true);
    expect(delta.suite?.beforeMs).toBe(200);
    expect(delta.suite?.afterMs).toBe(1630);
    expect(delta.suite?.deltaMs).toBe(1430);
    const big = delta.tests.find((t) => t.name === 'big');
    expect(big?.beforeMs).toBe(100);
    expect(big?.afterMs).toBe(1200);
    expect(big?.deltaMs).toBe(1100);
    expect(JSON.stringify(delta).toLowerCase()).not.toMatch(/mock/);
  });

  it('reports newly failing / flaky / slowest vs committed base junit', async () => {
    const cwd = initMainRepo();
    writeRepoFile(cwd, 'junit.xml', BASE_JUNIT);
    commitAll(cwd, 'green');
    writeRepoFile(cwd, 'junit.xml', FLAKE_SLOW);

    const since = await newSinceMain({ cwd, base: 'HEAD' });
    expect(since.junit.found).toBe(true);
    expect(since.junit.newlyFailing.some((n) => n.includes('login fail'))).toBe(true);
    expect(since.junit.newlyFlaky.some((n) => n.includes('retry me'))).toBe(true);
    expect(since.junit.newlySlowest.length).toBeGreaterThan(0);
    expect(JSON.stringify(since).toLowerCase()).not.toMatch(/mock/);
  });

  it('reports files that lost coverage when both coverage JSONs exist', async () => {
    const cwd = initMainRepo();
    const abs = join(cwd, 'src', 'a.js');
    writeRepoFile(cwd, 'src/a.js', 'export const a = 1;\n');
    writeRepoFile(
      cwd,
      'coverage/coverage-final.json',
      JSON.stringify({
        [abs]: {
          path: abs,
          statementMap: {
            '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
            '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
          },
          s: { '0': 1, '1': 1 },
        },
      }),
    );
    commitAll(cwd, 'full cover');
    writeRepoFile(
      cwd,
      'coverage/coverage-final.json',
      JSON.stringify({
        [abs]: {
          path: abs,
          statementMap: {
            '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
            '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
          },
          s: { '0': 1, '1': 0 },
        },
      }),
    );

    const since = await newSinceMain({ cwd, base: 'HEAD' });
    expect(since.coverage.found).toBe(true);
    expect(since.coverage.lost.some((f) => f.path === 'src/a.js' && f.afterPct < f.beforePct)).toBe(
      true,
    );
    expect(JSON.stringify(since).toLowerCase()).not.toMatch(/mock/);
  });
});
