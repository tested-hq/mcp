import { describe, it, expect } from 'vitest';
import {
  applyPayloadCap,
  PAYLOAD_MAX_BYTES,
  PAYLOAD_MAX_FILES,
} from '../src/payload-cap.js';

describe('applyPayloadCap', () => {
  it('returns the original object when under limits', () => {
    const input = {
      files: [
        { path: 'a.ts', ranges: [{ start: 1, end: 2, kind: 'line' as const }] },
      ],
    };
    const out = applyPayloadCap(input);
    expect(out.truncated).toBeUndefined();
    expect(out.files).toHaveLength(1);
    expect(out).toBe(input);
  });

  it('truncates when file count exceeds PAYLOAD_MAX_FILES', () => {
    const files = Array.from({ length: PAYLOAD_MAX_FILES + 50 }, (_, i) => ({
      path: `f${i}.ts`,
      ranges: [{ start: 1, end: 1, kind: 'line' as const }],
    }));
    const out = applyPayloadCap({ files });
    expect(out.truncated).toBe(true);
    expect(out.files.length).toBeLessThanOrEqual(PAYLOAD_MAX_FILES);
    expect(out.files[0]?.path).toBe('f0.ts');
  });

  it('truncates when serialized size exceeds PAYLOAD_MAX_BYTES', () => {
    // Each file path is huge so a small number of files still blows the budget.
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `src/${'x'.repeat(4000)}_${i}.ts`,
      ranges: Array.from({ length: 30 }, (__, j) => ({
        start: j + 1,
        end: j + 5,
        kind: 'line' as const,
      })),
    }));
    const out = applyPayloadCap({ files, patch: { executable: 1, covered: 1, pct: 100 } });
    expect(out.truncated).toBe(true);
    expect(out.files.length).toBeLessThan(files.length);
    const size = Buffer.byteLength(JSON.stringify(out), 'utf8');
    expect(size).toBeLessThanOrEqual(PAYLOAD_MAX_BYTES);
  });

  it('can reduce to empty files and still mark truncated', () => {
    const files = [
      {
        path: 'huge',
        // One entry that alone exceeds the budget once nested in JSON
        ranges: Array.from({ length: 5000 }, (_, j) => ({
          start: j + 1,
          end: j + 10,
          kind: 'line' as const,
        })),
      },
    ];
    const out = applyPayloadCap({ files });
    expect(out.truncated).toBe(true);
    expect(out.files.length).toBe(0);
  });
});
