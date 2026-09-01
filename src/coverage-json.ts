/**
 * coverage-json.ts — Read Istanbul / V8 `coverage-final.json`.
 *
 * Used when a tool needs local coverage (who_covers, uncovered_branches
 * fallback, new_since_main). Does not invent a second coverage schema:
 * file entries are the standard Istanbul object (`statementMap`, `s`,
 * `branchMap`, `b`). A per-test hit map is only used when the JSON
 * actually has one (`testMap` or `tests`); otherwise callers return a
 * structured miss.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const DEFAULT_COVERAGE_CANDIDATES = [
  'coverage/coverage-final.json',
  'coverage-final.json',
] as const;

export interface IstanbulLoc {
  start: { line: number; column?: number };
  end: { line: number; column?: number };
}

export interface IstanbulFileEntry {
  path?: string;
  statementMap?: Record<string, IstanbulLoc>;
  s?: Record<string, number>;
  branchMap?: Record<
    string,
    {
      loc?: IstanbulLoc;
      locations?: IstanbulLoc[];
    }
  >;
  b?: Record<string, number[]>;
  /** Optional extra: test name → statement hits and/or line list. */
  testMap?: Record<string, { s?: Record<string, number>; lines?: number[] }>;
  /** Optional extra: list of { name, lines } / { name, s }. */
  tests?: Array<{ name: string; lines?: number[]; s?: Record<string, number> }>;
}

export type CoverageMap = Record<string, IstanbulFileEntry>;

export function resolveCoveragePath(cwd: string): string | null {
  for (const rel of DEFAULT_COVERAGE_CANDIDATES) {
    const abs = join(cwd, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

export function parseCoverageMap(raw: string): CoverageMap | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null;
  }
  return data as CoverageMap;
}

export function loadCoverageMap(cwd: string): {
  path: string;
  data: CoverageMap;
} | null {
  const path = resolveCoveragePath(cwd);
  if (!path) return null;
  const parsed = parseCoverageMap(readFileSync(path, 'utf8'));
  if (!parsed) return null;
  return { path, data: parsed };
}

function normalizeRel(cwd: string, entryPath: string): string {
  const cleaned = entryPath.trim().replace(/\\/g, '/');
  let abs: string;
  if (cleaned.startsWith('file://')) {
    try {
      abs = decodeURIComponent(new URL(cleaned).pathname);
    } catch {
      abs = resolve(cwd, cleaned.replace(/^file:\/\//, ''));
    }
  } else {
    abs = isAbsolute(cleaned) ? resolve(cleaned) : resolve(cwd, cleaned);
  }
  return relative(resolve(cwd), abs).split(sep).join('/');
}

export function coverageEntries(
  cwd: string,
  data: CoverageMap,
): Array<{ rel: string; entry: IstanbulFileEntry }> {
  const out: Array<{ rel: string; entry: IstanbulFileEntry }> = [];
  for (const [key, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object') continue;
    const rawPath = typeof entry.path === 'string' && entry.path ? entry.path : key;
    if (typeof rawPath !== 'string' || !rawPath) continue;
    const rel = normalizeRel(cwd, rawPath);
    if (!rel || rel.startsWith('..')) continue;
    out.push({ rel, entry });
  }
  return out;
}

export function findCoverageEntry(
  cwd: string,
  data: CoverageMap,
  file: string,
): { rel: string; entry: IstanbulFileEntry } | null {
  const want = file.replace(/\\/g, '/').replace(/^\.\//, '');
  for (const row of coverageEntries(cwd, data)) {
    if (row.rel === want || row.rel.endsWith(`/${want}`)) return row;
  }
  return null;
}

export function statementStats(entry: IstanbulFileEntry): {
  total: number;
  covered: number;
  pct: number;
} {
  const map = entry.statementMap ?? {};
  const hits = entry.s ?? {};
  const ids = Object.keys(map);
  const total = ids.length;
  let covered = 0;
  for (const id of ids) {
    if ((hits[id] ?? 0) > 0) covered += 1;
  }
  const pct = total === 0 ? 100 : Math.round((covered / total) * 1000) / 10;
  return { total, covered, pct };
}

export function uncoveredBranchRanges(
  entry: IstanbulFileEntry,
): Array<{ start: number; end: number; kind: 'branch' }> {
  const branchMap = entry.branchMap;
  const hitsMap = entry.b;
  if (!branchMap || !hitsMap) return [];
  const ranges: Array<{ start: number; end: number; kind: 'branch' }> = [];
  for (const [id, meta] of Object.entries(branchMap)) {
    const hits = hitsMap[id] ?? [];
    const locations = meta.locations?.length
      ? meta.locations
      : meta.loc
        ? [meta.loc]
        : [];
    for (let i = 0; i < locations.length; i += 1) {
      if ((hits[i] ?? 0) > 0) continue;
      const loc = locations[i];
      if (!loc) continue;
      const start = loc.start.line;
      const end = loc.end.line;
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
      ranges.push({ start, end, kind: 'branch' });
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  return ranges;
}

function linesHitByStatements(
  entry: IstanbulFileEntry,
  sHits: Record<string, number>,
): Set<number> {
  const lines = new Set<number>();
  const map = entry.statementMap ?? {};
  for (const [id, loc] of Object.entries(map)) {
    if ((sHits[id] ?? 0) <= 0) continue;
    for (let line = loc.start.line; line <= loc.end.line; line += 1) {
      lines.add(line);
    }
  }
  return lines;
}

/**
 * Test names that execute `line`, or `null` when the file has no per-test map.
 * Never invents names from `fnMap` / V8 function names.
 */
export function testsCoveringLine(
  entry: IstanbulFileEntry,
  line: number,
): string[] | null {
  const names = new Set<string>();
  let sawMap = false;

  if (entry.testMap && typeof entry.testMap === 'object') {
    sawMap = true;
    for (const [name, hit] of Object.entries(entry.testMap)) {
      if (!name) continue;
      if (hit.lines?.includes(line)) {
        names.add(name);
        continue;
      }
      if (hit.s && linesHitByStatements(entry, hit.s).has(line)) {
        names.add(name);
      }
    }
  }

  if (Array.isArray(entry.tests)) {
    sawMap = true;
    for (const t of entry.tests) {
      if (!t?.name) continue;
      if (t.lines?.includes(line)) {
        names.add(t.name);
        continue;
      }
      if (t.s && linesHitByStatements(entry, t.s).has(line)) {
        names.add(t.name);
      }
    }
  }

  if (!sawMap) return null;
  return [...names].sort();
}
