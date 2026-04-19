import { Command } from 'commander';
import { sync as appSync } from '../app/sync.js';
import { writeJSON } from '../out/out.js';
import { newApp, closeApp, resolveStoreDir, getRootFlags, signalContext } from './root.js';

/** sync — mirrors cmd/wacli/sync.go */
export function addSyncCmd(program: Command): void {
  program.command('sync')
    .description('Sync messages from WhatsApp to the local database')
    .option('--mode <mode>', 'sync mode: bootstrap | once | follow', 'follow')
    .option('--download-media', 'download media in the background', false)
    .option('--refresh-contacts', 'refresh contacts list on connect', false)
    .option('--refresh-groups', 'refresh groups list on connect', false)
    .option('--idle-exit <ms>', 'exit after being idle (bootstrap/once modes)', '30000')
    .option('--max-reconnect <ms>', 'max reconnect time in ms (0 = unlimited)', '0')
    .action(async (opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      const { signal, stop } = signalContext();

      try {
        const res = await appSync(app, {
          mode:             opts.mode as 'bootstrap' | 'once' | 'follow',
          allowQR:          false,
          downloadMedia:    opts.downloadMedia,
          refreshContacts:  opts.refreshContacts,
          refreshGroups:    opts.refreshGroups,
          idleExitMs:       parseInt(opts.idleExit ?? '30000', 10),
          maxReconnectMs:   parseInt(opts.maxReconnect ?? '0', 10),
        }, signal);

        if (flags.json) {
          writeJSON({ messages_stored: res.messagesStored });
        } else {
          process.stdout.write(`Done. Messages stored: ${res.messagesStored}\n`);
        }
      } finally {
        stop();
        await closeApp(app, lock);
      }
    });
}
