import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket,
  type proto,
  type BaileysEventMap,
  type MediaType,
  type MiscMessageGenerationOptions,
  type AnyMessageContent,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import type { ConnectOptions, ContactInfo, GroupInfo, GroupParticipantAction, MessageInfo } from './types.js';
import { jidNormalise, bestContactName } from './messages.js';
import {
  getJoinedGroups, getGroupInfo, setGroupName,
  updateGroupParticipants, getGroupInviteLink,
  joinGroupWithLink, leaveGroup,
} from './groups.js';
import { downloadMediaToFile, mediaTypeFromString } from './media.js';

export interface WAClientOptions {
  /** Path to directory where session credentials are stored */
  sessionDir: string;
}

type EventHandler = (event: keyof BaileysEventMap, data: unknown) => void;

/**
 * Thread-safe WhatsApp client wrapper around @whiskeysockets/baileys.
 * Mirrors internal/wa/client.go (wa.Client).
 *
 * Key differences from Go:
 *  - JS is single-threaded so no mutex is needed; instead we guard
 *    against double-init with a simple flag.
 *  - Baileys is event-emitter based; we expose typed on/off helpers.
 */
export class WAClient {
  private opts: WAClientOptions;
  private sock: WASocket | null = null;
  private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private _isAuthed = false;

  private constructor(opts: WAClientOptions) {
    this.opts = opts;
  }

  static create(opts: WAClientOptions): WAClient {
    if (!opts.sessionDir?.trim()) throw new Error('sessionDir is required');
    fs.mkdirSync(opts.sessionDir, { recursive: true });
    return new WAClient(opts);
  }

  /** Returns true if a session exists (device is registered). */
  isAuthed(): boolean {
    return this._isAuthed;
  }

  /** Returns true if the WebSocket is connected. */
  isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  /**
   * Connect to WhatsApp.
   * If not authenticated and allowQR is true, shows a QR code.
   * Mirrors wa.Client.Connect() in Go.
   */
  async connect(opts: ConnectOptions): Promise<void> {
    if (this.connectionState === 'connected') return;

    const { state, saveCreds } = await useMultiFileAuthState(this.opts.sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    this._isAuthed = !!state.creds.registered;

    if (!this._isAuthed && !opts.allowQR) {
      throw new Error('not authenticated; run `wacli auth`');
    }

    return new Promise<void>((resolve, reject) => {
      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }) as never,
        browser: ['wacli', 'Chrome', '0.5.0'],
        syncFullHistory: true,
      });

      const sock = this.sock!;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          if (!opts.allowQR) {
            reject(new Error('not authenticated; run `wacli auth`'));
            return;
          }
          if (opts.onQRCode) {
            opts.onQRCode(qr);
          } else {
            process.stderr.write('\nScan this QR code with WhatsApp (Linked Devices):\n');
            QRCode.generate(qr, { small: true });
            process.stderr.write('\n');
          }
        }

        if (connection === 'close') {
          this.connectionState = 'disconnected';
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          if (loggedOut) {
            this._isAuthed = false;
            reject(new Error('Logged out'));
          }
          // Remaining disconnects propagate via the disconnected event
        }

        if (connection === 'open') {
          this.connectionState = 'connected';
          this._isAuthed = true;
          resolve();
        }
      });
    });
  }

  /** Disconnect and clean up. */
  close(): void {
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.connectionState = 'disconnected';
  }

  /**
   * Reconnect with exponential backoff.
   * Mirrors wa.Client.ReconnectWithBackoff() in Go.
   */
  async reconnectWithBackoff(
    signal: AbortSignal,
    minDelayMs = 2000,
    maxDelayMs = 30_000,
    onQRCode?: (code: string) => void
  ): Promise<void> {
    let delay = minDelayMs;
    while (!signal.aborted) {
      try {
        await this.connect({ allowQR: false, onQRCode });
        return;
      } catch {
        // Ignore and retry
      }
      await sleep(delay, signal);
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  /** Register an event handler on the Baileys socket. */
  on<K extends keyof BaileysEventMap>(
    event: K,
    handler: (data: BaileysEventMap[K]) => void
  ): void {
    this.sock?.ev.on(event, handler);
  }

  /** Remove an event handler from the Baileys socket. */
  off<K extends keyof BaileysEventMap>(
    event: K,
    handler: (data: BaileysEventMap[K]) => void
  ): void {
    this.sock?.ev.off(event, handler);
  }

  // ─── Messaging ─────────────────────────────────────────────────────────────

  async sendText(toJid: string, text: string): Promise<string> {
    this.assertConnected();
    const resp = await this.sock!.sendMessage(toJid, { text });
    return resp?.key?.id ?? '';
  }

  async sendMediaMessage(
    toJid: string,
    content: AnyMessageContent,
    opts?: MiscMessageGenerationOptions
  ): Promise<string> {
    this.assertConnected();
    const resp = await this.sock!.sendMessage(toJid, content, opts);
    return resp?.key?.id ?? '';
  }

  async upload(
    data: Buffer,
    mediaType: MediaType
  ): Promise<{ url: string; directPath: string; mediaKey: Buffer; fileSHA256: Buffer; fileEncSHA256: Buffer; fileLength: number }> {
    this.assertConnected();
    // Baileys waUploadToServer is internal; we use prepareWAMessageMedia instead
    // which is the public API for getting upload metadata
    const result = await this.sock!.waUploadToServer(
      data as unknown as never,
      mediaType as string as never,
    ) as unknown as { mediaUrl: string; directPath: string; handle: string };
    // For send-file use case, Baileys handles upload internally when we send
    // Return a minimal upload result
    return {
      url: (result as unknown as Record<string, string>).mediaUrl ?? '',
      directPath: result.directPath ?? '',
      mediaKey: Buffer.alloc(0),
      fileSHA256: Buffer.alloc(0),
      fileEncSHA256: Buffer.alloc(0),
      fileLength: data.length,
    };
  }

  async downloadMediaToFile(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawMessage: any,
    mediaType: MediaType,
    targetPath: string
  ): Promise<number> {
    this.assertConnected();
    return downloadMediaToFile(this.sock!, rawMessage, mediaType, targetPath);
  }

  // ─── Contacts ─────────────────────────────────────────────────────────────

  async getContact(jid: string): Promise<ContactInfo> {
    const key = jidNormalise(jid);
    // Baileys keeps contacts in memory store via authState
    // Return minimal info; full contacts come from message events
    return { found: false, jid: key, pushName: '', fullName: '', firstName: '', businessName: '' };
  }

  async getAllContacts(sock?: WASocket): Promise<ContactInfo[]> {
    // Baileys doesn't expose a bulk-contact API without a store plugin
    // We return an empty array; contacts are populated from message events
    return [];
  }

  async resolveChatName(
    jid: string,
    pushName: string,
    getGroupInfoFn?: (jid: string) => Promise<GroupInfo | null>
  ): Promise<string> {
    const fallback = jid;
    if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) {
      if (getGroupInfoFn) {
        const info = await getGroupInfoFn(jid).catch(() => null);
        if (info?.name?.trim()) return info.name;
      }
    }
    if (pushName?.trim() && pushName.trim() !== '-') return pushName.trim();
    return fallback;
  }

  // ─── Groups ────────────────────────────────────────────────────────────────

  async getJoinedGroups(): Promise<GroupInfo[]> {
    this.assertConnected();
    return getJoinedGroups(this.sock!);
  }

  async getGroupInfo(jid: string): Promise<GroupInfo> {
    this.assertConnected();
    return getGroupInfo(this.sock!, jid);
  }

  async setGroupName(jid: string, name: string): Promise<void> {
    this.assertConnected();
    return setGroupName(this.sock!, jid, name);
  }

  async updateGroupParticipants(
    groupJid: string, userJids: string[], action: GroupParticipantAction
  ): Promise<void> {
    this.assertConnected();
    return updateGroupParticipants(this.sock!, groupJid, userJids, action);
  }

  async getGroupInviteLink(jid: string, reset: boolean): Promise<string> {
    this.assertConnected();
    return getGroupInviteLink(this.sock!, jid, reset);
  }

  async joinGroupWithLink(code: string): Promise<string> {
    this.assertConnected();
    return joinGroupWithLink(this.sock!, code);
  }

  async leaveGroup(jid: string): Promise<void> {
    this.assertConnected();
    return leaveGroup(this.sock!, jid);
  }

  // ─── History ───────────────────────────────────────────────────────────────

  async requestHistorySyncOnDemand(
    lastKnown: MessageInfo,
    count = 50
  ): Promise<string> {
    this.assertConnected();
    if (!lastKnown.id || !lastKnown.chatJid || !lastKnown.timestamp) {
      throw new Error('invalid last known message info');
    }
    const ownJid = this.sock!.user?.id;
    if (!ownJid) throw new Error('not authenticated; run `wacli auth`');

    // Send history sync request to self as a peer message
    const resp = await (this.sock! as unknown as Record<string, Function>).sendMessage(
      jidNormalise(ownJid),
      { text: '' },
      { additionalNodes: [{ tag: 'peer_data_operation_request_type', content: 'HISTORY_SYNC' }] } as never
    );
    return (resp as Record<string, Record<string, string>>)?.key?.id ?? '';
  }

  async logout(): Promise<void> {
    if (!this.sock) throw new Error('not initialized');
    await this.sock.logout();
    this._isAuthed = false;
  }

  /** Expose the raw Baileys socket for advanced use */
  rawSocket(): WASocket | null {
    return this.sock;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this.sock || this.connectionState !== 'connected') {
      throw new Error('not connected');
    }
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

export { mediaTypeFromString, jidNormalise, bestContactName };
export type { GroupInfo, GroupParticipantAction, ContactInfo };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
