/**
 * Shared CLI helpers — mirrors cmd/wacli/helpers.go
 */

/** Truncate a string to maxLen, adding "…" if it was cut. */
export function truncate(s: string, maxLen: number): string {
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

/** Parse a time string in RFC3339 or YYYY-MM-DD format. */
export function parseTime(s: string): Date {
  const trimmed = s.trim();
  // Try RFC3339 first
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;
  throw new Error(`invalid time format: ${s} (use RFC3339 or YYYY-MM-DD)`);
}

const MEDIA_TYPES = ['image', 'video', 'audio', 'sticker', 'document', 'gif', 'location', 'contact'];

export function isValidMediaType(s: string): boolean {
  return MEDIA_TYPES.includes(s.toLowerCase());
}
