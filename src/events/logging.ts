/**
 * Server logging event handlers.
 *
 * Wires Discord guild events to the centralized logger in
 * `src/utils/logger.ts`. Every change (roles, nicknames, members, channels,
 * messages) is sent as an embed to the configured logs channel
 * (`config.channels.logs`).
 *
 * Fails open: if logging fails for any reason, it never blocks core bot
 * functionality.
 */

import {
  Client,
  GuildMember,
  PartialGuildMember,
  Role,
  TextChannel,
  User,
  Message,
  GuildBan,
  NonThreadGuildBasedChannel,
  OmitPartialGroupDMChannel,
  DMChannel,
  PartialMessage,
} from 'discord.js';
import {
  logRoleCreate,
  logRoleDelete,
  logRoleUpdate,
  logMemberRoleChange,
  logNicknameChange,
  logMemberJoin,
  logMemberLeave,
  logMemberBan,
  logMemberUnban,
  logChannelCreate,
  logChannelDelete,
  logChannelUpdate,
  logMessageEdit,
  logMessageDelete,
} from '../utils/logger';

/** Thin client shape the logger expects. */
type LoggableClient = {
  channels: { cache: Map<string, any> };
};

/** Track previous roles per member to compute role diffs on update. */
const memberRolesCache = new Map<string, Set<string>>();

/**
 * Register all logging event listeners on the client.
 */
export function registerLoggingEvents(client: Client): void {
  /* ---------------------------------------------------------------- */
  /* Role events                                                      */
  /* ---------------------------------------------------------------- */

  client.on('roleCreate', (role: Role) => {
    logRoleCreate(role, client as unknown as LoggableClient).catch((err) =>
      console.error('[Logging] roleCreate error:', err),
    );
  });

  client.on('roleDelete', (role: Role) => {
    logRoleDelete(role, client as unknown as LoggableClient).catch((err) =>
      console.error('[Logging] roleDelete error:', err),
    );
  });

  client.on('roleUpdate', (oldRole: Role, newRole: Role) => {
    logRoleUpdate(oldRole, newRole, client as unknown as LoggableClient).catch(
      (err) => console.error('[Logging] roleUpdate error:', err),
    );
  });

  /* ---------------------------------------------------------------- */
  /* Member role + nickname updates                                   */
  /* ---------------------------------------------------------------- */

  client.on(
    'guildMemberUpdate',
    (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
      // Fetch full member if partial
      const oldFull =
        oldMember.partial
          ? oldMember.guild.members.cache.get(oldMember.id) ?? oldMember
          : oldMember;

      const oldRoles = memberRolesCache.get(oldMember.id) ?? new Set();
      const newRoles = new Set(newMember.roles.cache.keys());

      const addedRoles: Role[] = [];
      const removedRoles: Role[] = [];

      for (const roleId of newRoles) {
        if (!oldRoles.has(roleId)) {
          const role = newMember.roles.cache.get(roleId);
          if (role) addedRoles.push(role);
        }
      }
      for (const roleId of oldRoles) {
        if (!newRoles.has(roleId)) {
          const role = newMember.roles.cache.get(roleId);
          if (role) removedRoles.push(role);
        }
      }

      // Update cache for next diff
      memberRolesCache.set(newMember.id, newRoles);

      if (addedRoles.length > 0 || removedRoles.length > 0) {
        logMemberRoleChange(
          newMember,
          addedRoles,
          removedRoles,
          client as unknown as LoggableClient,
        ).catch((err) => console.error('[Logging] guildMemberUpdate roles error:', err));
      }

      if (oldFull.nickname !== newMember.nickname) {
        logNicknameChange(
          newMember,
          oldFull.nickname,
          newMember.nickname,
          client as unknown as LoggableClient,
        ).catch((err) => console.error('[Logging] guildMemberUpdate nickname error:', err));
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Member join / leave                                              */
  /* ---------------------------------------------------------------- */

  client.on('guildMemberAdd', (member: GuildMember) => {
    logMemberJoin(member, client as unknown as LoggableClient).catch((err) =>
      console.error('[Logging] guildMemberAdd error:', err),
    );
  });

  client.on(
    'guildMemberRemove',
    (member: GuildMember | PartialGuildMember) => {
      logMemberLeave(member as GuildMember, client as unknown as LoggableClient).catch(
        (err) => console.error('[Logging] guildMemberRemove error:', err),
      );
    },
  );

  /* ---------------------------------------------------------------- */
  /* Ban / unban                                                      */
  /* ---------------------------------------------------------------- */

  client.on('guildBanAdd', (guildBan: GuildBan) => {
    const { guild, user } = guildBan;
    logMemberBan(
      { id: guild.id, name: guild.name, memberCount: guild.memberCount },
      user,
      client as unknown as LoggableClient,
    ).catch((err) => console.error('[Logging] guildBanAdd error:', err));
  });

  client.on('guildBanRemove', (guildBan: GuildBan) => {
    const { guild, user } = guildBan;
    logMemberUnban(
      { id: guild.id, memberCount: guild.memberCount },
      user,
      client as unknown as LoggableClient,
    ).catch((err) => console.error('[Logging] guildBanRemove error:', err));
  });

  /* ---------------------------------------------------------------- */
  /* Channel events                                                   */
  /* ---------------------------------------------------------------- */

  client.on('channelCreate', (channel: NonThreadGuildBasedChannel) => {
    if (!channel.isTextBased()) return;
    logChannelCreate(channel as TextChannel, client as unknown as LoggableClient).catch(
      (err) => console.error('[Logging] channelCreate error:', err),
    );
  });

  client.on('channelDelete', (channel: DMChannel | NonThreadGuildBasedChannel) => {
    if (!channel.isTextBased()) return;
    logChannelDelete(channel as TextChannel, client as unknown as LoggableClient).catch(
      (err) => console.error('[Logging] channelDelete error:', err),
    );
  });

  client.on(
    'channelUpdate',
    (
      oldChannel: DMChannel | NonThreadGuildBasedChannel,
      newChannel: DMChannel | NonThreadGuildBasedChannel,
    ) => {
      if (!newChannel.isTextBased()) return;
      logChannelUpdate(
        oldChannel as TextChannel,
        newChannel as TextChannel,
        client as unknown as LoggableClient,
      ).catch((err) => console.error('[Logging] channelUpdate error:', err));
    },
  );

  /* ---------------------------------------------------------------- */
  /* Message events                                                   */
  /* ---------------------------------------------------------------- */

  client.on(
    'messageUpdate',
    (
      oldMessage: OmitPartialGroupDMChannel<Message | PartialMessage>,
      newMessage: OmitPartialGroupDMChannel<Message | PartialMessage>,
    ) => {
      if (!newMessage.guild || !oldMessage.guild) return;
      logMessageEdit(
        oldMessage as Message,
        newMessage as Message,
        client as unknown as LoggableClient,
      ).catch((err) => console.error('[Logging] messageUpdate error:', err));
    },
  );

  client.on(
    'messageDelete',
    (message: OmitPartialGroupDMChannel<Message | PartialMessage>) => {
      if (!message.guild) return;
      logMessageDelete(message as Message, client as unknown as LoggableClient).catch(
        (err) => console.error('[Logging] messageDelete error:', err),
      );
    },
  );
}
