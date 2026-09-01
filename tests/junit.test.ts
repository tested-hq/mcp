import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildTestReportFromCases,
  listFailedFromCases,
  parseJunitToTestReport,
  parseJunitXml,
  TestReportSchema,
} from '../src/junit.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/flake-slow.junit.xml', import.meta.url)),
  'utf8',
);

describe('junit parse (shared TestReport schema)', () => {
  it('parses the flake+slow fixture into schemaVersion 1', () => {
    const cases = parseJunitXml(FIXTURE);
    expect(cases.length).toBe(6);
    expect(cases.filter((c) => c.name === 'retry me')).toHaveLength(2);

    const report = parseJunitToTestReport(FIXTURE);
    expect(TestReportSchema.parse(report).schemaVersion).toBe(1);
    expect(report.source).toBe('junit');
    expect(report.totals.tests).toBe(5);
    expect(report.totals.flaky).toBe(1);
    expect(report.totals.failed).toBe(1);
    expect(report.totals.skipped).toBe(1);
    expect(report.totals.durationMs).toBe(1630);
    expect(report.flakes[0]?.name).toBe('retry me');
    expect(report.flakes[0]?.attempts).toBe(2);
    expect(report.failures.some((f) => f.name === 'login fail')).toBe(true);
    expect(report.slowest[0]?.name).toBe('big');
    expect(report.slowest[0]?.durationMs).toBe(1200);

    const failed = listFailedFromCases(cases);
    expect(failed.find((f) => f.name === 'login fail')?.alreadyFlaky).toBe(false);
    expect(failed.find((f) => f.name === 'retry me')?.alreadyFlaky).toBe(true);
  });

  it('respects flaky attribute', () => {
    const report = buildTestReportFromCases([
      {
        name: 'x',
        classname: 'c',
        timeSec: 0.1,
        status: 'passed',
        flakyAttr: true,
      },
    ]);
    expect(report.totals.flaky).toBe(1);
  });
});
