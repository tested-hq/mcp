import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { MCP_VERSION } from '../src/version.js';

describe('package version', () => {
  it('matches package.json (serverInfo uses MCP_VERSION)', () => {
    expect(MCP_VERSION).toBe(pkg.version);
    expect(pkg.version).toBe('0.1.1');
  });

  it('requires Node 24+', () => {
    expect(pkg.engines.node).toBe('>=24');
  });
});
