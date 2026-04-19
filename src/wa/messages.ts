import type { proto } from '@whiskeysockets/baileys';
import type { ParsedMessage, ParsedMedia } from './types.js';

/**
 * Parse a live incoming Baileys message event into a ParsedMessage.
 * Maps 1:1 from internal/wa/messages.go ParseLiveMessage()
 */
export function parseLiveMessage(msg: proto.IWebMessageInfo): ParsedMessage {
  const fromMe = msg.key?.fromMe ?? false;
  const chatJid = jidNormalise(msg.key?.remoteJid ?? '');
  const senderJid = fromMe
    ? ''
    : jidNormalise(msg.key?.participant ?? msg.key?.remoteJid ?? '');
  const pushName = msg.pushName ?? '';
  const timestamp = new Date((Number(msg.messageTimestamp ?? 0)) * 1000);
  const msgId = msg.key?.id ?? '';

  const pm: ParsedMessage = {
    id: msgId,
    chat: chatJid,
    senderJid,
    pushName,
    fromMe,
    timestamp,
    text: '',
    replyToId: '',
    replyToDisplay: '',
    reactionToId: '',
    reactionEmoji: '',
    media: null,
  };

  const m = msg.message;
  if (!m) return pm;

  // Plain text
  pm.text =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.ephemeralMessage?.message?.extendedTextMessage?.text ??
    '';

  // Quoted / reply
  const ctxInfo =
    m.extendedTextMessage?.contextInfo ??
    m.imageMessage?.contextInfo ??
    m.videoMessage?.contextInfo ??
    m.audioMessage?.contextInfo ??
    m.documentMessage?.contextInfo;
  if (ctxInfo?.stanzaId) {
    pm.replyToId = ctxInfo.stanzaId;
    pm.replyToDisplay =
      ctxInfo.quotedMessage?.conversation ??
      ctxInfo.quotedMessage?.extendedTextMessage?.text ??
      '';
  }

  // Reaction
  if (m.reactionMessage) {
    pm.reactionToId = m.reactionMessage.key?.id ?? '';
    pm.reactionEmoji = m.reactionMessage.text ?? '';
  }

  // Media
  pm.media = extractMedia(m);

  return pm;
}

/**
 * Parse a message from a HistorySync conversation item.
 * Maps 1:1 from internal/wa/messages.go ParseHistoryMessage()
 */
export function parseHistoryMessage(
  chatJid: string,
  msg: proto.IWebMessageInfo
): ParsedMessage {
  const pm = parseLiveMessage(msg);
  // Override chat JID from the conversation — same as Go version
  pm.chat = jidNormalise(chatJid);
  return pm;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip device suffix from JIDs (e.g. "123@s.whatsapp.net:5" → "123@s.whatsapp.net") */
export function jidNormalise(jid: string): string {
  return jid.replace(/:[\d]+(@|$)/, '$1');
}

/** Returns true if the JID is a group JID */
export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/** Returns true if the JID is a broadcast list */
export function isBroadcastJid(jid: string): boolean {
  return jid.endsWith('@broadcast');
}

/** Parse a phone number or full JID into a bare JID */
export function parseUserOrJid(s: string): string {
  s = s.trim();
  if (!s) throw new Error('recipient is required');
  if (s.includes('@')) return jidNormalise(s);
  // Plain phone number — append default server
  const digits = s.replace(/[^0-9]/g, '');
  return `${digits}@s.whatsapp.net`;
}

/** Determine the "best" display name for a contact */
export function bestContactName(info: {
  pushName?: string; fullName?: string; firstName?: string; businessName?: string;
}): string {
  return (
    info.fullName?.trim() ||
    info.firstName?.trim() ||
    info.businessName?.trim() ||
    info.pushName?.trim() ||
    ''
  );
}

// ─── Media extraction ─────────────────────────────────────────────────────────

function extractMedia(m: proto.IMessage): ParsedMedia | null {
  if (m.imageMessage)    return mediaFrom('image',    m.imageMessage,    m);
  if (m.videoMessage)    return mediaFrom('video',    m.videoMessage,    m);
  if (m.audioMessage)    return mediaFrom('audio',    m.audioMessage,    m);
  if (m.documentMessage) return mediaFrom('document', m.documentMessage, m);
  if (m.stickerMessage)  return mediaFrom('sticker',  m.stickerMessage,  m);
  return null;
}

function mediaFrom(
  type: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  msg: any,
  rawMessage: proto.IMessage
): ParsedMedia {
  return {
    type,
    caption:      msg.caption      ?? '',
    filename:     msg.fileName     ?? '',
    mimeType:     msg.mimetype     ?? '',
    directPath:   msg.directPath   ?? '',
    mediaKey:     msg.mediaKey     ? Buffer.from(msg.mediaKey)     : Buffer.alloc(0),
    fileSHA256:   msg.fileSha256   ? Buffer.from(msg.fileSha256)   : Buffer.alloc(0),
    fileEncSHA256:msg.fileEncSha256? Buffer.from(msg.fileEncSha256): Buffer.alloc(0),
    fileLength:   Number(msg.fileLength ?? 0),
    rawMessage,
  };
}
