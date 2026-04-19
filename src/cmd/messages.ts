import { Command } from 'commander';
import { writeJSON } from '../out/out.js';
import { newApp, closeApp, resolveStoreDir, getRootFlags } from './root.js';
import { truncate, parseTime } from './helpers.js';

/** messages list / search / show / context — mirrors cmd/wacli/messages.go */
export function addMessagesCmd(program: Command): void {
  const cmd = program.command('messages').description('List and search messages from the local DB');

  // messages list
  cmd.command('list')
    .description('List messages')
    .option('--chat <jid>', 'filter by chat JID', '')
    .option('--limit <n>', 'limit results', '50')
    .option('--after <time>', 'only messages after time (RFC3339 or YYYY-MM-DD)', '')
    .option('--before <time>', 'only messages before time (RFC3339 or YYYY-MM-DD)', '')
    .action(async (opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, false, false);
      try {
        const msgs = app.db().listMessages({
          chatJid: opts.chat || undefined,
          limit:   parseInt(opts.limit, 10),
          after:   opts.after  ? parseTime(opts.after)  : undefined,
          before:  opts.before ? parseTime(opts.before) : undefined,
        });

        if (flags.json) {
          writeJSON({ messages: msgs, fts: app.db().hasFTS });
          return;
        }

        const cols = ['TIME'.padEnd(21), 'CHAT'.padEnd(26), 'FROM'.padEnd(20), 'ID'.padEnd(16), 'TEXT'];
        process.stdout.write(cols.join('  ') + '\n');
        for (const m of msgs) {
          const from = m.fromMe ? 'me' : m.senderJid;
          const chat = m.chatName || m.chatJid;
          const text = m.displayText || m.text || (m.mediaType ? `Sent ${m.mediaType}` : '');
          process.stdout.write([
            m.timestamp.toLocaleString().padEnd(21),
            truncate(chat, 24).padEnd(26),
            truncate(from, 18).padEnd(20),
            truncate(m.msgId, 14).padEnd(16),
            truncate(text, 80),
          ].join('  ') + '\n');
        }
      } finally {
        await closeApp(app, lock);
      }
    });

  // messages search
  cmd.command('search <query>')
    .description('Search messages (FTS5 if available; otherwise LIKE)')
    .option('--chat <jid>', 'filter by chat JID', '')
    .option('--from <jid>', 'filter by sender JID', '')
    .option('--type <type>', 'media type filter (image|video|audio|document)', '')
    .option('--limit <n>', 'limit results', '50')
    .option('--after <time>', 'only messages after time', '')
    .option('--before <time>', 'only messages before time', '')
    .action(async (query, opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, false, false);
      try {
        const msgs = app.db().searchMessages({
          query,
          chatJid: opts.chat || undefined,
          from:    opts.from  || undefined,
          type:    opts.type  || undefined,
          limit:   parseInt(opts.limit, 10),
          after:   opts.after  ? parseTime(opts.after)  : undefined,
          before:  opts.before ? parseTime(opts.before) : undefined,
        });

        if (flags.json) {
          writeJSON({ messages: msgs, fts: app.db().hasFTS });
          return;
        }

        const cols = ['TIME'.padEnd(21), 'CHAT'.padEnd(26), 'FROM'.padEnd(20), 'ID'.padEnd(16), 'MATCH'];
        process.stdout.write(cols.join('  ') + '\n');
        for (const m of msgs) {
          const from = m.fromMe ? 'me' : m.senderJid;
          const chat = m.chatName || m.chatJid;
          const match = m.snippet || m.displayText || m.text;
          process.stdout.write([
            m.timestamp.toLocaleString().padEnd(21),
            truncate(chat, 24).padEnd(26),
            truncate(from, 18).padEnd(20),
            truncate(m.msgId, 14).padEnd(16),
            truncate(match, 90),
          ].join('  ') + '\n');
        }
        if (!app.db().hasFTS) {
          process.stderr.write('Note: FTS5 not enabled; search is using LIKE (slow).\n');
        }
      } finally {
        await closeApp(app, lock);
      }
    });

  // messages show
  cmd.command('show')
    .description('Show one message')
    .requiredOption('--chat <jid>', 'chat JID')
    .requiredOption('--id <id>', 'message ID')
    .action(async (opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, false, false);
      try {
        const m = app.db().getMessage(opts.chat, opts.id);
        if (flags.json) { writeJSON(m); return; }
        process.stdout.write(`Chat: ${m.chatJid}\n`);
        if (m.chatName) process.stdout.write(`Chat name: ${m.chatName}\n`);
        process.stdout.write(`ID: ${m.msgId}\n`);
        process.stdout.write(`Time: ${m.timestamp.toISOString()}\n`);
        process.stdout.write(`From: ${m.fromMe ? 'me' : m.senderJid}\n`);
        if (m.mediaType) process.stdout.write(`Media: ${m.mediaType}\n`);
        process.stdout.write(`\n${m.text}\n`);
      } finally {
        await closeApp(app, lock);
      }
    });

  // messages context
  cmd.command('context')
    .description('Show message context around a message ID')
    .requiredOption('--chat <jid>', 'chat JID')
    .requiredOption('--id <id>', 'message ID')
    .option('--before <n>', 'messages before', '5')
    .option('--after <n>', 'messages after', '5')
    .action(async (opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, false, false);
      try {
        const msgs = app.db().messageContext(
          opts.chat, opts.id,
          parseInt(opts.before, 10),
          parseInt(opts.after, 10)
        );
        if (flags.json) { writeJSON(msgs); return; }
        process.stdout.write(['TIME'.padEnd(21), 'FROM'.padEnd(20), 'ID'.padEnd(16), 'TEXT'].join('  ') + '\n');
        for (const m of msgs) {
          const from = m.fromMe ? 'me' : m.senderJid;
          const line = m.msgId === opts.id ? `>> ${m.text}` : m.text;
          process.stdout.write([
            m.timestamp.toLocaleString().padEnd(21),
            truncate(from, 18).padEnd(20),
            truncate(m.msgId, 14).padEnd(16),
            truncate(line, 100),
          ].join('  ') + '\n');
        }
      } finally {
        await closeApp(app, lock);
      }
    });
}
