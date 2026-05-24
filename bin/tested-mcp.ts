#!/usr/bin/env node
/**
 * bin/tested-mcp.ts — Entry point for the tested-mcp stdio server.
 *
 * Usage (direct):
 *   node dist/tested-mcp.js
 *
 * Usage via .mcp.json in Claude Code:
 *   { "command": "node", "args": ["/path/to/dist/tested-mcp.js"] }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../src/server.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[tested-mcp] Server running on stdio\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`[tested-mcp] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
