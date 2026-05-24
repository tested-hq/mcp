import { runCli } from '../cli.js';
import { toUncoveredDiff } from '../reshape.js';
import {
  CliDiffOutputSchema,
  GetUncoveredDiffInput,
  GetUncoveredDiffOutput,
} from '../schemas.js';

const PAYLOAD_SOFT_CAP = 32 * 1024; // 32 KB

export async function getUncoveredDiff(
  input: GetUncoveredDiffInput,
): Promise<GetUncoveredDiffOutput> {
  const { cwd, base } = input;

  const raw = await runCli(['diff', '--base', base, '--json'], { cwd });
  const parsed = CliDiffOutputSchema.parse(raw);
  const result = toUncoveredDiff(parsed);

  const payload = JSON.stringify(result);
  if (payload.length > PAYLOAD_SOFT_CAP) {
    process.stderr.write(
      `[tested-mcp] coverage.get_uncovered_diff response is ${payload.length} bytes (>${PAYLOAD_SOFT_CAP} soft cap).\n`,
    );
  }

  return result;
}
