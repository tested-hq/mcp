/**
 * Vitest global setup — runs before any test module is imported.
 *
 * Binary resolution is lazy (src/cli.ts). Tests do not need a placeholder
 * TESTED_BIN. If the sibling CLI repo is built, prefer that so integration
 * tests exercise the local binary; otherwise `@tested/cli` from node_modules
 * or PATH is enough.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIBLING_CLI_BIN = resolve(__dirname, '../../cli/dist/tested.js');

if (!process.env['TESTED_BIN'] && existsSync(SIBLING_CLI_BIN)) {
  process.env['TESTED_BIN'] = SIBLING_CLI_BIN;
}
