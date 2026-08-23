/**
 * sanitize-env.ts — Drop credentials before spawning CLI / test-runner children.
 *
 * write_and_verify runs attacker-influenced JS (the test file) and returns
 * stdout/stderr to the MCP client. runCli spawns `tested` with the same
 * inherited environment. Neither child needs TESTED_TOKEN (or sibling
 * secrets). If we forward them, a prompt-injected agent can write
 * `console.log(process.env.TESTED_TOKEN)` and read the value back.
 */

/** Exact names that must never reach a child process. */
export const SECRET_ENV_EXACT = [
  'TESTED_TOKEN',
  'TESTED_TOKEN_FILE',
  'TESTED_INGEST_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'NPM_AUTH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const;

const SECRET_ENV_EXACT_SET = new Set<string>(SECRET_ENV_EXACT);

/** Host policy / bin paths. Never treat these as credentials. */
const KEEP_ENV_KEYS = new Set([
  'TESTED_BIN',
  'TESTED_BIN_ALLOW_PREFIX',
  'TESTED_ALLOWED_CWDS',
  'TESTED_API_URL',
  'TESTED_SAFE_RUN',
]);

const SECRET_ENV_PARTS = new Set([
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'PASSPHRASE',
  'AUTHTOKEN',
]);

/** Normalize env keys so `npm_config_//registry/:_authToken` is comparable. */
export function normalizeEnvKey(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/_+$/g, '');
}

export function isSecretEnvKey(key: string): boolean {
  const normalized = normalizeEnvKey(key);
  if (KEEP_ENV_KEYS.has(normalized) || KEEP_ENV_KEYS.has(key)) {
    return false;
  }
  if (SECRET_ENV_EXACT_SET.has(normalized) || SECRET_ENV_EXACT_SET.has(key)) {
    return true;
  }
  const parts = normalized.split('_').filter(Boolean);
  for (const part of parts) {
    if (SECRET_ENV_PARTS.has(part)) return true;
    if (
      part.endsWith('TOKEN') ||
      part.endsWith('SECRET') ||
      part.includes('PASSWORD') ||
      part.includes('PASSWD')
    ) {
      return true;
    }
  }
  return normalized.includes('ACCESS_KEY') || normalized.endsWith('API_KEY');
}

/**
 * Shallow-copy `source` and delete credential keys.
 * Always returns a new object (safe to mutate further at the call site).
 */
export function sanitizeChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  for (const key of Object.keys(env)) {
    if (isSecretEnvKey(key)) {
      delete env[key];
    }
  }
  return env;
}
