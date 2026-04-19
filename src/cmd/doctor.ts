import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { writeJSON } from '../out/out.js';
import { newApp, closeApp, resolveStoreDir, getRootFlags } from './root.js';
import { defaultStoreDir } from '../config/config.js';

/** doctor — mirrors cmd/wacli/doctor.go */
export function addDoctorCmd(program: Command): void {
  program.command('doctor')
    .description('Check health: auth status, DB, session file')
    .action(async () => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);

      const checks: Record<string, string | boolean> = {};

      // Check store directory
      checks.store_dir = storeDir;
      checks.store_dir_exists = fs.existsSync(storeDir);

      // Check wacli.db
      const dbPath = path.join(storeDir, 'wacli.db');
      checks.db_exists = fs.existsSync(dbPath);

      // Check session directory
      const sessionDir = path.join(storeDir, 'session');
      checks.session_dir_exists = fs.existsSync(sessionDir);

      // Check auth status
      let authed = false;
      let messageCount = 0;
      if (checks.db_exists) {
        const { app, lock } = await newApp(storeDir, flags, false, true);
        try {
          app.openWA();
          authed = app.wa().isAuthed();
          messageCount = app.db().countMessages();
        } catch { /* non-fatal */ }
        finally {
          await closeApp(app, lock);
        }
      }
      checks.authenticated = authed;
      (checks as Record<string, unknown>).message_count = messageCount;

      if (flags.json) {
        writeJSON(checks);
        return;
      }

      for (const [key, val] of Object.entries(checks)) {
        const icon = val === true ? '✓' : val === false ? '✗' : ' ';
        process.stdout.write(`  ${icon}  ${key.padEnd(24)} ${val}\n`);
      }
    });
}
