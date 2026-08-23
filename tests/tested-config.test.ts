import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseTestedYamlFields,
  parseYamlScalarLine,
  readTestedYamlFields,
} from '../src/tested-config.js';

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

describe('parseYamlScalarLine', () => {
  it('reads a plain top-level key', () => {
    expect(parseYamlScalarLine('testRunner: vitest', 'testRunner')).toBe('vitest');
  });

  it('strips quotes and trailing comments', () => {
    expect(parseYamlScalarLine('base: "main" # default', 'base')).toBe('main');
    expect(parseYamlScalarLine("base: 'origin/main'", 'base')).toBe('origin/main');
  });

  it('ignores comments, nested keys, and mismatches', () => {
    expect(parseYamlScalarLine('# testRunner: jest', 'testRunner')).toBeNull();
    expect(parseYamlScalarLine('  testRunner: jest', 'testRunner')).toBeNull();
    expect(parseYamlScalarLine('base: main', 'testRunner')).toBeNull();
  });
});

describe('parseTestedYamlFields', () => {
  it('reads both fields and ignores an unknown runner', () => {
    expect(
      parseTestedYamlFields('base: main\ntestRunner: vitest\n'),
    ).toEqual({ base: 'main', testRunner: 'vitest' });
    expect(parseTestedYamlFields('testRunner: mocha\n')).toEqual({
      base: null,
      testRunner: null,
    });
  });
});

describe('readTestedYamlFields', () => {
  it('returns nulls when .tested.yaml is missing', () => {
    const dir = join(tmpdir(), `tested-yaml-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir);
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    expect(readTestedYamlFields(dir)).toEqual({ base: null, testRunner: null });
  });

  it('reads a file from cwd', () => {
    const dir = join(tmpdir(), `tested-yaml-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir);
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, '.tested.yaml'), 'testRunner: jest\nbase: develop\n');
    expect(readTestedYamlFields(dir)).toEqual({
      base: 'develop',
      testRunner: 'jest',
    });
  });
});
