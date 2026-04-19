import { Command } from 'commander';
import { writeJSON } from '../out/out.js';
import { newApp, closeApp, resolveStoreDir, getRootFlags } from './root.js';
import { truncate } from './helpers.js';

/** chats list — mirrors cmd/wacli/chats.go */
export function addChatsCmd(program: Command): void {
  const cmd = program.command('chats').description('Chat management');

  cmd.command('list')
    .description('List chats from the local DB')
    .option('--limit <n>', 'limit results', '50')
    .action(async (opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, false, false);
      try {
        const chats = app.db().listChats(parseInt(opts.limit, 10));
        if (flags.json) { writeJSON({ chats }); return; }
        process.stdout.write(['JID'.padEnd(40), 'KIND'.padEnd(12), 'NAME'].join('  ') + '\n');
        for (const c of chats) {
          process.stdout.write([
            truncate(c.jid, 38).padEnd(40),
            c.kind.padEnd(12),
            c.name,
          ].join('  ') + '\n');
        }
      } finally {
        await closeApp(app, lock);
      }
    });
}
