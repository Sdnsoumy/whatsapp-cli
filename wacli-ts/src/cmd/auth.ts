import { Command } from 'commander';
import { sync } from '../app/sync.js';
import { writeJSON } from '../out/out.js';
import { newApp, closeApp, resolveStoreDir, getRootFlags, signalContext } from './root.js';

/** auth, auth status, auth logout — mirrors cmd/wacli/auth.go */
export function addAuthCmd(program: Command): void {
  const authCmd = program.command('auth')
    .description('Authenticate with WhatsApp (QR) and bootstrap sync');

  authCmd
    .option('--follow', 'keep syncing after auth', false)
    .option('--idle-exit <ms>', 'exit after being idle (bootstrap/once modes)', '30000')
    .option('--download-media', 'download media in the background during sync', false)
    .action(async (opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, true);
      const { signal, stop } = signalContext();

      try {
        const mode = opts.follow ? 'follow' : 'bootstrap';
        process.stderr.write('Starting authentication…\n');

        const res = await sync(app, {
          mode,
          allowQR: true,
          downloadMedia: opts.downloadMedia,
          refreshContacts: true,
          refreshGroups: true,
          idleExitMs: parseInt(opts.idleExit ?? '30000', 10),
        }, signal);

        if (flags.json) {
          writeJSON({ authenticated: true, messages_stored: res.messagesStored });
        } else {
          process.stdout.write(`Authenticated. Messages stored: ${res.messagesStored}\n`);
        }
      } finally {
        stop();
        await closeApp(app, lock);
      }
    });

  // auth status sub-command
  authCmd.command('status')
    .description('Show authentication status')
    .action(async () => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, false, true);
      try {
        app.openWA();
        const authed = app.wa().isAuthed();
        if (flags.json) {
          writeJSON({ authenticated: authed });
        } else {
          process.stdout.write(authed ? 'Authenticated.\n' : 'Not authenticated. Run `wacli auth`.\n');
        }
      } finally {
        await closeApp(app, lock);
      }
    });

  // auth logout sub-command
  authCmd.command('logout')
    .description('Logout (invalidate session)')
    .action(async () => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, true);
      try {
        app.ensureAuthed();
        await app.connect(false);
        await app.wa().logout();
        if (flags.json) {
          writeJSON({ logged_out: true });
        } else {
          process.stdout.write('Logged out.\n');
        }
      } finally {
        await closeApp(app, lock);
      }
    });
}
