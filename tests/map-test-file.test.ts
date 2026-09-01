import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapSourceToTest } from '../src/map-test-file.js';
import { makeTmpGitRepo } from './helpers/tmp-git.js';

describe('mapSourceToTest', () => {
  it('suggests a colocated test when none exists', () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'solo.ts'), 'export const x = 1;\n');
    const mapped = mapSourceToTest(cwd, 'src/solo.ts');
    expect(mapped.existing).toBe(false);
    expect(mapped.convention).toBe('suggested');
    expect(mapped.testFile).toBe('src/solo.test.ts');
  });

  it('suggests tests/ when that directory exists', () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'src', 'lib'), { recursive: true });
    mkdirSync(join(cwd, 'tests'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'lib', 'util.js'), 'export const u = 1;\n');
    const mapped = mapSourceToTest(cwd, 'src/lib/util.js');
    expect(mapped.existing).toBe(false);
    expect(mapped.convention).toBe('suggested');
    expect(mapped.testFile).toBe('tests/lib/util.test.js');
  });

  it('finds __tests__ colocated files', () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'src', '__tests__'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'box.ts'), 'export const box = 1;\n');
    writeFileSync(join(cwd, 'src', '__tests__', 'box.test.ts'), 'export {};\n');
    const mapped = mapSourceToTest(cwd, 'src/box.ts');
    expect(mapped).toMatchObject({
      testFile: 'src/__tests__/box.test.ts',
      existing: true,
      convention: '__tests__',
    });
  });

  it('picks the closer of two differently-named tests', () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'src', 'deep'), { recursive: true });
    mkdirSync(join(cwd, 'tests'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'deep', 'z.ts'), 'export const z = 1;\n');
    writeFileSync(join(cwd, 'src', 'deep', 'nearby.test.ts'), 'export {};\n');
    writeFileSync(join(cwd, 'tests', 'far.test.ts'), 'export {};\n');
    const mapped = mapSourceToTest(cwd, 'src/deep/z.ts');
    expect(mapped.existing).toBe(true);
    expect(mapped.testFile).toBe('src/deep/nearby.test.ts');
  });

  it('uses the nearest existing test when names differ', () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'alpha.ts'), 'export const a = 1;\n');
    writeFileSync(join(cwd, 'src', 'unrelated.test.ts'), 'export {};\n');
    const mapped = mapSourceToTest(cwd, 'src/alpha.ts');
    expect(mapped.existing).toBe(true);
    expect(mapped.convention).toBe('nearest');
    expect(mapped.testFile).toBe('src/unrelated.test.ts');
  });

  it('suggests tests/<stem> for a root source when tests/ exists', () => {
    const cwd = makeTmpGitRepo();
    mkdirSync(join(cwd, 'tests'), { recursive: true });
    writeFileSync(join(cwd, 'index.js'), 'export const i = 1;\n');
    const mapped = mapSourceToTest(cwd, 'index.js');
    expect(mapped.existing).toBe(false);
    expect(mapped.testFile).toBe('tests/index.test.js');
  });

  it('suggests a root-level test for a root source file', () => {
    const cwd = makeTmpGitRepo();
    writeFileSync(join(cwd, 'index.js'), 'export const i = 1;\n');
    const mapped = mapSourceToTest(cwd, 'index.js');
    expect(mapped.existing).toBe(false);
    expect(mapped.testFile).toBe('index.test.js');
  });
});
