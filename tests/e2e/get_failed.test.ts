import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getFailed } from '../../src/tools/get_failed.js';
import { getFlakes } from '../../src/tools/get_flakes.js';
import { makeTmpGitRepo } from '../helpers/tmp-git.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('../fixtures/flake-slow.junit.xml', import.meta.url)),
  'utf8',
);

describe('e2e: get_failed + get_flakes on flake-slow.junit.xml', () => {
  const prev = process.env['TESTED_JUNIT'];
  beforeEach(() => {
    delete process.env['TESTED_JUNIT'];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env['TESTED_JUNIT'];
    else process.env['TESTED_JUNIT'] = prev;
  });

  it('returns login fail and the flaky retry from the real fixture', async () => {
    const cwd = makeTmpGitRepo();
    writeFileSync(join(cwd, 'junit.xml'), FIXTURE);

    const failed = await getFailed({ cwd });
    const flakes = await getFlakes({ cwd });

    expect(failed.found).toBe(true);
    expect(flakes.found).toBe(true);
    expect(flakes.flakes[0]?.name).toBe('retry me');
    expect(flakes.flakes[0]?.attempts).toBe(2);

    const hard = failed.failed.find((f) => f.name === 'login fail');
    expect(hard).toMatchObject({
      name: 'login fail',
      message: 'expected 200',
      durationMs: 200,
      alreadyFlaky: false,
    });
    expect(hard).not.toHaveProperty('file');

    const flaky = failed.failed.find((f) => f.name === 'retry me');
    expect(flaky).toMatchObject({
      name: 'retry me',
      alreadyFlaky: true,
      durationMs: 130,
    });

    expect(JSON.stringify({ failed, flakes }).toLowerCase()).not.toMatch(/mock/);
  });
});
