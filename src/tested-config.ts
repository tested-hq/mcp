/**
 * tested-config.ts — Read the two fields MCP needs from `.tested.yaml`
 * without taking a YAML parser dependency.
 *
 * Only top-level `base` and `testRunner` are used. Nested keys and
 * unknown runners are ignored.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TEST_RUNNERS = ['vitest', 'jest', 'pytest'] as const;
export type TestRunner = (typeof TEST_RUNNERS)[number];

export interface TestedYamlFields {
  base: string | null;
  testRunner: TestRunner | null;
}

function isTestRunner(value: string): value is TestRunner {
  return (TEST_RUNNERS as readonly string[]).includes(value);
}

/** Parse a top-level `key: value` YAML scalar. Ignores nested / commented lines. */
export function parseYamlScalarLine(line: string, key: string): string | null {
  if (/^\s/.test(line)) return null;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (!trimmed.startsWith(`${key}:`)) return null;
  let value = trimmed.slice(key.length + 1).trim();
  const comment = value.indexOf(' #');
  if (comment !== -1) value = value.slice(0, comment).trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  return value || null;
}

export function parseTestedYamlFields(text: string): TestedYamlFields {
  let base: string | null = null;
  let testRunner: TestRunner | null = null;
  for (const line of text.split(/\r?\n/)) {
    const baseVal = parseYamlScalarLine(line, 'base');
    if (baseVal !== null) base = baseVal;
    const runnerVal = parseYamlScalarLine(line, 'testRunner');
    if (runnerVal !== null && isTestRunner(runnerVal)) testRunner = runnerVal;
  }
  return { base, testRunner };
}

export function readTestedYamlFields(cwd: string): TestedYamlFields {
  try {
    const text = readFileSync(join(cwd, '.tested.yaml'), 'utf8');
    return parseTestedYamlFields(text);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { base: null, testRunner: null };
    }
    throw err;
  }
}
