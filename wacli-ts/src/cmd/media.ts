import { Command } from 'commander';
import { writeJSON } from '../out/out.js';
import { newApp, closeApp, resolveStoreDir, getRootFlags } from './root.js';
import { mediaTypeFromString } from '../wa/media.js';

/** media download / list-pending — mirrors cmd/wacli/media.go */
export function addMediaCmd(program: Command): void {
  const cmd = program.command('media').description('Media download commands');

  // media download --chat <jid> --id <msgId>
  cmd.command('download')
    .description('Download media for a specific message')
    .requiredOption('--chat <jid>', 'chat JID')
    .requiredOption('--id <msgId>', 'message ID')
    .action(async (opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);

        const info = app.db().getMediaForDownload(opts.chat, opts.id);
        if (!info) throw new Error(`No media message found for ${opts.chat}/${opts.id}`);
        if (info.localPath) {
          if (flags.json) writeJSON({ already_downloaded: true, local_path: info.localPath });
          else process.stdout.write(`Already downloaded: ${info.localPath}\n`);
          return;
        }

        const filename = info.filename || info.msgId;
        const targetPath = require('path').join(storeDir, 'media', info.chatJid.replace(/[^a-zA-Z0-9@._-]/g, '_'), filename);
        const mediaType = mediaTypeFromString(info.mediaType);

        const bytes = await app.wa().downloadMediaToFile(info, mediaType, targetPath);
        app.db().markMediaDownloaded(opts.chat, opts.id, targetPath);

        if (flags.json) writeJSON({ local_path: targetPath, bytes });
        else process.stdout.write(`Downloaded to: ${targetPath} (${bytes} bytes)\n`);
      } finally {
        await closeApp(app, lock);
      }
    });

  // media list-pending
  cmd.command('list-pending')
    .description('List messages with un-downloaded media')
    .option('--limit <n>', 'limit results', '100')
    .action(async (opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, false, false);
      try {
        const rows = app.db().listPendingMedia(parseInt(opts.limit, 10));
        if (flags.json) { writeJSON({ pending: rows }); return; }
        process.stdout.write(`Pending media downloads: ${rows.length}\n`);
        for (const r of rows) {
          process.stdout.write(`  ${r.chatJid}  ${r.msgId}  ${r.mediaType}  ${r.filename}\n`);
        }
      } finally {
        await closeApp(app, lock);
      }
    });
}
