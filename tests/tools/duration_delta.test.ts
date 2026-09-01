import { describe, expect, it } from 'vitest';
import { durationDelta } from '../../src/tools/duration_delta.js';
import { makeTmpGitRepo } from '../helpers/tmp-git.js';

describe('durationDelta miss paths', () => {
  it('misses when there is no current junit', async () => {
    const cwd = makeTmpGitRepo();
    const result = await durationDelta({ cwd, base: 'HEAD' });
    expect(result.found).toBe(false);
    expect(result.reason).toMatch(/no current junit/);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/mock/);
  });
});
