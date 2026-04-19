import type { App } from './app.js';
import type { GroupInfo } from '../wa/types.js';
import { getGroupInfo } from '../wa/groups.js';

/**
 * Bootstrap helpers — mirrors internal/app/bootstrap.go.
 * Refreshes contacts and groups in one shot after connecting.
 */

export async function refreshContacts(app: App): Promise<void> {
  // Baileys doesn't expose a bulk-fetch contacts API without an external store.
  // Contacts get populated on-demand from message events (senderJid + pushName).
  // This function is a no-op placeholder that mirrors the Go signature.
}

export async function refreshGroups(app: App): Promise<void> {
  try {
    const groups = await app.wa().getJoinedGroups();
    for (const g of groups) {
      const now = new Date();
      app.db().upsertGroup(g.jid, g.name, g.ownerJid, g.createdAt || now);
      app.db().replaceGroupParticipants(
        g.jid,
        g.participants.map(p => ({
          groupJid: g.jid,
          userJid: p.jid,
          role: p.isSuperAdmin ? 'superadmin' : p.isAdmin ? 'admin' : 'member',
          updatedAt: now,
        }))
      );
    }
  } catch {
    // Non-fatal — group list is populated incrementally via message events
  }
}
