/**
 * TypeScript types for the local SQLite store.
 * Maps 1:1 from internal/store/types.go
 */

export interface Chat {
  jid: string;
  kind: string;   // 'dm' | 'group' | 'broadcast' | 'unknown'
  name: string;
  lastMessageTs: Date;
}

export interface Group {
  jid: string;
  name: string;
  ownerJid: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupParticipant {
  groupJid: string;
  userJid: string;
  role: string;   // 'member' | 'admin' | 'superadmin'
  updatedAt: Date;
}

export interface Contact {
  jid: string;
  phone: string;
  name: string;
  alias: string;
  tags: string[];
  updatedAt: Date;
}

export interface Message {
  chatJid: string;
  chatName: string;
  msgId: string;
  senderJid: string;
  timestamp: Date;
  fromMe: boolean;
  text: string;
  displayText: string;
  mediaType: string;
  snippet: string;
}

export interface MessageInfo {
  chatJid: string;
  msgId: string;
  timestamp: Date;
  fromMe: boolean;
  senderJid: string;
  senderName: string;
}

export interface MediaDownloadInfo {
  chatJid: string;
  chatName: string;
  msgId: string;
  mediaType: string;
  filename: string;
  mimeType: string;
  directPath: string;
  mediaKey: Buffer;
  fileSHA256: Buffer;
  fileEncSHA256: Buffer;
  fileLength: number;
  localPath: string;
  downloadedAt: Date;
}

export interface UpsertMessageParams {
  chatJid: string;
  chatName: string;
  msgId: string;
  senderJid: string;
  senderName: string;
  timestamp: Date;
  fromMe: boolean;
  text: string;
  displayText: string;
  mediaType: string;
  mediaCaption: string;
  filename: string;
  mimeType: string;
  directPath: string;
  mediaKey: Buffer | null;
  fileSHA256: Buffer | null;
  fileEncSHA256: Buffer | null;
  fileLength: number;
}

export interface ListMessagesParams {
  chatJid?: string;
  limit?: number;
  before?: Date;
  after?: Date;
}

export interface SearchMessagesParams {
  query: string;
  chatJid?: string;
  from?: string;
  limit?: number;
  before?: Date;
  after?: Date;
  type?: string;
}

/** Convert a Date to a Unix timestamp (seconds). Returns 0 for invalid dates. */
export function toUnix(d: Date | undefined | null): number {
  if (!d || isNaN(d.getTime())) return 0;
  return Math.floor(d.getTime() / 1000);
}

/** Convert a Unix timestamp (seconds) to a Date. Returns epoch for 0. */
export function fromUnix(sec: number): Date {
  if (sec <= 0) return new Date(0);
  return new Date(sec * 1000);
}

/** Return null if the string is empty/whitespace, otherwise the string. */
export function nullIfEmpty(s: string | undefined | null): string | null {
  if (!s || s.trim() === '') return null;
  return s;
}

/** Convert boolean to 0/1 for SQLite. */
export function boolToInt(b: boolean): number {
  return b ? 1 : 0;
}
