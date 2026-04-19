import { Command } from 'commander';
import { writeJSON } from '../out/out.js';
import { newApp, closeApp, resolveStoreDir, getRootFlags } from './root.js';
import { truncate } from './helpers.js';

/** contacts list / sync / show — mirrors cmd/wacli/contacts.go */
export function addContactsCmd(program: Command): void {
  const cmd = program.command('contacts').description('Contact management');

  cmd.command('list')
    .description('List contacts from the local DB')
    .option('--limit <n>', 'limit results', '500')
    .action(async (opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, false, false);
      try {
        const contacts = app.db().listContacts(parseInt(opts.limit, 10));
        if (flags.json) { writeJSON({ contacts }); return; }
        process.stdout.write(`${contacts.length} contacts\n`);
        for (const c of contacts) {
          process.stdout.write(`  ${truncate(c.jid, 30).padEnd(32)} ${c.name}\n`);
        }
      } finally {
        await closeApp(app, lock);
      }
    });

  cmd.command('sync')
    .description('Refresh contacts from WhatsApp (requires connection)')
    .action(async () => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);
        // Contacts are populated from message events; this is a best-effort sync
        process.stderr.write('Contacts are populated from message events. Run `wacli sync` to populate.\n');
        if (flags.json) writeJSON({ ok: true });
      } finally {
        await closeApp(app, lock);
      }
    });

  cmd.command('show <jid>')
    .description('Show a contact by JID')
    .action(async (jid) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, false, false);
      try {
        const c = app.db().getContact(jid);
        if (!c) throw new Error(`Contact not found: ${jid}`);
        if (flags.json) { writeJSON(c); return; }
        process.stdout.write(`JID:   ${c.jid}\nName:  ${c.name}\nPhone: ${c.phone}\n`);
      } finally {
        await closeApp(app, lock);
      }
    });
}
