import path from 'path';

/**
 * Path sanitisation helpers — mirrors internal/pathutil/sanitize.go.
 * Guards against path-traversal and unsafe characters.
 */

/** Sanitize a filename so it is safe to use on the filesystem. */
export function sanitizeFilename(name: string): string {
  return name
    .trim()
    // Replace path separators
    .replace(/[/\\]/g, '_')
    // Replace null bytes and control characters
    .replace(/[\x00-\x1f\x7f]/g, '')
    // Replace remaining shell-special characters
    .replace(/[<>:"|?*]/g, '_')
    .trim();
}

/**
 * Resolve a path safely under a base directory.
 * Prevents path traversal (e.g. "../../etc/passwd").
 */
export function safePath(base: string, ...parts: string[]): string {
  const resolved = path.resolve(base, ...parts);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error(`Path traversal detected: ${parts.join('/')}`);
  }
  return resolved;
}

/** Returns true if the string contains characters that would be unsafe in a DB path. */
export function hasDBPathInjection(p: string): boolean {
  return p.includes('?') || p.includes('#');
}
