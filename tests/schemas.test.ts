import { describe, expect, it } from 'vitest';
import {
  CliDiffOutputSchema,
  CliExplainOutputSchema,
  SafeGitRef,
  WriteAndVerifyInput,
} from '../src/schemas.js';

describe('SafeGitRef', () => {
  it('accepts a normal ref and applies the default on BaseInput via WriteAndVerify', () => {
    expect(SafeGitRef.parse('origin/main')).toBe('origin/main');
    const parsed = WriteAndVerifyInput.parse({
      cwd: '/repo',
      path: 'tests/a.test.ts',
      content: 'export {}',
    });
    expect(parsed.base).toBe('origin/main');
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
