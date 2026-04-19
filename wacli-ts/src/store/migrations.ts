import type BetterSqlite3 from 'better-sqlite3';

type DB = BetterSqlite3.Database;

/**
 * Database migrations — mirrors internal/store/migrations.go.
 * The SQL schema is identical to the Go version so existing wacli.db
 * files are fully compatible.
 */

interface Migration {
  version: number;
  name: string;
  up: (db: DB) => void;
}

const migrations: Migration[] = [
  { version: 1, name: 'core schema',                  up: migrateCoreSchema },
  { version: 2, name: 'messages display_text column', up: migrateMessagesDisplayText },
  { version: 3, name: 'messages fts',                 up: migrateMessagesFTS },
];

/**
 * Run all pending migrations in order.
 * Returns true if FTS5 is available and enabled.
 */
export function ensureSchema(db: DB): boolean {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set<number>(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[])
      .map(r => r.version)
  );

  let ftsEnabled = false;
  const now = Math.floor(Date.now() / 1000);

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    m.up(db);
    db.prepare(
      'INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)'
    ).run(m.version, m.name, now);
  }

  // Check if FTS table exists after migrations
  const ftsRow = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE name = 'messages_fts' AND type IN ('table','shadow')`)
    .get();
  ftsEnabled = !!ftsRow;

  return ftsEnabled;
}

// ---------------------------------------------------------------------------
// Individual migration functions
// ---------------------------------------------------------------------------

function migrateCoreSchema(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid             TEXT PRIMARY KEY,
      kind            TEXT NOT NULL,
      name            TEXT,
      last_message_ts INTEGER
    );

    CREATE TABLE IF NOT EXISTS contacts (
      jid           TEXT PRIMARY KEY,
      phone         TEXT,
      push_name     TEXT,
      full_name     TEXT,
      first_name    TEXT,
      business_name TEXT,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      jid        TEXT PRIMARY KEY,
      name       TEXT,
      owner_jid  TEXT,
      created_ts INTEGER,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_participants (
      group_jid  TEXT NOT NULL,
      user_jid   TEXT NOT NULL,
      role       TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (group_jid, user_jid),
      FOREIGN KEY (group_jid) REFERENCES groups(jid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS contact_aliases (
      jid        TEXT PRIMARY KEY,
      alias      TEXT NOT NULL,
      notes      TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contact_tags (
      jid        TEXT NOT NULL,
      tag        TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (jid, tag)
    );

    CREATE TABLE IF NOT EXISTS messages (
      rowid           INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid        TEXT NOT NULL,
      chat_name       TEXT,
      msg_id          TEXT NOT NULL,
      sender_jid      TEXT,
      sender_name     TEXT,
      ts              INTEGER NOT NULL,
      from_me         INTEGER NOT NULL,
      text            TEXT,
      display_text    TEXT,
      media_type      TEXT,
      media_caption   TEXT,
      filename        TEXT,
      mime_type       TEXT,
      direct_path     TEXT,
      media_key       BLOB,
      file_sha256     BLOB,
      file_enc_sha256 BLOB,
      file_length     INTEGER,
      local_path      TEXT,
      downloaded_at   INTEGER,
      UNIQUE(chat_jid, msg_id),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_jid, ts);
    CREATE INDEX IF NOT EXISTS idx_messages_ts      ON messages(ts);
  `);
}

function migrateMessagesDisplayText(db: DB): void {
  const cols = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
  const hasCol = cols.some(c => c.name.toLowerCase() === 'display_text');
  if (!hasCol) {
    db.exec('ALTER TABLE messages ADD COLUMN display_text TEXT');
  }
}

function migrateMessagesFTS(db: DB): void {
  // Check if FTS table exists
  const ftsRow = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE name = 'messages_fts' AND type IN ('table','shadow')`)
    .get();

  let ftsExists = !!ftsRow;

  if (ftsExists) {
    // Check if display_text column exists in FTS
    try {
      const ftsCols = db.prepare('PRAGMA table_info(messages_fts)').all() as { name: string }[];
      const hasDisplay = ftsCols.some(c => c.name.toLowerCase() === 'display_text');
      if (!hasDisplay) {
        db.exec('DROP TABLE IF EXISTS messages_fts');
        ftsExists = false;
      }
    } catch {
      db.exec('DROP TABLE IF EXISTS messages_fts');
      ftsExists = false;
    }
  }

  let created = false;
  if (!ftsExists) {
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          text,
          media_caption,
          filename,
          chat_name,
          sender_name,
          display_text
        )
      `);
      created = true;
    } catch {
      // FTS5 not available — continue without it
      return;
    }
  }

  // Install / replace triggers
  try {
    db.exec(`
      DROP TRIGGER IF EXISTS messages_ai;
      DROP TRIGGER IF EXISTS messages_ad;
      DROP TRIGGER IF EXISTS messages_au;

      CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, text, media_caption, filename, chat_name, sender_name, display_text)
        VALUES (new.rowid, COALESCE(new.text,''), COALESCE(new.media_caption,''), COALESCE(new.filename,''), COALESCE(new.chat_name,''), COALESCE(new.sender_name,''), COALESCE(new.display_text,''));
      END;

      CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
        DELETE FROM messages_fts WHERE rowid = old.rowid;
        INSERT INTO messages_fts(rowid, text, media_caption, filename, chat_name, sender_name, display_text)
        VALUES (new.rowid, COALESCE(new.text,''), COALESCE(new.media_caption,''), COALESCE(new.filename,''), COALESCE(new.chat_name,''), COALESCE(new.sender_name,''), COALESCE(new.display_text,''));
      END;
    `);
  } catch {
    return;
  }

  if (created) {
    try {
      db.exec(`
        INSERT INTO messages_fts(rowid, text, media_caption, filename, chat_name, sender_name, display_text)
        SELECT rowid,
               COALESCE(text,''),
               COALESCE(media_caption,''),
               COALESCE(filename,''),
               COALESCE(chat_name,''),
               COALESCE(sender_name,''),
               COALESCE(display_text,'')
        FROM messages
      `);
    } catch {
      // Non-fatal — search will still work, just without existing messages indexed
    }
  }
}
