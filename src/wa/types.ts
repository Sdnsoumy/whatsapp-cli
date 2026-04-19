/**
 * Shared types for the WhatsApp wrapper layer.
 * Maps 1:1 from internal/wa/messages.go types and app/sync.go ParsedMessage.
 */

export interface ParsedMedia {
  type: string;
  caption: string;
  filename: string;
  mimeType: string;
  directPath: string;
  mediaKey: Buffer;
  fileSHA256: Buffer;
  fileEncSHA256: Buffer;
  fileLength: number;
  /** Baileys media message object for downloading */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawMessage: any;
}

export interface ParsedMessage {
  id: string;
  /** JID string of the chat (DM or group) */
  chat: string;
  senderJid: string;
  pushName: string;
  fromMe: boolean;
  timestamp: Date;
  text: string;
  replyToId: string;
  replyToDisplay: string;
  reactionToId: string;
  reactionEmoji: string;
  media: ParsedMedia | null;
}

export interface ConnectOptions {
  allowQR: boolean;
  onQRCode?: (code: string) => void;
}

export type SyncMode = 'bootstrap' | 'once' | 'follow';

export type GroupParticipantAction = 'add' | 'remove' | 'promote' | 'demote';

export interface GroupInfo {
  jid: string;
  name: string;
  ownerJid: string;
  createdAt: Date;
  participants: GroupParticipantInfo[];
}

export interface GroupParticipantInfo {
  jid: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

export interface ContactInfo {
  found: boolean;
  jid: string;
  pushName: string;
  fullName: string;
  firstName: string;
  businessName: string;
}

export interface MessageInfo {
  id: string;
  chatJid: string;
  timestamp: Date;
  fromMe: boolean;
  senderJid: string;
  senderName: string;
}
