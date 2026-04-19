import { Command } from 'commander';
import { writeJSON } from '../out/out.js';
import { newApp, closeApp, resolveStoreDir, getRootFlags } from './root.js';
import { requestHistorySyncOnDemand } from '../app/backfill.js';

/** history — mirrors cmd/wacli/history.go */
export function addHistoryCmd(program: Command): void {
  program.command('history <jid>')
    .description('Request on-demand history sync for a chat')
    .option('--count <n>', 'number of messages to request', '50')
    .action(async (jid, opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);
        const id = await requestHistorySyncOnDemand(app, jid, parseInt(opts.count, 10));
        if (flags.json) writeJSON({ request_id: id });
        else process.stdout.write(`History sync requested. Request ID: ${id}\n`);
      } finally {
        await closeApp(app, lock);
      }
    });
}
