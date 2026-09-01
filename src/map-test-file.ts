/**
 * map-test-file.ts — Colocate convention: which existing test file an
 * uncovered source file should land in. Agents must not guess.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.next']);

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const TEST_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.test.js',
  '.test.jsx',
  '.test.mts',
  '.test.cts',
  '.spec.ts',
  '.spec.tsx',
  '.spec.js',
  '.spec.jsx',
] as const;

export interface MappedTestFile {
  source: string;
  testFile: string;
  existing: boolean;
  convention: 'colocate' | 'tests-dir' | '__tests__' | 'nearest' | 'suggested';
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function stemOf(file: string): string {
  const base = basename(file);
  return base.replace(/\.(test|spec)\.[cm]?[jt]sx?$/i, '').replace(/\.[^.]+$/, '');
}

function listDirSafe(abs: string): string[] {
  try {
    return readdirSync(abs);
  } catch {
    return [];
  }
}

function collectTestFiles(cwd: string): string[] {
  const out: string[] = [];
  const walk = (abs: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const child = join(abs, name);
      let st;
      try {
        st = statSync(child);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(child);
        continue;
      }
      if (TEST_FILE_RE.test(name)) {
        out.push(toPosix(relative(cwd, child)));
      }
    }
  };
  walk(cwd);
  return out;
}

function candidatesFor(source: string): Array<{ path: string; convention: MappedTestFile['convention'] }> {
  const dir = dirname(source);
  const stem = stemOf(source);
  const srcExt = extname(source) || '.ts';
  const out: Array<{ path: string; convention: MappedTestFile['convention'] }> = [];
  const push = (p: string, convention: MappedTestFile['convention']): void => {
    const norm = toPosix(p).replace(/^\.\//, '');
    if (!out.some((c) => c.path === norm)) out.push({ path: norm, convention });
  };

  for (const suf of TEST_SUFFIXES) {
    if (dir === '.' || dir === '') {
      push(`${stem}${suf}`, 'colocate');
    } else {
      push(join(dir, `${stem}${suf}`), 'colocate');
      push(join(dir, '__tests__', `${stem}${suf}`), '__tests__');
    }
    push(join('tests', `${stem}${suf}`), 'tests-dir');
    push(join('test', `${stem}${suf}`), 'tests-dir');
    if (dir === 'src' || dir.startsWith(`src${sep}`) || dir.startsWith('src/')) {
      const rest = dir === 'src' ? '' : dir.slice(4);
      push(join('tests', rest, `${stem}${suf}`), 'tests-dir');
    }
  }

  // Prefer same extension first among colocated suggestions.
  const sameExt = `.test${srcExt}`;
  if (dir === '.' || dir === '') {
    push(`${stem}${sameExt}`, 'suggested');
  } else {
    push(join(dir, `${stem}${sameExt}`), 'suggested');
  }
  return out;
}

function nearestExisting(source: string, allTests: string[]): string | null {
  const stem = stemOf(source);
  const srcDir = dirname(source);
  const sameStem = allTests.filter((t) => stemOf(t) === stem);
  const pool = sameStem.length > 0 ? sameStem : allTests;
  if (pool.length === 0) return null;
  const score = (t: string): number => {
    const tDir = dirname(t);
    if (tDir === srcDir) return 0;
    if (tDir === join(srcDir, '__tests__') || tDir === `${srcDir}/__tests__`) return 1;
    const srcParts = srcDir === '.' ? [] : srcDir.split('/');
    const tParts = tDir === '.' ? [] : tDir.split('/');
    let common = 0;
    while (
      common < srcParts.length &&
      common < tParts.length &&
      srcParts[common] === tParts[common]
    ) {
      common += 1;
    }
    return 10 + (srcParts.length - common) + (tParts.length - common);
  };
  return [...pool].sort((a, b) => score(a) - score(b) || a.localeCompare(b))[0] ?? null;
}

/**
 * Map one source file to the test file it should land in.
 */
export function mapSourceToTest(cwd: string, source: string): MappedTestFile {
  const rel = toPosix(source).replace(/^\.\//, '');
  const allTests = collectTestFiles(cwd);
  for (const c of candidatesFor(rel)) {
    if (existsSync(join(cwd, c.path))) {
      return {
        source: rel,
        testFile: c.path,
        existing: true,
        convention: c.convention === 'suggested' ? 'colocate' : c.convention,
      };
    }
  }
  const nearest = nearestExisting(rel, allTests);
  if (nearest) {
    return { source: rel, testFile: nearest, existing: true, convention: 'nearest' };
  }

  const testsDir = existsSync(join(cwd, 'tests')) || listDirSafe(join(cwd, 'tests')).length > 0;
  const stem = stemOf(rel);
  const srcExt = extname(rel) || '.ts';
  const dir = dirname(rel);
  if (testsDir) {
    const mirrored =
      dir === 'src' || dir.startsWith('src/')
        ? toPosix(join('tests', dir === 'src' ? '' : dir.slice(4), `${stem}.test${srcExt}`))
        : toPosix(join('tests', `${stem}.test${srcExt}`));
    return {
      source: rel,
      testFile: mirrored.replace(/\/+/g, '/'),
      existing: false,
      convention: 'suggested',
    };
  }
  const colocated =
    dir === '.' || dir === ''
      ? `${stem}.test${srcExt}`
      : toPosix(join(dir, `${stem}.test${srcExt}`));
  return { source: rel, testFile: colocated, existing: false, convention: 'suggested' };
}
