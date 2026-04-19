/**
 * Search helpers for the SQLite store.
 * Mirrors internal/store/search.go sanitization logic.
 */

/**
 * Escapes SQL LIKE wildcard characters (%, _) and the escape char itself
 * so that user input is treated as a literal string.
 */
export function escapeLIKE(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Converts a raw user query into a safe FTS5 expression by quoting each
 * whitespace-delimited token. Multi-word query = implicit AND.
 * Prevents FTS5 query-syntax injection (AND/OR/NOT/NEAR/column filters).
 */
export function sanitizeFTSQuery(q: string): string {
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '""';
  return tokens
    .map(tok => '"' + tok.replace(/"/g, '""') + '"')
    .join(' ');
}
