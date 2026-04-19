import fs from 'fs';
import path from 'path';
import { DB } from '../store/db.js';
import { WAClient } from '../wa/client.js';
import type { ConnectOptions } from '../wa/types.js';

export interface AppOptions {
  storeDir: string;
  version: string;
  json: boolean;
  allowUnauthed: boolean;
}

/**
 * Core application object — mirrors internal/app/app.go.
 * Holds references to the WA client and the local SQLite DB.
 */
export class App {
  private opts: AppOptions;
  private _wa: WAClient | null = null;
  private _db: DB;

  private constructor(opts: AppOptions, db: DB) {
    this.opts = opts;
    this._db = db;
  }

  /** Create and initialise the App. Opens the wacli.db SQLite database. */
  static create(opts: AppOptions): App {
    if (!opts.storeDir?.trim()) throw new Error('store dir is required');
    fs.mkdirSync(opts.storeDir, { recursive: true });
    const dbPath = path.join(opts.storeDir, 'wacli.db');
    const db = DB.open(dbPath);
    return new App(opts, db);
  }

  /** Open (or reuse) the WhatsApp client. Mirrors app.OpenWA() in Go. */
  openWA(): void {
    if (this._wa) return;
    const sessionDir = path.join(this.opts.storeDir, 'session');
    this._wa = WAClient.create({ sessionDir });
  }

  /** Connect to WhatsApp. Mirrors app.Connect() in Go. */
  async connect(allowQR: boolean, onQRCode?: (code: string) => void): Promise<void> {
    this.openWA();
    await this._wa!.connect({ allowQR, onQRCode });
  }

  /** Throws if not authenticated. Mirrors app.EnsureAuthed() in Go. */
  ensureAuthed(): void {
    this.openWA();
    if (!this._wa!.isAuthed()) {
      throw new Error('not authenticated; run `wacli auth`');
    }
  }

  /** Close all resources. Mirrors app.Close() in Go. */
  close(): void {
    this._wa?.close();
    this._db.close();
  }

  // ─── Accessors (mirror Go's exported methods) ─────────────────────────────

  wa(): WAClient {
    if (!this._wa) throw new Error('WA client not opened; call openWA() first');
    return this._wa;
  }

  db(): DB { return this._db; }

  storeDir(): string   { return this.opts.storeDir; }
  version(): string    { return this.opts.version; }
  isJSON(): boolean    { return this.opts.json; }
  allowUnauthed(): boolean { return this.opts.allowUnauthed; }
}
