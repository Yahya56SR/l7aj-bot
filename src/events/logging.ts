/**
 * Server logging event handlers.
 *
 * Wires Discord guild events to the centralized logger in
 * `src/utils/logger.ts`. Every change (roles, nicknames, members, channels,
 * threads, stage instances, emojis, webhooks, messages, voice, moderation,
 * guild settings) is sent as an embed to the configured logs channel
 * (`config.channels.logs`, overridable via `config.logging.channelId`).
 *
 * Per-category toggles under `config.logging.categories` let admins reduce
 * noise. Logging always fails open: if logging fails for any reason, it
 * never blocks core bot functionality.
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
  VoiceState,
  AnyThreadChannel,
  ThreadMember,
  PartialThreadMember,
  StageInstance,
  GuildEmoji,
  Guild,
} from 'discord.js';
import {
  logRoleCreate,
  logRoleDelete,
  logRoleUpdate,
  logMemberRoleChange,
  logNicknameChange,
  logMemberJoin,
  logMemberLeave,
  logMemberBoost,
  logMemberTimeout,
  logMemberBan,
  logMemberUnban,
  logChannelCreate,
  logChannelDelete,
  logChannelUpdate,
  logThreadCreate,
  logThreadDelete,
  logThreadUpdate,
  logThreadMembersUpdate,
  logStageInstanceCreate,
  logStageInstanceUpdate,
  logStageInstanceDelete,
  logEmojiCreate,
  logEmojiUpdate,
  logEmojiDelete,
  logWebhookUpdate,
  logMessageEdit,
  logMessageDelete,
  logMessageBulkDelete,
  logVoiceStateUpdate,
  logGuildUpdate,
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
  /* Member role + nickname + timeout + boost updates                 */
  /* ---------------------------------------------------------------- */

  client.on(
    'guildMemberUpdate',
    (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
      // Fetch full member if partial
      const oldFull =
        oldMember.partial
          ? oldMember.guild.members.cache.get(oldMember.id) ?? oldMember
          : oldMember;

      const oldRoles = memberRolesCache.get(oldMember.id) ?? new Set(oldFull.roles.cache.keys());
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
          // A removed role is no longer in the member's cache, so resolve it
          // from the guild (or the old snapshot) instead.
          const role =
            newMember.guild.roles.cache.get(roleId) ??
            oldFull.roles.cache.get(roleId) ??
            null;
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

      // Timeout (communicationDisabledUntilTimestamp) changes
      const oldTimeout = oldFull.communicationDisabledUntilTimestamp ?? null;
      const newTimeout = newMember.communicationDisabledUntilTimestamp ?? null;
      if (oldTimeout !== newTimeout) {
        logMemberTimeout(
          newMember,
          oldTimeout,
          newTimeout,
          client as unknown as LoggableClient,
        ).catch((err) => console.error('[Logging] guildMemberUpdate timeout error:', err));
      }

      // Boost (premiumSince) changes
      const oldBoosted = !!oldFull.premiumSince;
      const newBoosted = !!newMember.premiumSince;
      if (oldBoosted !== newBoosted) {
        logMemberBoost(
          newMember,
          oldBoosted,
          newBoosted,
          client as unknown as LoggableClient,
        ).catch((err) => console.error('[Logging] guildMemberUpdate boost error:', err));
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
      memberRolesCache.delete(member.id);
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
  /* Thread events                                                    */
  /* ---------------------------------------------------------------- */

  client.on('threadCreate', (thread: AnyThreadChannel) => {
    logThreadCreate(thread, client as unknown as LoggableClient).catch((err) =>
      console.error('[Logging] threadCreate error:', err),
    );
  });

  client.on('threadDelete', (thread: AnyThreadChannel) => {
    logThreadDelete(thread, client as unknown as LoggableClient).catch((err) =>
      console.error('[Logging] threadDelete error:', err),
    );
  });

  client.on(
    'threadUpdate',
    (oldThread: AnyThreadChannel, newThread: AnyThreadChannel) => {
      logThreadUpdate(
        oldThread,
        newThread,
        client as unknown as LoggableClient,
      ).catch((err) => console.error('[Logging] threadUpdate error:', err));
    },
  );

  client.on(
    'threadMembersUpdate',
    (
      addedMembers: ReadonlyMap<string, ThreadMember>,
      removedMembers: ReadonlyMap<string, ThreadMember | PartialThreadMember>,
      thread: AnyThreadChannel,
    ) => {
      logThreadMembersUpdate(
        addedMembers,
        removedMembers,
        thread,
        client as unknown as LoggableClient,
      ).catch((err) => console.error('[Logging] threadMembersUpdate error:', err));
    },
  );

  /* ---------------------------------------------------------------- */
  /* Stage instance events                                            */
  /* ---------------------------------------------------------------- */

  client.on('stageInstanceCreate', (stageInstance: StageInstance) => {
    logStageInstanceCreate(
      stageInstance,
      client as unknown as LoggableClient,
    ).catch((err) => console.error('[Logging] stageInstanceCreate error:', err));
  });

  client.on(
    'stageInstanceUpdate',
    (oldStageInstance: StageInstance | null, newStageInstance: StageInstance) => {
      logStageInstanceUpdate(
        oldStageInstance,
        newStageInstance,
        client as unknown as LoggableClient,
      ).catch((err) => console.error('[Logging] stageInstanceUpdate error:', err));
    },
  );

  client.on('stageInstanceDelete', (stageInstance: StageInstance) => {
    logStageInstanceDelete(
      stageInstance,
      client as unknown as LoggableClient,
    ).catch((err) => console.error('[Logging] stageInstanceDelete error:', err));
  });

  /* ---------------------------------------------------------------- */
  /* Emoji events                                                     */
  /* ---------------------------------------------------------------- */

  client.on('emojiCreate', (emoji: GuildEmoji) => {
    logEmojiCreate(emoji, client as unknown as LoggableClient).catch((err) =>
      console.error('[Logging] emojiCreate error:', err),
    );
  });

  client.on(
    'emojiUpdate',
    (oldEmoji: GuildEmoji, newEmoji: GuildEmoji) => {
      logEmojiUpdate(
        oldEmoji,
        newEmoji,
        client as unknown as LoggableClient,
      ).catch((err) => console.error('[Logging] emojiUpdate error:', err));
    },
  );

  client.on('emojiDelete', (emoji: GuildEmoji) => {
    logEmojiDelete(emoji, client as unknown as LoggableClient).catch((err) =>
      console.error('[Logging] emojiDelete error:', err),
    );
  });

  /* ---------------------------------------------------------------- */
  /* Webhook events                                                   */
  /* ---------------------------------------------------------------- */

  client.on('webhooksUpdate', (channel) => {
    logWebhookUpdate(channel as TextChannel, client as unknown as LoggableClient).catch((err) =>
      console.error('[Logging] webhooksUpdate error:', err),
    );
  });

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

  client.on(
    'messageDeleteBulk',
    (messages, channel) => {
      if (!channel.guild) return;
      logMessageBulkDelete(
        messages as ReadonlyMap<string, any>,
        channel as TextChannel,
        client as unknown as LoggableClient,
      ).catch((err) => console.error('[Logging] messageDeleteBulk error:', err));
    },
  );

  /* ---------------------------------------------------------------- */
  /* Voice events                                                     */
  /* ---------------------------------------------------------------- */

  client.on('voiceStateUpdate', (oldState: VoiceState, newState: VoiceState) => {
    logVoiceStateUpdate(
      oldState,
      newState,
      client as unknown as LoggableClient,
    ).catch((err) => console.error('[Logging] voiceStateUpdate error:', err));
  });

  /* ---------------------------------------------------------------- */
  /* Guild events                                                     */
  /* ---------------------------------------------------------------- */

  client.on('guildUpdate', (oldGuild: Guild, newGuild: Guild) => {
    logGuildUpdate(
      oldGuild,
      newGuild,
      client as unknown as LoggableClient,
    ).catch((err) => console.error('[Logging] guildUpdate error:', err));
  });
}
