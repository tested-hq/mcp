/**
 * bin/tested-mcp.ts — Entry point for the tested-mcp stdio server.
 *
 * Usage (direct):
 *   node dist/tested-mcp.js
 *
 * Usage via .mcp.json in Claude Code:
 *   { "command": "node", "args": ["/path/to/dist/tested-mcp.js"] }
 *
 * Lifecycle:
 *   - SIGINT / SIGTERM   -> kill in-flight subprocesses, close server, exit 0
 *   - stdin close (EOF)  -> same (covers Claude Desktop restart, which
 *                          closes the stdio pipes without sending a signal)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../src/server.js';
import { killAllChildren } from '../src/cli.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[tested-mcp] Server running on stdio\n');

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[tested-mcp] Shutting down (${signal})…\n`);
    killAllChildren('SIGTERM');
    try {
      await server.close();
    } catch {
      // best effort
    }
    process.exit(0);
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void shutdown(sig);
    });
  }
  process.stdin.on('close', () => {
    void shutdown('stdin-close');
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`[tested-mcp] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
