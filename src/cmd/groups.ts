import { Command } from 'commander';
import { writeJSON } from '../out/out.js';
import { newApp, closeApp, resolveStoreDir, getRootFlags } from './root.js';
import { parseUserOrJid } from '../wa/messages.js';
import { refreshGroups } from '../app/bootstrap.js';

/** groups — mirrors cmd/wacli/groups*.go (6 Go files consolidated) */
export function addGroupsCmd(program: Command): void {
  const cmd = program.command('groups').description('Group management');

  cmd.command('list')
    .description('List groups from the local DB')
    .action(async () => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, false, false);
      try {
        const groups = app.db().listGroups();
        if (flags.json) { writeJSON({ groups }); return; }
        process.stdout.write(`${groups.length} groups\n`);
        for (const g of groups) {
          process.stdout.write(`  ${g.jid.padEnd(40)} ${g.name}\n`);
        }
      } finally {
        await closeApp(app, lock);
      }
    });

  cmd.command('info <jid>')
    .description('Show group info (fetches from WhatsApp)')
    .action(async (jid) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);
        const info = await app.wa().getGroupInfo(jid);
        if (flags.json) { writeJSON(info); return; }
        process.stdout.write(`JID:      ${info.jid}\nName:     ${info.name}\nOwner:    ${info.ownerJid}\nMembers:  ${info.participants.length}\n`);
        for (const p of info.participants) {
          const role = p.isSuperAdmin ? 'superadmin' : p.isAdmin ? 'admin' : 'member';
          process.stdout.write(`  ${p.jid.padEnd(40)} ${role}\n`);
        }
      } finally {
        await closeApp(app, lock);
      }
    });

  cmd.command('rename <jid> <name>')
    .description('Rename a group')
    .action(async (jid, name) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);
        await app.wa().setGroupName(jid, name);
        if (flags.json) writeJSON({ ok: true });
        else process.stdout.write(`Group renamed to "${name}".\n`);
      } finally {
        await closeApp(app, lock);
      }
    });

  cmd.command('participants <jid>')
    .description('List participants of a group')
    .action(async (jid) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, false, false);
      try {
        const participants = app.db().listGroupParticipants(jid);
        if (flags.json) { writeJSON({ participants }); return; }
        for (const p of participants) {
          process.stdout.write(`  ${p.userJid.padEnd(40)} ${p.role}\n`);
        }
      } finally {
        await closeApp(app, lock);
      }
    });

  cmd.command('add <groupJid> <userJid>')
    .description('Add a participant to a group')
    .action(async (groupJid, userJid) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);
        await app.wa().updateGroupParticipants(groupJid, [parseUserOrJid(userJid)], 'add');
        if (flags.json) writeJSON({ ok: true });
        else process.stdout.write('Participant added.\n');
      } finally {
        await closeApp(app, lock);
      }
    });

  cmd.command('remove <groupJid> <userJid>')
    .description('Remove a participant from a group')
    .action(async (groupJid, userJid) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);
        await app.wa().updateGroupParticipants(groupJid, [parseUserOrJid(userJid)], 'remove');
        if (flags.json) writeJSON({ ok: true });
        else process.stdout.write('Participant removed.\n');
      } finally {
        await closeApp(app, lock);
      }
    });

  cmd.command('invite-link <jid>')
    .description('Get invite link for a group')
    .option('--reset', 'reset the invite link', false)
    .action(async (jid, opts) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);
        const link = await app.wa().getGroupInviteLink(jid, opts.reset);
        if (flags.json) writeJSON({ link });
        else process.stdout.write(`${link}\n`);
      } finally {
        await closeApp(app, lock);
      }
    });

  cmd.command('join <link>')
    .description('Join a group via invite link')
    .action(async (link) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);
        const jid = await app.wa().joinGroupWithLink(link);
        if (flags.json) writeJSON({ jid });
        else process.stdout.write(`Joined group: ${jid}\n`);
      } finally {
        await closeApp(app, lock);
      }
    });

  cmd.command('leave <jid>')
    .description('Leave a group')
    .action(async (jid) => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);
        await app.wa().leaveGroup(jid);
        if (flags.json) writeJSON({ ok: true });
        else process.stdout.write(`Left group: ${jid}\n`);
      } finally {
        await closeApp(app, lock);
      }
    });

  cmd.command('refresh')
    .description('Refresh groups list from WhatsApp')
    .action(async () => {
      const flags = getRootFlags(program);
      const storeDir = resolveStoreDir(flags);
      const { app, lock } = await newApp(storeDir, flags, true, false);
      try {
        app.ensureAuthed();
        await app.connect(false);
        await refreshGroups(app);
        const groups = app.db().listGroups();
        if (flags.json) writeJSON({ count: groups.length });
        else process.stdout.write(`Refreshed ${groups.length} groups.\n`);
      } finally {
        await closeApp(app, lock);
      }
    });
}
