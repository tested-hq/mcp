import { describe, expect, it } from 'vitest';
import {
  CliDiffOutputSchema,
  CliExplainOutputSchema,
  GetFlakesOutput,
  GetPerformanceOutput,
  SafeGitRef,
  TestReportSchema,
  WriteAndVerifyInput,
} from '../src/schemas.js';

describe('SafeGitRef', () => {
  it('accepts a normal ref and leaves base unset when omitted', () => {
    expect(SafeGitRef.parse('origin/main')).toBe('origin/main');
    const parsed = WriteAndVerifyInput.parse({
      cwd: '/repo',
      path: 'tests/a.test.ts',
      content: 'export {}',
    });
    expect(parsed.base).toBeUndefined();
  });

  it('rejects a leading dash and illegal charset', () => {
    expect(() => SafeGitRef.parse('--output=/tmp/x')).toThrow(/must not start with -/);
    expect(() => SafeGitRef.parse('foo bar')).toThrow(/safe git ref/);
    expect(() => SafeGitRef.parse('')).toThrow();
  });
});

describe('CLI output schemas', () => {
  it('parses a valid v1 diff payload', () => {
    const parsed = CliDiffOutputSchema.parse({
      schemaVersion: 1,
      base: 'HEAD',
      head: 'abc',
      patch: { executable: 1, covered: 1, pct: 100 },
      project: { executable: 2, covered: 2, pct: 100, delta: null },
      files: [
        {
          path: 'src/a.ts',
          patchCoverage: 100,
          projectCoverage: 100,
          uncoveredRanges: [{ start: 1, end: 2, kind: 'line' }],
        },
      ],
    });
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.files[0]?.uncoveredRanges[0]?.kind).toBe('line');
  });

  it('rejects an unknown schema version', () => {
    expect(() =>
      CliDiffOutputSchema.parse({
        schemaVersion: 2,
        base: 'HEAD',
        head: 'abc',
        patch: { executable: 1, covered: 1, pct: 100 },
        project: { executable: 1, covered: 1, pct: 100 },
        files: [],
      }),
    ).toThrow();
  });

  it('accepts a schemaVersion 1 TestReport and the tab slices', () => {
    const report = TestReportSchema.parse({
      schemaVersion: 1,
      source: 'junit',
      totals: {
        tests: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        errors: 0,
        flaky: 0,
        durationMs: 10,
      },
      failures: [],
      flakes: [],
      slowest: [{ name: 'ok', durationMs: 10 }],
    });
    expect(report.source).toBe('junit');
    expect(
      GetFlakesOutput.parse({
        found: true,
        tests: 1,
        failed: 0,
        errors: 0,
        skipped: 0,
        flaky: 0,
        flakes: [],
        failures: [],
      }).found,
    ).toBe(true);
    expect(
      GetPerformanceOutput.parse({
        found: false,
        durationMs: 0,
        slowest: [],
      }).found,
    ).toBe(false);
  });
});

describe('new tool output schemas', () => {
  it('parses get_failed / who_covers miss shapes', async () => {
    const { GetFailedOutput, WhoCoversOutput, DurationDeltaOutput } = await import(
      '../src/schemas.js'
    );
    expect(
      GetFailedOutput.parse({
        found: true,
        failed: [{ name: 'x', durationMs: 1, alreadyFlaky: false }],
      }).failed[0]?.alreadyFlaky,
    ).toBe(false);
    expect(
      WhoCoversOutput.parse({
        available: false,
        reason: 'coverage-final.json has no per-test hit map',
        file: 'src/a.ts',
        line: 1,
        tests: [],
      }).available,
    ).toBe(false);
    expect(
      DurationDeltaOutput.parse({
        found: false,
        reason: 'base junit not found at HEAD',
        tests: [],
      }).found,
    ).toBe(false);
  });

  it('parses explain output and rejects a missing field', () => {
    expect(
      CliExplainOutputSchema.parse({
        path: 'src/a.ts',
        line: 1,
        uncovered: false,
        reason: 'hit',
        codeExcerpt: '1  x',
      }).line,
    ).toBe(1);
    expect(() =>
      CliExplainOutputSchema.parse({ path: 'src/a.ts', line: 1 }),
    ).toThrow();
  });
});
