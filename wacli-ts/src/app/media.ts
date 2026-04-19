import PQueue from 'p-queue';
import path from 'path';
import type { App } from './app.js';
import { mediaTypeFromString, mediaLocalPath } from '../wa/media.js';

export interface MediaJob {
  chatJid: string;
  msgId: string;
}

/**
 * Media download worker pool — mirrors internal/app/media.go.
 * Uses p-queue with concurrency=4 (same as Go's 4 goroutine workers).
 */
export function createMediaWorkers(
  app: App,
  concurrency = 4
): { enqueue: (job: MediaJob) => void; stop: () => void } {
  const queue = new PQueue({ concurrency });

  const enqueue = (job: MediaJob): void => {
    queue.add(() => downloadAndStoreMedia(app, job)).catch(() => {
      // Non-fatal — media download failures are ignored like in Go
    });
  };

  const stop = (): void => {
    queue.pause();
    queue.clear();
  };

  return { enqueue, stop };
}

async function downloadAndStoreMedia(app: App, job: MediaJob): Promise<void> {
  const info = app.db().getMediaForDownload(job.chatJid, job.msgId);
  if (!info) return;
  if (info.localPath) return; // Already downloaded

  const filename = info.filename || info.msgId;
  const targetPath = mediaLocalPath(app.storeDir(), info.chatJid, info.msgId, filename);
  const mediaType = mediaTypeFromString(info.mediaType);

  try {
    await app.wa().downloadMediaToFile(info, mediaType, targetPath);
    app.db().markMediaDownloaded(job.chatJid, job.msgId, targetPath);
  } catch {
    // Ignore per-file failures — same behaviour as Go version
  }
}
