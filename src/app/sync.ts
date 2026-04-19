import type { proto, BaileysEventMap } from '@whiskeysockets/baileys';
import type { App } from './app.js';
import { parseLiveMessage, parseHistoryMessage, jidNormalise, isGroupJid, isBroadcastJid, bestContactName } from '../wa/messages.js';
import { refreshContacts, refreshGroups } from './bootstrap.js';
import { createMediaWorkers } from './media.js';
import type { UpsertMessageParams } from '../store/types.js';

export type SyncMode = 'bootstrap' | 'once' | 'follow';

export interface SyncOptions {
  mode?: SyncMode;
  allowQR?: boolean;
  onQRCode?: (code: string) => void;
  downloadMedia?: boolean;
  refreshContacts?: boolean;
  refreshGroups?: boolean;
  /** Exit after being idle for this many ms (bootstrap/once modes). Default: 30000 */
  idleExitMs?: number;
  /** Max reconnect time in ms (0 = unlimited). Default: 0 */
  maxReconnectMs?: number;
}

export interface SyncResult {
  messagesStored: number;
}

/**
 * Main sync engine — mirrors internal/app/sync.go App.Sync().
 *
 * Listens to WhatsApp events (history sync + live messages) and writes
 * everything to the local SQLite database.
 *
 * Three modes:
 *   bootstrap — connect, drain history, exit when idle
 *   once      — same but shorter idle window
 *   follow    — run indefinitely, auto-reconnect on disconnect
 */
export async function sync(app: App, opts: SyncOptions, signal: AbortSignal): Promise<SyncResult> {
  const mode: SyncMode = opts.mode ?? 'follow';
  const idleExitMs = opts.idleExitMs ?? (mode !== 'follow' ? 30_000 : 0);

  let messagesStored = 0;
  let lastEventAt = Date.now();

  // ─── Media workers ──────────────────────────────────────────────────────
  const media = opts.downloadMedia
    ? createMediaWorkers(app, 4)
    : null;

  // ─── Event handler ──────────────────────────────────────────────────────
  const onMessages = async (upsertEvent: BaileysEventMap['messages.upsert']): Promise<void> => {
    lastEventAt = Date.now();
    try {
      for (const msg of upsertEvent.messages) {
        const pm = parseLiveMessage(msg);
        if (!pm.id || !pm.chat) continue;

        if (await storeParsedMessage(app, pm)) {
          messagesStored++;
        }

        if (opts.downloadMedia && pm.media && pm.id) {
          media!.enqueue({ chatJid: pm.chat, msgId: pm.id });
        }

        if (messagesStored % 25 === 0) {
          process.stderr.write(`\rSynced ${messagesStored} messages...`);
        }
      }
    } catch (e) {
      process.stderr.write(`\nevent handler error: ${e}\n`);
    }
  };

  const onHistorySync = async (event: BaileysEventMap['messaging-history.set']): Promise<void> => {
    lastEventAt = Date.now();
    try {
      const { chats, messages } = event;
      process.stderr.write(`\nProcessing history sync (${chats.length} chats, ${messages.length} messages)...\n`);

      for (const msg of messages) {
        lastEventAt = Date.now();
        const chatJid = jidNormalise(msg.key?.remoteJid ?? '');
        if (!chatJid) continue;
        const pm = parseHistoryMessage(chatJid, msg);
        if (!pm.id || !pm.chat) continue;

        if (await storeParsedMessage(app, pm)) {
          messagesStored++;
        }
        if (opts.downloadMedia && pm.media && pm.id) {
          media!.enqueue({ chatJid: pm.chat, msgId: pm.id });
        }
      }
      process.stderr.write(`\rSynced ${messagesStored} messages...`);
    } catch (e) {
      process.stderr.write(`\nhistory sync error: ${e}\n`);
    }
  };

  // ─── Connect ────────────────────────────────────────────────────────────
  app.openWA();
  app.wa().on('messages.upsert', onMessages);
  app.wa().on('messaging-history.set', onHistorySync);

  try {
    await app.connect(opts.allowQR ?? false, opts.onQRCode);
  } catch (e) {
    app.wa().off('messages.upsert', onMessages);
    app.wa().off('messaging-history.set', onHistorySync);
    media?.stop();
    throw e;
  }

  process.stderr.write('\nConnected.\n');

  // ─── Optional bootstrap steps ───────────────────────────────────────────
  if (opts.refreshContacts) await refreshContacts(app);
  if (opts.refreshGroups)   await refreshGroups(app);

  // ─── Main loop ──────────────────────────────────────────────────────────
  try {
    if (mode === 'follow') {
      // Run until aborted (SIGINT / parent ctx cancel)
      await waitForAbort(signal);
      process.stderr.write('\nStopping sync.\n');
    } else {
      // bootstrap / once: exit when idle for idleExitMs
      await waitForIdle(signal, idleExitMs, () => lastEventAt);
    }
  } finally {
    app.wa().off('messages.upsert', onMessages);
    app.wa().off('messaging-history.set', onHistorySync);
    media?.stop();
  }

  return { messagesStored };
}

// ─── storeParsedMessage ────────────────────────────────────────────────────────

async function storeParsedMessage(
  app: App,
  pm: ReturnType<typeof parseLiveMessage>
): Promise<boolean> {
  const { chat } = pm;
  if (!chat || !pm.id) return false;

  const kind = chatKind(chat);
  const chatName = await resolveChatName(app, chat, pm.pushName);

  try {
    app.db().upsertChat(chat, kind, chatName, pm.timestamp);
  } catch { return false; }

  // Best-effort: store contact for DMs
  if (chat.endsWith('@s.whatsapp.net')) {
    // pushName is the best we have without a full contacts-store plugin
    app.db().upsertContact(chat, chat.split('@')[0] ?? '', pm.pushName, '', '', '');
  }

  // Best-effort: store group metadata
  if (chat.endsWith('@g.us')) {
    try {
      const gi = await app.wa().getGroupInfo(chat);
      app.db().upsertGroup(gi.jid, gi.name, gi.ownerJid, gi.createdAt);
      app.db().replaceGroupParticipants(
        gi.jid,
        gi.participants.map(p => ({
          groupJid: gi.jid,
          userJid: p.jid,
          role: p.isSuperAdmin ? 'superadmin' : p.isAdmin ? 'admin' : 'member',
          updatedAt: new Date(),
        }))
      );
    } catch { /* non-fatal */ }
  }

  const displayText = buildDisplayText(app, pm);

  const params: UpsertMessageParams = {
    chatJid:       chat,
    chatName,
    msgId:         pm.id,
    senderJid:     pm.senderJid,
    senderName:    pm.fromMe ? 'me' : pm.pushName,
    timestamp:     pm.timestamp,
    fromMe:        pm.fromMe,
    text:          pm.text,
    displayText,
    mediaType:     pm.media?.type ?? '',
    mediaCaption:  pm.media?.caption ?? '',
    filename:      pm.media?.filename ?? '',
    mimeType:      pm.media?.mimeType ?? '',
    directPath:    pm.media?.directPath ?? '',
    mediaKey:      pm.media?.mediaKey ?? null,
    fileSHA256:    pm.media?.fileSHA256 ?? null,
    fileEncSHA256: pm.media?.fileEncSHA256 ?? null,
    fileLength:    pm.media?.fileLength ?? 0,
  };

  try {
    app.db().upsertMessage(params);
    return true;
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chatKind(jid: string): string {
  if (jid.endsWith('@g.us'))        return 'group';
  if (jid.endsWith('@broadcast'))   return 'broadcast';
  if (jid.endsWith('@s.whatsapp.net')) return 'dm';
  return 'unknown';
}

async function resolveChatName(app: App, jid: string, pushName: string): Promise<string> {
  if (isGroupJid(jid) || isBroadcastJid(jid)) {
    try {
      const gi = await app.wa().getGroupInfo(jid);
      if (gi.name?.trim()) return gi.name.trim();
    } catch { /* fall through */ }
  }
  if (pushName?.trim() && pushName.trim() !== '-') return pushName.trim();
  return jid;
}

function buildDisplayText(app: App, pm: ReturnType<typeof parseLiveMessage>): string {
  const base = baseDisplayText(pm);

  if (pm.reactionToId || pm.reactionEmoji?.trim()) {
    let target = '';
    if (pm.reactionToId) {
      try { target = app.db().getMessage(pm.chat, pm.reactionToId).displayText || ''; } catch { /**/ }
    }
    if (!target) target = 'message';
    const emoji = pm.reactionEmoji?.trim();
    return emoji ? `Reacted ${emoji} to ${target}` : `Reacted to ${target}`;
  }

  if (pm.replyToId) {
    let quoted = pm.replyToDisplay?.trim() ?? '';
    if (!quoted) {
      try { quoted = app.db().getMessage(pm.chat, pm.replyToId).displayText || ''; } catch { /**/ }
    }
    if (!quoted) quoted = 'message';
    return `> ${quoted}\n${base || '(message)'}`;
  }

  return base || '(message)';
}

function baseDisplayText(pm: ReturnType<typeof parseLiveMessage>): string {
  if (pm.media) return `Sent ${mediaLabel(pm.media.type)}`;
  return pm.text?.trim() ?? '';
}

function mediaLabel(type: string): string {
  switch (type.toLowerCase()) {
    case 'image':    return 'image';
    case 'video':    return 'video';
    case 'audio':    return 'audio';
    case 'sticker':  return 'sticker';
    case 'document': return 'document';
    case 'location': return 'location';
    case 'contact':  return 'contact';
    default:         return type || 'message';
  }
}

// ─── Wait helpers ─────────────────────────────────────────────────────────────

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
}

async function waitForIdle(
  signal: AbortSignal,
  idleMs: number,
  getLastEvent: () => number
): Promise<void> {
  const pollMs = idleMs >= 2000 ? 1000 : 250;
  while (!signal.aborted) {
    await sleep(pollMs, signal);
    if (Date.now() - getLastEvent() >= idleMs) {
      process.stderr.write(`\nIdle for ${idleMs}ms, exiting.\n`);
      return;
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
