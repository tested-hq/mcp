import { runCli } from '../cli.js';
import {
  applyPayloadCap,
  maybeWarnPayloadSize,
} from '../payload-cap.js';
import { resolveToolBase } from '../resolve-base.js';
import { toUncoveredDiff } from '../reshape.js';
import {
  CliDiffOutputSchema,
  GetUncoveredDiffInput,
  GetUncoveredDiffOutput,
} from '../schemas.js';

export async function getUncoveredDiff(
  input: GetUncoveredDiffInput,
): Promise<GetUncoveredDiffOutput> {
  const { cwd } = input;
  const base = resolveToolBase({ cwd, ...(input.base !== undefined ? { base: input.base } : {}) });

  const raw = await runCli(['diff', '--base', base, '--json'], { cwd });
  const parsed = CliDiffOutputSchema.parse(raw);
  const result = applyPayloadCap(toUncoveredDiff(parsed));

  const payload = JSON.stringify(result);
  maybeWarnPayloadSize('get_uncovered_diff', payload.length);

  return result;
}
