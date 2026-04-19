import lockfile from 'proper-lockfile';
import path from 'path';
import fs from 'fs';

/**
 * A file-based process lock that prevents two wacli instances
 * from running against the same store simultaneously.
 * Maps 1:1 from internal/lock/lock.go
 */
export class Lock {
  private lockPath: string;
  private released = false;

  private constructor(lockPath: string) {
    this.lockPath = lockPath;
  }

  /** Acquire a lock on the store directory. Throws if already locked. */
  static async acquire(storeDir: string): Promise<Lock> {
    // Ensure the directory exists before locking
    fs.mkdirSync(storeDir, { recursive: true });
    const lockPath = path.join(storeDir, 'wacli.lock');

    // Create the lock file if it doesn't exist
    if (!fs.existsSync(lockPath)) {
      fs.writeFileSync(lockPath, '');
    }

    try {
      await lockfile.lock(lockPath, {
        stale: 10_000,   // Consider lock stale after 10s (process died)
        retries: { retries: 2, minTimeout: 100 },
      });
    } catch {
      throw new Error(
        `Another wacli process is already running against ${storeDir}. ` +
        `If this is wrong, delete ${lockPath} and try again.`
      );
    }

    return new Lock(lockPath);
  }

  /** Release the lock. Safe to call multiple times. */
  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    try {
      await lockfile.unlock(this.lockPath);
    } catch {
      // Ignore errors on release — process is exiting anyway
    }
  }
}
