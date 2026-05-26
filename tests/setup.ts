/**
 * Vitest global setup — runs before any test module is imported.
 *
 * Purpose: ensure `TESTED_BIN` is set so the resolver in src/cli.ts can
 * succeed at import time, even when the sibling @tested/cli is not
 * installed in mcp/node_modules.
 *
 * In CI (where the sibling cli/dist may not exist), tests that require
 * a working binary use `.skipIf(!existsSync(...))`. This setup just
 * prevents the import-time throw.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIBLING_CLI_BIN = resolve(__dirname, '../../cli/dist/tested.js');

if (!process.env['TESTED_BIN']) {
  if (existsSync(SIBLING_CLI_BIN)) {
    process.env['TESTED_BIN'] = SIBLING_CLI_BIN;
  } else {
    // Last-resort placeholder so the resolver doesn't throw. Any test that
    // actually spawns the binary will fail on its own (or skip).
    process.env['TESTED_BIN'] = SIBLING_CLI_BIN;
  }
}
