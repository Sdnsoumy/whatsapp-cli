import { Command } from 'commander';
import { App, type AppOptions } from '../app/app.js';
import { Lock } from '../lock/lock.js';
import { writeError } from '../out/out.js';
import { defaultStoreDir } from '../config/config.js';
import path from 'path';
import { addAuthCmd } from './auth.js';
import { addSyncCmd } from './sync.js';
import { addMessagesCmd } from './messages.js';
import { addSendCmd } from './send.js';
import { addSendFileCmd } from './send-file.js';
import { addMediaCmd } from './media.js';
import { addContactsCmd } from './contacts.js';
import { addChatsCmd } from './chats.js';
import { addGroupsCmd } from './groups.js';
import { addHistoryCmd } from './history.js';
import { addDoctorCmd } from './doctor.js';

export const VERSION = '0.5.0';

export interface RootFlags {
  store: string;
  json: boolean;
  timeoutMs: number;
}

/**
 * Build and return the root Commander program.
 * Mirrors cmd/wacli/root.go execute()
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('wacli')
    .description('WhatsApp CLI')
    .version(VERSION, '-v, --version', 'output version')
    .option('--store <path>', 'store directory (default: $WACLI_STORE_DIR or ~/.wacli)', '')
    .option('--json', 'output JSON instead of human-readable text', false)
    .option('--timeout <ms>', 'command timeout in milliseconds', '300000');

  addAuthCmd(program);
  addSyncCmd(program);
  addMessagesCmd(program);
  addSendCmd(program);
  addSendFileCmd(program);
  addMediaCmd(program);
  addContactsCmd(program);
  addChatsCmd(program);
  addGroupsCmd(program);
  addHistoryCmd(program);
  addDoctorCmd(program);

  return program;
}

/** Resolve the store directory from flags or default. */
export function resolveStoreDir(flags: Pick<RootFlags, 'store'>): string {
  const raw = flags.store?.trim() || defaultStoreDir();
  return path.resolve(raw);
}

/** Create and return the App (and optional lock). */
export async function newApp(
  storeDir: string,
  flags: RootFlags,
  needLock: boolean,
  allowUnauthed: boolean
): Promise<{ app: App; lock: Lock | null }> {
  let lock: Lock | null = null;
  if (needLock) {
    lock = await Lock.acquire(storeDir);
  }

  try {
    const app = App.create({
      storeDir,
      version: VERSION,
      json: flags.json,
      allowUnauthed,
    });
    return { app, lock };
  } catch (e) {
    await lock?.release();
    throw e;
  }
}

/** Close app and release lock. */
export async function closeApp(app: App | null, lock: Lock | null): Promise<void> {
  app?.close();
  await lock?.release();
}

/** Get root flags from Commander's opts */
export function getRootFlags(program: Command): RootFlags {
  const opts = program.opts<{ store: string; json: boolean; timeout: string }>();
  return {
    store: opts.store ?? '',
    json: opts.json ?? false,
    timeoutMs: parseInt(opts.timeout ?? '300000', 10),
  };
}

/** Create a timeout + abort controller. */
export function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const t = ms > 0 ? setTimeout(() => ctrl.abort(), ms) : null;
  return {
    signal: ctrl.signal,
    cancel: () => { if (t) clearTimeout(t); ctrl.abort(); },
  };
}

/** Create a signal abort controller that resolves on SIGINT/SIGTERM. */
export function signalContext(): { signal: AbortSignal; stop: () => void } {
  const ctrl = new AbortController();
  const onSignal = () => ctrl.abort();
  process.once('SIGINT',  onSignal);
  process.once('SIGTERM', onSignal);
  return {
    signal: ctrl.signal,
    stop: () => {
      process.off('SIGINT',  onSignal);
      process.off('SIGTERM', onSignal);
      ctrl.abort();
    },
  };
}
