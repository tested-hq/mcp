import { runCli } from '../cli.js';
import { toExplainResult } from '../reshape.js';
import { CliExplainOutputSchema, ExplainInput, ExplainOutput } from '../schemas.js';

export async function explain(input: ExplainInput): Promise<ExplainOutput> {
  const { cwd, location } = input;

  const raw = await runCli(['explain', location, '--json'], { cwd });
  const parsed = CliExplainOutputSchema.parse(raw);
  return toExplainResult(parsed);
}
