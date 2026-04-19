import { Command } from 'commander';
import { writeJSON } from '../out/out.js';
import { newApp, closeApp, resolveStoreDir, getRootFlags } from './root.js';
import { parseUserOrJid } from '../wa/messages.js';

/** send — mirrors cmd/wacli/send.go */
export function addSendCmd(program: Command): void {
  program.command('send <to> <message>')
    .description('Send a text message')
    .action(async (to, message) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);
        const toJid = parseUserOrJid(to);
        const id = await app.wa().sendText(toJid, message);

        // Record to local DB
        const now = new Date();
        app.db().upsertChat(toJid, toJid.endsWith('@g.us') ? 'group' : 'dm', '', now);
        app.db().upsertMessage({
          chatJid: toJid, chatName: '', msgId: id,
          senderJid: '', senderName: 'me',
          timestamp: now, fromMe: true,
          text: message, displayText: message,
          mediaType: '', mediaCaption: '', filename: '', mimeType: '',
          directPath: '', mediaKey: null, fileSHA256: null, fileEncSHA256: null, fileLength: 0,
        });

        if (flags.json) {
          writeJSON({ id, to: toJid });
        } else {
          process.stdout.write(`Sent. ID: ${id}\n`);
        }
      } finally {
        await closeApp(app, lock);
      }
    });
}
