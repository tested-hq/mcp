import { runCli } from '../cli.js';
import { resolveToolBase } from '../resolve-base.js';
import { CheckInput, CheckOutput } from '../schemas.js';

export async function check(input: CheckInput): Promise<CheckOutput> {
  const { cwd } = input;
  const base = resolveToolBase({
    cwd,
    ...(input.base !== undefined ? { base: input.base } : {}),
  });
  const args = ['check', '--json', '--base', base];

  try {
    const raw = await runCli<unknown>(args, { cwd, allowNonZero: true });
    return CheckOutput.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not valid JSON|exited with code/i.test(message)) {
      return CheckOutput.parse({
        skipped: true,
        detail: message,
      });
    }
    throw err;
  }
}
