import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCAL_BASE_CANDIDATES,
  NO_DEFAULT_BASE_MESSAGE,
  friendlyGitRefError,
  gitRefExists,
  pickDefaultBase,
  resolveToolBase,
} from '../src/resolve-base.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanups.splice(0)) {
    try {
      fn();
    } catch {
      // best effort
    }
  }
});

function initRepo(opts?: { commits?: number; yamlBase?: string }): string {
  const dir = join(tmpdir(), `tested-base-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'dev@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Dev'], { cwd: dir });
  const commits = opts?.commits ?? 0;
  for (let i = 0; i < commits; i++) {
    writeFileSync(join(dir, 'f.txt'), `c${i}\n`);
    execFileSync('git', ['add', 'f.txt'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', `c${i}`], { cwd: dir });
  }
  if (opts?.yamlBase !== undefined) {
    writeFileSync(join(dir, '.tested.yaml'), `base: ${opts.yamlBase}\n`);
  }
  return dir;
}

describe('pickDefaultBase', () => {
  it('prefers a configured base that exists', () => {
    expect(
      pickDefaultBase({
        configuredBase: 'main',
        refExists: (ref) => ref === 'main',
      }),
    ).toBe('main');
  });

  it('falls through configured base to origin/main then HEAD~1', () => {
    expect(
      pickDefaultBase({
        configuredBase: 'origin/main',
        refExists: (ref) => ref === 'HEAD~1',
      }),
    ).toBe('HEAD~1');
  });

  it('throws a friendly error when nothing exists', () => {
    expect(() =>
      pickDefaultBase({
        configuredBase: 'origin/main',
        refExists: () => false,
      }),
    ).toThrow(NO_DEFAULT_BASE_MESSAGE);
    expect(NO_DEFAULT_BASE_MESSAGE).not.toMatch(/fatal:/);
  });

  it('includes HEAD~1 and HEAD as local fallbacks', () => {
    expect(LOCAL_BASE_CANDIDATES).toContain('HEAD~1');
    expect(LOCAL_BASE_CANDIDATES).toContain('HEAD');
  });
});

describe('resolveToolBase in a real repo', () => {
  it('returns an explicit base without requiring origin', () => {
    const dir = initRepo({ commits: 1 });
    expect(resolveToolBase({ cwd: dir, base: 'HEAD' })).toBe('HEAD');
  });

  it('defaults to HEAD~1 on a local repo with no origin', () => {
    const dir = initRepo({ commits: 2 });
    expect(gitRefExists(dir, 'origin/main')).toBe(false);
    expect(resolveToolBase({ cwd: dir })).toBe('HEAD~1');
  });

  it('defaults to HEAD when the repo has one commit and no origin', () => {
    const dir = initRepo({ commits: 1 });
    expect(gitRefExists(dir, 'HEAD~1')).toBe(false);
    expect(resolveToolBase({ cwd: dir })).toBe('HEAD');
  });

  it('uses .tested.yaml base when that ref exists', () => {
    const dir = initRepo({ commits: 1, yamlBase: 'HEAD' });
    expect(resolveToolBase({ cwd: dir })).toBe('HEAD');
  });

  it('throws a friendly error when the repo has no commits', () => {
    const dir = initRepo({ commits: 0 });
    expect(() => resolveToolBase({ cwd: dir })).toThrow(/no commits yet|Pass `base`/);
  });

  it('rejects an unsafe explicit base before talking to git', () => {
    const dir = initRepo({ commits: 1 });
    expect(() => resolveToolBase({ cwd: dir, base: '--output=/tmp/x' })).toThrow(
      /must not start with/,
    );
  });
});

describe('friendlyGitRefError', () => {
  it('rewrites a raw git fatal for a missing origin/main', () => {
    const msg = friendlyGitRefError(
      "fatal: ambiguous argument 'origin/main': unknown revision or path not in the working tree.",
      'origin/main',
    );
    expect(msg).toMatch(/origin\/main/);
    expect(msg).toMatch(/does not exist/);
    expect(msg).not.toMatch(/fatal:/);
  });

  it('returns null for unrelated failures', () => {
    expect(friendlyGitRefError('coverage-final.json not found')).toBeNull();
  });
});
