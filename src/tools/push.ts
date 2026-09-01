import { runCli } from '../cli.js';
import { resolveToolBase } from '../resolve-base.js';
import { assertSafeReadPath } from '../safe-path.js';
import { sanitizeChildEnv } from '../sanitize-env.js';
import { PushInput, PushOutput } from '../schemas.js';

export const MISSING_PUSH_TOKEN_MESSAGE =
  'push requires a token argument or TESTED_TOKEN in the MCP server environment.';

export function resolvePushToken(input: {
  token?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = input.env ?? process.env;
  const token = input.token ?? env['TESTED_TOKEN'];
  if (token === undefined || token.trim() === '') {
    throw new Error(MISSING_PUSH_TOKEN_MESSAGE);
  }
  return token.trim();
}

/**
 * Build the child env for `tested push`.
 *
 * Starts from sanitizeChildEnv (strips host secrets, including TESTED_TOKEN)
 * then puts back only the resolved ingest token. Vitest children never see
 * this object — they keep calling sanitizeChildEnv() on their own.
 */
export function envForPushCli(token: string, source?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = sanitizeChildEnv(source);
  env['TESTED_TOKEN'] = token;
  return env;
}

export async function push(input: PushInput): Promise<PushOutput> {
  const { cwd } = input;
  const token = resolvePushToken({
    ...(input.token !== undefined ? { token: input.token } : {}),
  });

  const args = ['push', '--json'];
  args.push(
    '--base',
    resolveToolBase({
      cwd,
      ...(input.base !== undefined ? { base: input.base } : {}),
    }),
  );
  if (input.pr !== undefined) args.push('--pr', input.pr);
  if (input.mainline === true) args.push('--mainline');
  if (input.owner !== undefined) args.push('--owner', input.owner);
  if (input.name !== undefined) args.push('--name', input.name);
  if (input.junit !== undefined) {
    await assertSafeReadPath(cwd, input.junit);
    args.push('--junit', input.junit);
  }

  const raw = await runCli<unknown>(args, {
    cwd,
    env: envForPushCli(token),
    allowNonZero: true,
  });
  return PushOutput.parse(raw);
}
