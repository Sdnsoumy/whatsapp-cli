import type { App } from './app.js';
import type { MessageInfo } from '../wa/types.js';

/**
 * On-demand history sync — mirrors internal/app/backfill.go.
 */
export async function requestHistorySyncOnDemand(
  app: App,
  chatJid: string,
  count = 50
): Promise<string> {
  const oldest = app.db().getOldestMessageInfo(chatJid);
  if (!oldest) {
    throw new Error(`No messages found for chat ${chatJid}`);
  }
  const msgInfo: MessageInfo = {
    id: oldest.msgId,
    chatJid: oldest.chatJid,
    timestamp: oldest.timestamp,
    fromMe: oldest.fromMe,
    senderJid: oldest.senderJid,
    senderName: oldest.senderName,
  };
  return app.wa().requestHistorySyncOnDemand(msgInfo, count);
}
