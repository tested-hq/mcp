import { runCli } from '../cli.js';
import { applyPayloadCap, maybeWarnPayloadSize } from '../payload-cap.js';
import { resolveToolBase } from '../resolve-base.js';
import {
  CliDiffOutputSchema,
  CoverageForInput,
  CoverageForOutput,
} from '../schemas.js';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function pathRequested(file: string, requested: string[]): boolean {
  const f = normalizePath(file);
  return requested.some((raw) => {
    const r = normalizePath(raw).replace(/\/$/, '');
    return f === r || f.endsWith(`/${r}`) || f.startsWith(`${r}/`);
  });
}

/**
 * Patch coverage for the files the agent touched — a filter of
 * `tested diff --json` files[], not a second schema.
 */
export async function coverageFor(input: CoverageForInput): Promise<CoverageForOutput> {
  const { cwd, paths } = input;
  const base = resolveToolBase({ cwd, ...(input.base !== undefined ? { base: input.base } : {}) });
  const raw = await runCli(['diff', '--base', base, '--json'], { cwd });
  const parsed = CliDiffOutputSchema.parse(raw);
  const files = parsed.files.filter((f) => pathRequested(f.path, paths));
  const result = applyPayloadCap({ files });
  maybeWarnPayloadSize('coverage_for', JSON.stringify(result).length);
  return result;
}
