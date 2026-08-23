import { describe, expect, it } from 'vitest';
import {
  isSecretEnvKey,
  normalizeEnvKey,
  sanitizeChildEnv,
} from '../src/sanitize-env.js';

describe('normalizeEnvKey', () => {
  it('uppercases and turns punctuation into underscores', () => {
    const normalized = normalizeEnvKey(
      'npm_config_//registry.npmjs.org/:_authToken',
    );
    expect(normalized).toMatch(/AUTHTOKEN$/);
    expect(normalized.startsWith('NPM_CONFIG_')).toBe(true);
  });
});

describe('isSecretEnvKey', () => {
  it('flags ingest and common host credentials', () => {
    expect(isSecretEnvKey('TESTED_TOKEN')).toBe(true);
    expect(isSecretEnvKey('TESTED_TOKEN_FILE')).toBe(true);
    expect(isSecretEnvKey('TESTED_INGEST_TOKEN')).toBe(true);
    expect(isSecretEnvKey('GITHUB_TOKEN')).toBe(true);
    expect(isSecretEnvKey('NPM_TOKEN')).toBe(true);
    expect(isSecretEnvKey('AWS_SECRET_ACCESS_KEY')).toBe(true);
    expect(isSecretEnvKey('STRIPE_SECRET_KEY')).toBe(true);
  });

  it('keeps MCP / CLI policy variables and PATH', () => {
    expect(isSecretEnvKey('TESTED_BIN')).toBe(false);
    expect(isSecretEnvKey('TESTED_BIN_ALLOW_PREFIX')).toBe(false);
    expect(isSecretEnvKey('TESTED_ALLOWED_CWDS')).toBe(false);
    expect(isSecretEnvKey('TESTED_API_URL')).toBe(false);
    expect(isSecretEnvKey('TESTED_SAFE_RUN')).toBe(false);
    expect(isSecretEnvKey('PATH')).toBe(false);
    expect(isSecretEnvKey('HOME')).toBe(false);
    expect(isSecretEnvKey('CI')).toBe(false);
  });

  it('flags npm auth keys that use punctuation', () => {
    expect(isSecretEnvKey('npm_config_//registry.npmjs.org/:_authToken')).toBe(
      true,
    );
  });
});

describe('sanitizeChildEnv', () => {
  it('returns a new object and strips secrets', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      TESTED_BIN: '/abs/tested.js',
      TESTED_TOKEN: 'must-not-leak',
      TESTED_TOKEN_FILE: '/tmp/token',
      GITHUB_TOKEN: 'gh-must-not-leak',
      CI: 'true',
    };
    const out = sanitizeChildEnv(source);
    expect(out).not.toBe(source);
    expect(out.PATH).toBe('/usr/bin');
    expect(out.TESTED_BIN).toBe('/abs/tested.js');
    expect(out.CI).toBe('true');
    expect(out.TESTED_TOKEN).toBeUndefined();
    expect(out.TESTED_TOKEN_FILE).toBeUndefined();
    expect(out.GITHUB_TOKEN).toBeUndefined();
    expect(source.TESTED_TOKEN).toBe('must-not-leak');
  });
});
