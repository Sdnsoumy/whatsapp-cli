import os from 'os';
import path from 'path';

/** Env var that overrides the default store directory. */
export const ENV_STORE_DIR = 'WACLI_STORE_DIR';

/**
 * Returns the store directory to use when --store is not supplied.
 * Checks WACLI_STORE_DIR first, then falls back to ~/.wacli.
 * Maps 1:1 from internal/config/config.go
 */
export function defaultStoreDir(): string {
  const envDir = process.env[ENV_STORE_DIR];
  if (envDir && envDir.trim() !== '') {
    return envDir.trim();
  }
  return path.join(os.homedir(), '.wacli');
}
