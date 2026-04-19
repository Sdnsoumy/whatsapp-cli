/**
 * Structured output helpers — mirrors internal/out/out.go.
 * Supports both JSON mode (--json) and human-readable text.
 */

/** Write a JSON payload to stdout. */
export function writeJSON(data: unknown): void {
  process.stdout.write(JSON.stringify(data, jsonReplacer, 2) + '\n');
}

/** Write an error to stderr as JSON or plain text. */
export function writeError(asJSON: boolean, err: Error | unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (asJSON) {
    process.stderr.write(JSON.stringify({ error: message }) + '\n');
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
}

/**
 * Custom JSON replacer that serialises Buffer / Uint8Array as base64 strings
 * so binary media keys are human-readable in JSON output.
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Buffer || value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64');
  }
  return value;
}
