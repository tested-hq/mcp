import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTmpGitRepo } from '../helpers/tmp-git.js';

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const WORKSPACE_NM = join(WORKSPACE_ROOT, 'node_modules');

export function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'tested',
      GIT_AUTHOR_EMAIL: 'test@tested.dev',
      GIT_COMMITTER_NAME: 'tested',
      GIT_COMMITTER_EMAIL: 'test@tested.dev',
    },
  });
}

export function initMainRepo(): string {
  const cwd = makeTmpGitRepo('tested-mcp-e2e-');
  git(cwd, ['branch', '-M', 'main']);
  git(cwd, ['config', 'user.email', 'test@tested.dev']);
  git(cwd, ['config', 'user.name', 'tested']);
  return cwd;
}

export function commitAll(cwd: string, message: string): void {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', message]);
}

export function linkWorkspaceNodeModules(cwd: string): void {
  symlinkSync(WORKSPACE_NM, join(cwd, 'node_modules'), 'dir');
}

export function writeRepoFile(cwd: string, rel: string, content: string): void {
  const abs = join(cwd, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

const VITEST_ENV_STRIP = ['VITEST_WORKER_ID', 'VITEST_POOL_ID', 'VITEST'];

export function runVitestCoverage(cwd: string): void {
  const env = { ...process.env };
  for (const k of VITEST_ENV_STRIP) delete env[k];
  execFileSync('npx', ['vitest', 'run', '--coverage', '--coverage.reporter=json'], {
    cwd,
    env,
    encoding: 'utf8',
  });
}

/** Mini JS repo: src/math.js (add + later mul) + tests/math.test.js. */
export function writeMathPackage(cwd: string): void {
  writeRepoFile(
    cwd,
    'package.json',
    JSON.stringify({
      name: 'close-patch-fixture',
      type: 'module',
      private: true,
    }) + '\n',
  );
  writeRepoFile(
    cwd,
    'vitest.config.js',
    `export default {
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['json'],
      reportsDirectory: './coverage',
      include: ['src/**'],
    },
  },
};
`,
  );
  writeRepoFile(
    cwd,
    '.tested.yaml',
    `base: HEAD~1
testRunner: vitest
thresholds:
  patch: 80
  project: 0
ignores:
  - "**/*.test.js"
  - "**/node_modules/**"
  - "**/coverage/**"
`,
  );
  writeRepoFile(
    cwd,
    'src/math.js',
    `export function add(a, b) {
  return a + b;
}
`,
  );
  writeRepoFile(
    cwd,
    'tests/math.test.js',
    `import { describe, expect, it } from 'vitest';
import { add } from '../src/math.js';

describe('math', () => {
  it('adds', () => {
    expect(add(2, 3)).toBe(5);
  });
});
`,
  );
}

export function addUncoveredMul(cwd: string): void {
  writeRepoFile(
    cwd,
    'src/math.js',
    `export function add(a, b) {
  return a + b;
}

export function mul(a, b) {
  return a * b;
}
`,
  );
}

export const CLOSED_MATH_TEST = `import { describe, expect, it } from 'vitest';
import { add, mul } from '../src/math.js';

describe('math', () => {
  it('adds', () => {
    expect(add(2, 3)).toBe(5);
  });
  it('multiplies', () => {
    expect(mul(3, 4)).toBe(12);
  });
});
`;
