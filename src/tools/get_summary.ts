import { runCli } from '../cli.js';
import { assertSafeGitRef } from '../git-ref.js';
import {
  applyPayloadCap,
  maybeWarnPayloadSize,
} from '../payload-cap.js';
import { toSummary } from '../reshape.js';
import {
  CliDiffOutputSchema,
  GetSummaryInput,
  GetSummaryOutput,
} from '../schemas.js';

export async function getSummary(input: GetSummaryInput): Promise<GetSummaryOutput> {
  const { cwd, base } = input;
  assertSafeGitRef(base);

  const raw = await runCli(['diff', '--base', base, '--json'], { cwd });
  const parsed = CliDiffOutputSchema.parse(raw);
  const result = applyPayloadCap(toSummary(parsed));

  const payload = JSON.stringify(result);
  maybeWarnPayloadSize('get_coverage_summary', payload.length);

  return result;
}
