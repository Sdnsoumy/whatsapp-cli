import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { ensureSchema } from './migrations.js';
import { hasDBPathInjection } from '../pathutil/pathutil.js';
import type {
  Chat, Contact, Group, GroupParticipant, Message, MessageInfo,
  MediaDownloadInfo, UpsertMessageParams, ListMessagesParams, SearchMessagesParams,
} from './types.js';
import { toUnix, fromUnix, nullIfEmpty, boolToInt } from './types.js';
import { escapeLIKE, sanitizeFTSQuery } from './search.js';

/**
 * Main SQLite database wrapper — mirrors internal/store/db.go.
 * Uses better-sqlite3 (synchronous API) which maps naturally
 * to Go's blocking database calls.
 */
export class DB {
  private db: Database.Database;
  private _ftsEnabled: boolean;

  private constructor(db: Database.Database, ftsEnabled: boolean) {
    this.db = db;
    this._ftsEnabled = ftsEnabled;
  }

  /** Open (or create) the SQLite database at the given path. */
  static open(dbPath: string): DB {
    if (!dbPath || dbPath.trim() === '') {
      throw new Error('db path is required');
    }
    if (hasDBPathInjection(dbPath)) {
      throw new Error("db path must not contain '?' or '#'");
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const sql = new Database(dbPath);

    // Apply WAL-mode pragmas — same as Go version
    sql.pragma('journal_mode = WAL');
    sql.pragma('synchronous = NORMAL');
    sql.pragma('temp_store = MEMORY');
    sql.pragma('foreign_keys = ON');
    sql.pragma('busy_timeout = 5000');

    const ftsEnabled = ensureSchema(sql);
    return new DB(sql, ftsEnabled);
  }

  close(): void {
    this.db.close();
  }

  get hasFTS(): boolean {
    return this._ftsEnabled;
  }

  // ─── Chats ────────────────────────────────────────────────────────────────

  upsertChat(jid: string, kind: string, name: string, lastMsgTs: Date): void {
    this.db.prepare(`
      INSERT INTO chats(jid, kind, name, last_message_ts)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        kind            = excluded.kind,
        name            = COALESCE(NULLIF(excluded.name,''), chats.name),
        last_message_ts = MAX(COALESCE(chats.last_message_ts,0), COALESCE(excluded.last_message_ts,0))
    `).run(jid, kind, nullIfEmpty(name), toUnix(lastMsgTs));
  }

  listChats(limit = 50): Chat[] {
    const rows = this.db.prepare(`
      SELECT jid, kind, COALESCE(name,''), COALESCE(last_message_ts,0)
      FROM chats
      ORDER BY last_message_ts DESC
      LIMIT ?
    `).all(limit) as [string, string, string, number][];
    return rows.map(([jid, kind, name, ts]) => ({
      jid, kind, name, lastMessageTs: fromUnix(ts),
    }));
  }

  // ─── Contacts ─────────────────────────────────────────────────────────────

  upsertContact(
    jid: string, phone: string, pushName: string,
    fullName: string, firstName: string, businessName: string
  ): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      INSERT INTO contacts(jid, phone, push_name, full_name, first_name, business_name, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        phone         = COALESCE(NULLIF(excluded.phone,''), contacts.phone),
        push_name     = COALESCE(NULLIF(excluded.push_name,''), contacts.push_name),
        full_name     = COALESCE(NULLIF(excluded.full_name,''), contacts.full_name),
        first_name    = COALESCE(NULLIF(excluded.first_name,''), contacts.first_name),
        business_name = COALESCE(NULLIF(excluded.business_name,''), contacts.business_name),
        updated_at    = excluded.updated_at
    `).run(jid, nullIfEmpty(phone), nullIfEmpty(pushName), nullIfEmpty(fullName),
           nullIfEmpty(firstName), nullIfEmpty(businessName), now);
  }

  listContacts(limit = 500): Contact[] {
    const contacts = this.db.prepare(`
      SELECT jid, COALESCE(phone,''), COALESCE(push_name,''), COALESCE(full_name,''), updated_at
      FROM contacts
      ORDER BY COALESCE(full_name, push_name, jid) ASC
      LIMIT ?
    `).all(limit) as [string, string, string, string, number][];

    return contacts.map(([jid, phone, pushName, fullName, ts]) => {
      const tags = (this.db.prepare(`SELECT tag FROM contact_tags WHERE jid = ?`).all(jid) as { tag: string }[])
        .map(r => r.tag);
      const alias = (this.db.prepare(`SELECT alias FROM contact_aliases WHERE jid = ?`).get(jid) as { alias: string } | undefined)?.alias ?? '';
      return { jid, phone, name: fullName || pushName, alias, tags, updatedAt: fromUnix(ts) };
    });
  }

  getContact(jid: string): Contact | null {
    const row = this.db.prepare(`
      SELECT jid, COALESCE(phone,''), COALESCE(push_name,''), COALESCE(full_name,''), updated_at
      FROM contacts WHERE jid = ?
    `).get(jid) as [string, string, string, string, number] | undefined;
    if (!row) return null;
    const [j, phone, pushName, fullName, ts] = row;
    return { jid: j, phone, name: fullName || pushName, alias: '', tags: [], updatedAt: fromUnix(ts) };
  }

  // ─── Groups ───────────────────────────────────────────────────────────────

  upsertGroup(jid: string, name: string, ownerJid: string, createdTs: Date): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      INSERT INTO groups(jid, name, owner_jid, created_ts, updated_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name       = COALESCE(NULLIF(excluded.name,''), groups.name),
        owner_jid  = COALESCE(NULLIF(excluded.owner_jid,''), groups.owner_jid),
        updated_at = excluded.updated_at
    `).run(jid, nullIfEmpty(name), nullIfEmpty(ownerJid), toUnix(createdTs), now);
  }

  listGroups(): Group[] {
    return (this.db.prepare(`
      SELECT jid, COALESCE(name,''), COALESCE(owner_jid,''), COALESCE(created_ts,0), updated_at
      FROM groups ORDER BY name ASC
    `).all() as [string, string, string, number, number][])
      .map(([jid, name, ownerJid, created, updated]) => ({
        jid, name, ownerJid,
        createdAt: fromUnix(created),
        updatedAt: fromUnix(updated),
      }));
  }

  replaceGroupParticipants(groupJid: string, participants: GroupParticipant[]): void {
    const now = Math.floor(Date.now() / 1000);
    const del = this.db.prepare('DELETE FROM group_participants WHERE group_jid = ?');
    const ins = this.db.prepare(
      'INSERT OR REPLACE INTO group_participants(group_jid, user_jid, role, updated_at) VALUES(?,?,?,?)'
    );
    this.db.transaction(() => {
      del.run(groupJid);
      for (const p of participants) {
        ins.run(p.groupJid, p.userJid, p.role, now);
      }
    })();
  }

  listGroupParticipants(groupJid: string): GroupParticipant[] {
    return (this.db.prepare(`
      SELECT group_jid, user_jid, COALESCE(role,'member'), updated_at
      FROM group_participants WHERE group_jid = ?
    `).all(groupJid) as [string, string, string, number][])
      .map(([groupJid, userJid, role, ts]) => ({
        groupJid, userJid, role, updatedAt: fromUnix(ts),
      }));
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  upsertMessage(p: UpsertMessageParams): void {
    this.db.prepare(`
      INSERT INTO messages(
        chat_jid, chat_name, msg_id, sender_jid, sender_name, ts, from_me, text, display_text,
        media_type, media_caption, filename, mime_type, direct_path,
        media_key, file_sha256, file_enc_sha256, file_length
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(chat_jid, msg_id) DO UPDATE SET
        chat_name       = COALESCE(NULLIF(excluded.chat_name,''), messages.chat_name),
        sender_jid      = excluded.sender_jid,
        sender_name     = COALESCE(NULLIF(excluded.sender_name,''), messages.sender_name),
        ts              = excluded.ts,
        from_me         = excluded.from_me,
        text            = excluded.text,
        display_text    = CASE WHEN excluded.display_text IS NOT NULL AND excluded.display_text != '' THEN excluded.display_text ELSE messages.display_text END,
        media_type      = excluded.media_type,
        media_caption   = excluded.media_caption,
        filename        = COALESCE(NULLIF(excluded.filename,''), messages.filename),
        mime_type       = COALESCE(NULLIF(excluded.mime_type,''), messages.mime_type),
        direct_path     = COALESCE(NULLIF(excluded.direct_path,''), messages.direct_path),
        media_key       = CASE WHEN excluded.media_key IS NOT NULL AND length(excluded.media_key)>0 THEN excluded.media_key ELSE messages.media_key END,
        file_sha256     = CASE WHEN excluded.file_sha256 IS NOT NULL AND length(excluded.file_sha256)>0 THEN excluded.file_sha256 ELSE messages.file_sha256 END,
        file_enc_sha256 = CASE WHEN excluded.file_enc_sha256 IS NOT NULL AND length(excluded.file_enc_sha256)>0 THEN excluded.file_enc_sha256 ELSE messages.file_enc_sha256 END,
        file_length     = CASE WHEN excluded.file_length>0 THEN excluded.file_length ELSE messages.file_length END
    `).run(
      p.chatJid, nullIfEmpty(p.chatName), p.msgId,
      nullIfEmpty(p.senderJid), nullIfEmpty(p.senderName),
      toUnix(p.timestamp), boolToInt(p.fromMe),
      nullIfEmpty(p.text), nullIfEmpty(p.displayText),
      nullIfEmpty(p.mediaType), nullIfEmpty(p.mediaCaption),
      nullIfEmpty(p.filename), nullIfEmpty(p.mimeType), nullIfEmpty(p.directPath),
      p.mediaKey, p.fileSHA256, p.fileEncSHA256, p.fileLength,
    );
  }

  getMessage(chatJid: string, msgId: string): Message {
    const row = this.db.prepare(`
      SELECT m.chat_jid, COALESCE(c.name,''), m.msg_id, COALESCE(m.sender_jid,''),
             m.ts, m.from_me, COALESCE(m.text,''), COALESCE(m.display_text,''),
             COALESCE(m.media_type,''), ''
      FROM messages m
      LEFT JOIN chats c ON c.jid = m.chat_jid
      WHERE m.chat_jid = ? AND m.msg_id = ?
    `).get(chatJid, msgId) as [string,string,string,string,number,number,string,string,string,string] | undefined;
    if (!row) throw new Error(`Message not found: ${chatJid}/${msgId}`);
    return rowToMessage(row);
  }

  listMessages(p: ListMessagesParams): Message[] {
    let query = `
      SELECT m.chat_jid, COALESCE(c.name,''), m.msg_id, COALESCE(m.sender_jid,''),
             m.ts, m.from_me, COALESCE(m.text,''), COALESCE(m.display_text,''),
             COALESCE(m.media_type,''), ''
      FROM messages m
      LEFT JOIN chats c ON c.jid = m.chat_jid
      WHERE 1=1`;
    const args: unknown[] = [];
    if (p.chatJid?.trim()) { query += ' AND m.chat_jid = ?'; args.push(p.chatJid); }
    if (p.after)           { query += ' AND m.ts > ?';       args.push(toUnix(p.after)); }
    if (p.before)          { query += ' AND m.ts < ?';       args.push(toUnix(p.before)); }
    query += ' ORDER BY m.ts DESC LIMIT ?';
    args.push(p.limit ?? 50);
    return (this.db.prepare(query).all(...args) as [string,string,string,string,number,number,string,string,string,string][])
      .map(rowToMessage);
  }

  countMessages(): number {
    return (this.db.prepare('SELECT COUNT(1) FROM messages').get() as { 'COUNT(1)': number })['COUNT(1)'];
  }

  getOldestMessageInfo(chatJid: string): MessageInfo | null {
    if (!chatJid.trim()) throw new Error('chat JID is required');
    const row = this.db.prepare(`
      SELECT m.chat_jid, m.msg_id, m.ts, m.from_me, COALESCE(m.sender_jid,''), COALESCE(m.sender_name,'')
      FROM messages m WHERE m.chat_jid = ? ORDER BY m.ts ASC LIMIT 1
    `).get(chatJid) as [string,string,number,number,string,string] | undefined;
    if (!row) return null;
    return { chatJid: row[0], msgId: row[1], timestamp: fromUnix(row[2]), fromMe: row[3]!==0, senderJid: row[4], senderName: row[5] };
  }

  messageContext(chatJid: string, msgId: string, before: number, after: number): Message[] {
    const target = this.getMessage(chatJid, msgId);
    const ts = toUnix(target.timestamp);

    const beforeRows = (this.db.prepare(`
      SELECT m.chat_jid, COALESCE(c.name,''), m.msg_id, COALESCE(m.sender_jid,''),
             m.ts, m.from_me, COALESCE(m.text,''), COALESCE(m.display_text,''),
             COALESCE(m.media_type,''), ''
      FROM messages m LEFT JOIN chats c ON c.jid = m.chat_jid
      WHERE m.chat_jid = ? AND m.ts < ? ORDER BY m.ts DESC LIMIT ?
    `).all(chatJid, ts, Math.max(0, before)) as [string,string,string,string,number,number,string,string,string,string][])
      .map(rowToMessage).reverse();

    const afterRows = (this.db.prepare(`
      SELECT m.chat_jid, COALESCE(c.name,''), m.msg_id, COALESCE(m.sender_jid,''),
             m.ts, m.from_me, COALESCE(m.text,''), COALESCE(m.display_text,''),
             COALESCE(m.media_type,''), ''
      FROM messages m LEFT JOIN chats c ON c.jid = m.chat_jid
      WHERE m.chat_jid = ? AND m.ts > ? ORDER BY m.ts ASC LIMIT ?
    `).all(chatJid, ts, Math.max(0, after)) as [string,string,string,string,number,number,string,string,string,string][])
      .map(rowToMessage);

    return [...beforeRows, target, ...afterRows];
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  searchMessages(p: SearchMessagesParams): Message[] {
    if (!p.query?.trim()) throw new Error('query is required');
    if (this._ftsEnabled) return this.searchFTS(p);
    return this.searchLIKE(p);
  }

  private searchLIKE(p: SearchMessagesParams): Message[] {
    const needle = `%${escapeLIKE(p.query)}%`;
    let query = `
      SELECT m.chat_jid, COALESCE(c.name,''), m.msg_id, COALESCE(m.sender_jid,''),
             m.ts, m.from_me, COALESCE(m.text,''), COALESCE(m.display_text,''),
             COALESCE(m.media_type,''), ''
      FROM messages m LEFT JOIN chats c ON c.jid = m.chat_jid
      WHERE (LOWER(m.text) LIKE LOWER(?) ESCAPE '\\'
          OR LOWER(m.display_text) LIKE LOWER(?) ESCAPE '\\'
          OR LOWER(m.media_caption) LIKE LOWER(?) ESCAPE '\\'
          OR LOWER(m.filename) LIKE LOWER(?) ESCAPE '\\'
          OR LOWER(COALESCE(m.chat_name,'')) LIKE LOWER(?) ESCAPE '\\'
          OR LOWER(COALESCE(m.sender_name,'')) LIKE LOWER(?) ESCAPE '\\'
          OR LOWER(COALESCE(c.name,'')) LIKE LOWER(?) ESCAPE '\\')`;
    const args: unknown[] = [needle, needle, needle, needle, needle, needle, needle];
    let [q2, a2] = applyFilters(query, args, p);
    q2 += ' ORDER BY m.ts DESC LIMIT ?';
    a2.push(p.limit ?? 50);
    return (this.db.prepare(q2).all(...a2) as [string,string,string,string,number,number,string,string,string,string][])
      .map(rowToMessage);
  }

  private searchFTS(p: SearchMessagesParams): Message[] {
    let query = `
      SELECT m.chat_jid, COALESCE(c.name,''), m.msg_id, COALESCE(m.sender_jid,''),
             m.ts, m.from_me, COALESCE(m.text,''), COALESCE(m.display_text,''),
             COALESCE(m.media_type,''),
             snippet(messages_fts, 0, '[', ']', '…', 12)
      FROM messages_fts
      JOIN messages m ON messages_fts.rowid = m.rowid
      LEFT JOIN chats c ON c.jid = m.chat_jid
      WHERE messages_fts MATCH ?`;
    const args: unknown[] = [sanitizeFTSQuery(p.query)];
    let [q2, a2] = applyFilters(query, args, p);
    q2 += ' ORDER BY bm25(messages_fts) LIMIT ?';
    a2.push(p.limit ?? 50);
    return (this.db.prepare(q2).all(...a2) as [string,string,string,string,number,number,string,string,string,string][])
      .map(rowToMessage);
  }

  // ─── Media ────────────────────────────────────────────────────────────────

  getMediaForDownload(chatJid: string, msgId: string): MediaDownloadInfo | null {
    const row = this.db.prepare(`
      SELECT m.chat_jid, COALESCE(c.name,''), m.msg_id, COALESCE(m.media_type,''),
             COALESCE(m.filename,''), COALESCE(m.mime_type,''), COALESCE(m.direct_path,''),
             m.media_key, m.file_sha256, m.file_enc_sha256, COALESCE(m.file_length,0),
             COALESCE(m.local_path,''), COALESCE(m.downloaded_at,0)
      FROM messages m
      LEFT JOIN chats c ON c.jid = m.chat_jid
      WHERE m.chat_jid = ? AND m.msg_id = ? AND m.media_type IS NOT NULL
    `).get(chatJid, msgId) as unknown[] | undefined;
    if (!row) return null;
    return {
      chatJid: String(row[0]), chatName: String(row[1]), msgId: String(row[2]),
      mediaType: String(row[3]), filename: String(row[4]), mimeType: String(row[5]),
      directPath: String(row[6]),
      mediaKey: row[7] ? Buffer.from(row[7] as Uint8Array) : Buffer.alloc(0),
      fileSHA256: row[8] ? Buffer.from(row[8] as Uint8Array) : Buffer.alloc(0),
      fileEncSHA256: row[9] ? Buffer.from(row[9] as Uint8Array) : Buffer.alloc(0),
      fileLength: Number(row[10]),
      localPath: String(row[11]),
      downloadedAt: fromUnix(Number(row[12])),
    };
  }

  markMediaDownloaded(chatJid: string, msgId: string, localPath: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      UPDATE messages SET local_path = ?, downloaded_at = ?
      WHERE chat_jid = ? AND msg_id = ?
    `).run(localPath, now, chatJid, msgId);
  }

  listPendingMedia(limit = 100): MediaDownloadInfo[] {
    const rows = this.db.prepare(`
      SELECT m.chat_jid, COALESCE(c.name,''), m.msg_id, COALESCE(m.media_type,''),
             COALESCE(m.filename,''), COALESCE(m.mime_type,''), COALESCE(m.direct_path,''),
             m.media_key, m.file_sha256, m.file_enc_sha256, COALESCE(m.file_length,0),
             COALESCE(m.local_path,''), COALESCE(m.downloaded_at,0)
      FROM messages m
      LEFT JOIN chats c ON c.jid = m.chat_jid
      WHERE m.media_type IS NOT NULL AND (m.local_path IS NULL OR m.local_path = '')
      ORDER BY m.ts DESC LIMIT ?
    `).all(limit) as unknown[][];
    return rows.map(row => ({
      chatJid: String(row[0]), chatName: String(row[1]), msgId: String(row[2]),
      mediaType: String(row[3]), filename: String(row[4]), mimeType: String(row[5]),
      directPath: String(row[6]),
      mediaKey: row[7] ? Buffer.from(row[7] as Uint8Array) : Buffer.alloc(0),
      fileSHA256: row[8] ? Buffer.from(row[8] as Uint8Array) : Buffer.alloc(0),
      fileEncSHA256: row[9] ? Buffer.from(row[9] as Uint8Array) : Buffer.alloc(0),
      fileLength: Number(row[10]),
      localPath: String(row[11]),
      downloadedAt: fromUnix(Number(row[12])),
    }));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type MsgRow = [string,string,string,string,number,number,string,string,string,string];

function rowToMessage(row: MsgRow): Message {
  return {
    chatJid: row[0], chatName: row[1], msgId: row[2], senderJid: row[3],
    timestamp: fromUnix(row[4]), fromMe: row[5] !== 0,
    text: row[6], displayText: row[7], mediaType: row[8], snippet: row[9],
  };
}

function applyFilters(query: string, args: unknown[], p: SearchMessagesParams): [string, unknown[]] {
  if (p.chatJid?.trim()) { query += ' AND m.chat_jid = ?';              args.push(p.chatJid); }
  if (p.from?.trim())    { query += ' AND m.sender_jid = ?';            args.push(p.from); }
  if (p.after)           { query += ' AND m.ts > ?';                    args.push(toUnix(p.after)); }
  if (p.before)          { query += ' AND m.ts < ?';                    args.push(toUnix(p.before)); }
  if (p.type?.trim())    { query += " AND COALESCE(m.media_type,'') = ?"; args.push(p.type); }
  return [query, args];
}
