import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { writeJSON } from '../out/out.js';
import { newApp, closeApp, resolveStoreDir, getRootFlags } from './root.js';
import { parseUserOrJid } from '../wa/messages.js';
import { mediaTypeFromString } from '../wa/media.js';
import type { AnyMessageContent } from '@whiskeysockets/baileys';

/** send-file — mirrors cmd/wacli/send_file.go */
export function addSendFileCmd(program: Command): void {
  program.command('send-file <to> <file>')
    .description('Send a file (image/video/audio/document) to a chat')
    .option('--caption <text>', 'optional caption', '')
    .option('--filename <name>', 'display filename override', '')
    .option('--mime-type <mime>', 'MIME type override', '')
    .action(async (to, filePath, opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);

        const toJid = parseUserOrJid(to);
        const data = fs.readFileSync(filePath);
        const displayName = opts.filename?.trim() || path.basename(filePath);

        // Detect MIME
        let mimeType: string = opts.mimeType?.trim() || '';
        if (!mimeType) {
          mimeType = mime.lookup(filePath) || 'application/octet-stream';
        }

        // Determine media category
        let mediaType = 'document';
        if (mimeType.startsWith('image/'))       mediaType = 'image';
        else if (mimeType.startsWith('video/'))  mediaType = 'video';
        else if (mimeType.startsWith('audio/'))  mediaType = 'audio';

        const caption = opts.caption ?? '';

        // Build Baileys message content
        let content: AnyMessageContent;
        switch (mediaType) {
          case 'image':
            content = { image: data, caption, mimetype: mimeType };
            break;
          case 'video':
            content = { video: data, caption, mimetype: mimeType };
            break;
          case 'audio':
            content = { audio: data, mimetype: mimeType, ptt: false };
            break;
          default:
            content = { document: data, fileName: displayName, caption, mimetype: mimeType };
        }

        const id = await app.wa().sendMediaMessage(toJid, content);

        const now = new Date();
        app.db().upsertChat(toJid, toJid.endsWith('@g.us') ? 'group' : 'dm', '', now);
        app.db().upsertMessage({
          chatJid: toJid, chatName: '', msgId: id,
          senderJid: '', senderName: 'me',
          timestamp: now, fromMe: true,
          text: caption, displayText: `Sent ${mediaType}`,
          mediaType, mediaCaption: caption, filename: displayName,
          mimeType, directPath: '', mediaKey: null, fileSHA256: null, fileEncSHA256: null,
          fileLength: data.length,
        });

        if (flags.json) {
          writeJSON({ id, to: toJid, name: displayName, mime_type: mimeType, media: mediaType });
        } else {
          process.stdout.write(`Sent ${mediaType}. ID: ${id}\n`);
        }
      } finally {
        await closeApp(app, lock);
      }
    });
}
