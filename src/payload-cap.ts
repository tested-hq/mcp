/**
 * payload-cap.ts — Hard caps on MCP tool response payloads.
 *
 * Soft-cap warnings alone still returned multi-megabyte JSON to the model.
 * These helpers truncate `files[]` and set `truncated: true` when limits are hit.
 */

/** Soft warning threshold (still may return full payload under hard cap). */
export const PAYLOAD_SOFT_CAP_BYTES = 32 * 1024;

/** Hard max serialized JSON size for tool responses with a files array. */
export const PAYLOAD_MAX_BYTES = 64 * 1024;

/** Hard max number of file entries in a tool response. */
export const PAYLOAD_MAX_FILES = 200;

/**
 * Truncate `files` so the JSON serialization stays within hard limits.
 * Preserves leading file entries (most relevant first from the CLI).
 */
export function applyPayloadCap<T extends { files: readonly unknown[] }>(
  result: T,
): T & { truncated?: boolean } {
  let files = result.files as T['files'] extends readonly (infer F)[]
    ? F[]
    : unknown[];
  let truncated = false;

  if (files.length > PAYLOAD_MAX_FILES) {
    files = files.slice(0, PAYLOAD_MAX_FILES) as typeof files;
    truncated = true;
  }

  const measure = (f: typeof files): number => {
    const payload: Record<string, unknown> = {
      ...(result as object as Record<string, unknown>),
      files: f,
    };
    if (truncated || f.length < result.files.length) {
      payload.truncated = true;
    }
    return Buffer.byteLength(JSON.stringify(payload), 'utf8');
  };

  // Shrink from the end until under the byte budget (or empty).
  while (files.length > 0 && measure(files) > PAYLOAD_MAX_BYTES) {
    const over = measure(files) - PAYLOAD_MAX_BYTES;
    const drop =
      over > PAYLOAD_MAX_BYTES
        ? Math.max(1, Math.ceil(files.length / 4))
        : 1;
    files = files.slice(0, Math.max(0, files.length - drop)) as typeof files;
    truncated = true;
  }

  if (!truncated) {
    return result;
  }

  return { ...result, files, truncated: true };
}

/** Log a soft-cap notice when the (possibly truncated) payload is large. */
export function maybeWarnPayloadSize(tool: string, byteLength: number): void {
  if (byteLength > PAYLOAD_SOFT_CAP_BYTES) {
    process.stderr.write(
      `[tested-mcp] ${tool} response is ${byteLength} bytes ` +
        `(>${PAYLOAD_SOFT_CAP_BYTES} soft cap).\n`,
    );
  }
}
