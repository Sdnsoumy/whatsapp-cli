import type { WASocket, MediaType } from '@whiskeysockets/baileys';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { safePath } from '../pathutil/pathutil.js';

/**
 * Media download helpers — mirrors internal/wa/media.go.
 */

/**
 * Download a media message from WhatsApp and save it to disk.
 * Returns the number of bytes written.
 */
export async function downloadMediaToFile(
  sock: WASocket,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawMessage: any,
  mediaType: MediaType,
  targetPath: string
): Promise<number> {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const stream = await downloadMediaMessage(
    rawMessage,
    'buffer',
    {},
    { logger: undefined as never, reuploadRequest: sock.updateMediaMessage }
  );
  const buf = stream instanceof Buffer ? stream : Buffer.from(stream as Uint8Array);
  fs.writeFileSync(targetPath, buf);
  return buf.length;
}

/**
 * Map a string media-type name to a Baileys MediaType string.
 * Mirrors wa.MediaTypeFromString() in Go.
 */
export function mediaTypeFromString(s: string): MediaType {
  switch (s.toLowerCase().trim()) {
    case 'image':    return 'image';
    case 'video':    return 'video';
    case 'audio':    return 'audio';
    case 'sticker':  return 'sticker';
    case 'document': return 'document';
    default:         return 'document';
  }
}

/**
 * Build a safe local file path for a media download.
 * Prevents path traversal.
 */
export function mediaLocalPath(storeDir: string, chatJid: string, msgId: string, filename: string): string {
  const safeChat = chatJid.replace(/[^a-zA-Z0-9@._-]/g, '_');
  const safeMsg  = msgId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeName = filename
    ? filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    : safeMsg;
  return safePath(storeDir, 'media', safeChat, safeName);
}
