/**
 * tool-error.ts — Helpers to convert thrown errors into MCP tool results
 * with `isError: true`.
 *
 * Per the MCP spec, "tool execution errors" must be reported as a successful
 * JSON-RPC response with `isError: true` so the LLM can read the message and
 * self-correct. Throwing here would surface as a JSON-RPC protocol error,
 * which most clients hide.
 */

const MAX_ERR_LEN = 500;

export function truncate(s: string, max = MAX_ERR_LEN): string {
  return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
}

export interface ErrorToolResult {
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

export function toErrorResult(err: unknown): ErrorToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: truncate(message) }],
    isError: true,
  };
}
