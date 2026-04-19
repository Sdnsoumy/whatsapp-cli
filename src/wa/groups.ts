import type { WASocket, GroupMetadata, ParticipantAction } from '@whiskeysockets/baileys';
import type { GroupInfo, GroupParticipantInfo, GroupParticipantAction } from './types.js';

/**
 * Group operations — mirrors internal/wa/groups.go
 */

export async function getJoinedGroups(sock: WASocket): Promise<GroupInfo[]> {
  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups).map(metaToGroupInfo);
}

export async function getGroupInfo(sock: WASocket, jid: string): Promise<GroupInfo> {
  const meta = await sock.groupMetadata(jid);
  return metaToGroupInfo(meta);
}

export async function setGroupName(sock: WASocket, jid: string, name: string): Promise<void> {
  await sock.groupUpdateSubject(jid, name);
}

export async function updateGroupParticipants(
  sock: WASocket,
  groupJid: string,
  userJids: string[],
  action: GroupParticipantAction
): Promise<void> {
  const baileyAction: ParticipantAction =
    action === 'add'     ? 'add'     :
    action === 'remove'  ? 'remove'  :
    action === 'promote' ? 'promote' : 'demote';
  await sock.groupParticipantsUpdate(groupJid, userJids, baileyAction);
}

export async function getGroupInviteLink(
  sock: WASocket,
  jid: string,
  reset: boolean
): Promise<string> {
  if (reset) {
    await sock.groupRevokeInvite(jid);
  }
  const code = await sock.groupInviteCode(jid);
  return `https://chat.whatsapp.com/${code}`;
}

export async function joinGroupWithLink(sock: WASocket, inviteCode: string): Promise<string> {
  // Extract code from full URL if needed
  const code = inviteCode.replace('https://chat.whatsapp.com/', '').trim();
  const jid = await sock.groupAcceptInvite(code);
  return jid ?? '';
}

export async function leaveGroup(sock: WASocket, jid: string): Promise<void> {
  await sock.groupLeave(jid);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function metaToGroupInfo(meta: GroupMetadata): GroupInfo {
  const participants: GroupParticipantInfo[] = (meta.participants ?? []).map(p => ({
    jid: p.id,
    isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
    isSuperAdmin: p.admin === 'superadmin',
  }));
  return {
    jid: meta.id,
    name: meta.subject ?? '',
    ownerJid: meta.owner ?? '',
    createdAt: meta.creation ? new Date(meta.creation * 1000) : new Date(0),
    participants,
  };
}
