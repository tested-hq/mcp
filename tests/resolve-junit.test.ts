import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveJunitPath } from '../src/resolve-junit.js';
import { makeTmpGitRepo } from './helpers/tmp-git.js';

describe('resolveJunitPath', () => {
  const prev = process.env['TESTED_JUNIT'];
  afterEach(() => {
    if (prev === undefined) delete process.env['TESTED_JUNIT'];
    else process.env['TESTED_JUNIT'] = prev;
  });

  it('prefers an explicit path over auto-detect', async () => {
    const cwd = makeTmpGitRepo();
    writeFileSync(join(cwd, 'junit.xml'), '<testsuite name="root"/>');
    mkdirSync(join(cwd, 'reports'));
    writeFileSync(join(cwd, 'reports', 'junit.xml'), '<testsuite name="reports"/>');
    const path = await resolveJunitPath({
      cwd,
      junit: 'reports/junit.xml',
      env: {},
    });
    expect(path).toBe(join(cwd, 'reports', 'junit.xml'));
  });

  it('honors TESTED_JUNIT when no flag is set', async () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'coverage'));
    writeFileSync(join(cwd, 'coverage', 'junit.xml'), '<testsuite/>');
    writeFileSync(join(cwd, 'junit.xml'), '<testsuite name="root"/>');
    const path = await resolveJunitPath({
      cwd,
      env: { TESTED_JUNIT: 'coverage/junit.xml' },
    });
    expect(path).toBe(join(cwd, 'coverage', 'junit.xml'));
  });

  it('auto-detects the first candidate', async () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'test-results'));
    writeFileSync(join(cwd, 'test-results', 'junit.xml'), '<testsuite/>');
    const path = await resolveJunitPath({ cwd, env: {} });
    expect(path).toBe(join(cwd, 'test-results', 'junit.xml'));
  });

  it('returns null when nothing is present', async () => {
    const cwd = makeTmpGitRepo();
    expect(await resolveJunitPath({ cwd, env: {} })).toBeNull();
  });
});
