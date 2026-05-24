import { runCli } from '../cli.js';
import { toSummary } from '../reshape.js';
import {
  CliDiffOutputSchema,
  GetSummaryInput,
  GetSummaryOutput,
} from '../schemas.js';

const PAYLOAD_SOFT_CAP = 32 * 1024; // 32 KB

export async function getSummary(input: GetSummaryInput): Promise<GetSummaryOutput> {
  const { cwd, base } = input;

  const raw = await runCli(['diff', '--base', base, '--json'], { cwd });
  const parsed = CliDiffOutputSchema.parse(raw);
  const result = toSummary(parsed);

  const payload = JSON.stringify(result);
  if (payload.length > PAYLOAD_SOFT_CAP) {
    process.stderr.write(
      `[tested-mcp] coverage.get_summary response is ${payload.length} bytes (>${PAYLOAD_SOFT_CAP} soft cap).\n`,
    );
  }

  return result;
}
