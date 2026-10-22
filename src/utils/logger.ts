/**
 * Centralized server logging utility.
 *
 * Sends structured embed messages to the configured logs channel for
 * server changes: roles, members, channels, messages, voice, threads,
 * stage instances, emojis, webhooks, moderation, guild settings, commands
 * and bot config changes.
 *
 * Per-category toggles live under `config.logging.categories`; the log
 * channel is `config.logging.channelId` when set, otherwise
 * `config.channels.logs`.
 *
 * Designed to fail open: if the logs channel is missing or the message
 * cannot be sent, logging is silently skipped so it never blocks core
 * bot functionality.
 */

import {
  EmbedBuilder,
  GuildMember,
  Role,
  TextChannel,
  User,
  Message,
  VoiceState,
  Guild,
  StageInstance,
  AnyThreadChannel,
  ThreadMember,
  PartialThreadMember,
  GuildEmoji,
} from 'discord.js';
import { getConfig } from '../config';

const LOG_COLOR = 0x5865f2;
const EMBED_FOOTER = 'TALABA <3 Server Logs';

/** Per-category toggles for server event logging. */
export interface LoggingCategory {
  roles: boolean;
  members: boolean;
  channels: boolean;
  messages: boolean;
  voice: boolean;
  threads: boolean;
  stage: boolean;
  emojis: boolean;
  webhooks: boolean;
  moderation: boolean;
  guild: boolean;
  commands: boolean;
  config: boolean;
}

/** Thin client shape the logger needs to send messages. */
type LoggableClient = {
  channels: { cache: Map<string, any> };
};

/** Resolve the log channel id: logging.channelId overrides channels.logs. */
function resolveLogChannelId(): string | null {
  const cfg = getConfig();
  if (!cfg.logging.enabled) return null;
  return cfg.logging.channelId || cfg.channels.logs || null;
}

/** Check whether a given logging category is currently enabled. */
function isCategoryEnabled(category: keyof LoggingCategory): boolean {
  const cfg = getConfig();
  return cfg.logging.enabled && !!cfg.logging.categories[category];
}

/** Send a log embed to the configured logs channel for the given guild. */
async function sendLog(
  guildId: string,
  embed: EmbedBuilder,
  client: LoggableClient,
  category?: keyof LoggingCategory,
): Promise<void> {
  if (category !== undefined && !isCategoryEnabled(category)) return;

  const channelId = resolveLogChannelId();
  if (!channelId) return;

  const channel = client.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return;

  try {
    await channel.send({ embeds: [embed] });
  } catch {
    // Ignore send errors (missing permissions, etc.)
  }
}

/** Build a standard embed with timestamp and footer. */
function baseEmbed(title: string, color: number = LOG_COLOR): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setTimestamp()
    .setFooter({ text: EMBED_FOOTER });
}

/** Format a user mention + id line. */
function userLine(user: { id: string; username?: string; tag?: string }): string {
  return `<@${user.id}> (\`${user.id}\`)`;
}

/** Keep embed field values inside Discord's 1024-character limit. */
function truncate(value: string, max = 1000): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/* -------------------------------------------------------------------------- */
/* Role events                                                                */
/* -------------------------------------------------------------------------- */

/** Log a role being created. */
export async function logRoleCreate(
  role: Role,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🆕 Role Created', 0x57f287)
    .addFields(
      { name: 'Role', value: `${role} (\`${role.id}\`)`, inline: true },
      { name: 'Color', value: role.hexColor ?? 'Default', inline: true },
      { name: 'Mentionable', value: String(role.mentionable), inline: true },
      { name: 'Hoisted', value: String(role.hoist), inline: true },
    );
  await sendLog(role.guild.id, embed, client, 'roles');
}

/** Log a role being deleted. */
export async function logRoleDelete(
  role: Role,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🗑️ Role Deleted', 0xed4245)
    .addFields(
      { name: 'Role', value: role.name, inline: true },
      { name: 'Role ID', value: `\`${role.id}\``, inline: true },
      { name: 'Color', value: role.hexColor ?? 'Default', inline: true },
    );
  await sendLog(role.guild.id, embed, client, 'roles');
}

/** Log a role being updated (name, color, permissions, etc.). */
export async function logRoleUpdate(
  oldRole: Role,
  newRole: Role,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('📝 Role Updated', 0xfeca57)
    .addFields(
      { name: 'Role', value: `${newRole} (\`${newRole.id}\`)`, inline: true },
    );

  if (oldRole.name !== newRole.name) {
    embed.addFields({
      name: 'Name',
      value: `**Before:** ${oldRole.name}\n**After:** ${newRole.name}`,
    });
  }
  if (oldRole.hexColor !== newRole.hexColor) {
    embed.addFields({
      name: 'Color',
      value: `**Before:** ${oldRole.hexColor ?? 'Default'}\n**After:** ${newRole.hexColor ?? 'Default'}`,
    });
  }
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
    embed.addFields({
      name: 'Permissions',
      value: 'Permission bitfield changed (see audit log for details).',
    });
  }
  if (oldRole.mentionable !== newRole.mentionable) {
    embed.addFields({
      name: 'Mentionable',
      value: `**Before:** ${oldRole.mentionable}\n**After:** ${newRole.mentionable}`,
      inline: true,
    });
  }
  if (oldRole.hoist !== newRole.hoist) {
    embed.addFields({
      name: 'Hoisted',
      value: `**Before:** ${oldRole.hoist}\n**After:** ${newRole.hoist}`,
      inline: true,
    });
  }

  await sendLog(newRole.guild.id, embed, client, 'roles');
}

/** Log a member gaining or losing roles. */
export async function logMemberRoleChange(
  member: GuildMember,
  addedRoles: Role[],
  removedRoles: Role[],
  client: LoggableClient,
): Promise<void> {
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (addedRoles.length > 0) {
    fields.push({
      name: `Roles Added (${addedRoles.length})`,
      value: addedRoles.map((r) => `${r} (\`${r.id}\`)`).join('\n') || '—',
    });
  }
  if (removedRoles.length > 0) {
    fields.push({
      name: `Roles Removed (${removedRoles.length})`,
      value: removedRoles.map((r) => `${r} (\`${r.id}\`)`).join('\n') || '—',
    });
  }

  const embed = baseEmbed('🏷️ Member Roles Updated')
    .setDescription(userLine(member.user))
    .addFields(
      { name: 'Member', value: `${member} (\`${member.id}\`)`, inline: true },
      ...fields,
    );

  await sendLog(member.guild.id, embed, client, 'roles');
}

/** Log a nickname change. */
export async function logNicknameChange(
  member: GuildMember,
  oldNick: string | null,
  newNick: string | null,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('📛 Nickname Changed')
    .setDescription(userLine(member.user))
    .addFields(
      { name: 'Member', value: `${member} (\`${member.id}\`)`, inline: true },
      {
        name: 'Before',
        value: oldNick ?? '(no nickname)',
        inline: true,
      },
      {
        name: 'After',
        value: newNick ?? '(no nickname)',
        inline: true,
      },
    );

  await sendLog(member.guild.id, embed, client, 'members');
}

/* -------------------------------------------------------------------------- */
/* Member events                                                              */
/* -------------------------------------------------------------------------- */

/** Log a member joining. */
export async function logMemberJoin(
  member: GuildMember,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('📥 Member Joined', 0x57f287)
    .setDescription(userLine(member.user))
    .addFields(
      { name: 'Member', value: `${member} (\`${member.id}\`)`, inline: true },
      {
        name: 'Account Created',
        value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
        inline: true,
      },
      {
        name: 'Member Count',
        value: String(member.guild.memberCount),
        inline: true,
      },
    );

  await sendLog(member.guild.id, embed, client, 'members');
}

/** Log a member leaving. */
export async function logMemberLeave(
  member: GuildMember,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('📤 Member Left', 0xed4245)
    .setDescription(userLine(member.user ?? { id: member.id }))
    .addFields(
      {
        name: 'Member',
        value: `${member.user?.username ?? member.id} (\`${member.id}\`)`,
        inline: true,
      },
      {
        name: 'Member Count',
        value: String(member.guild.memberCount),
        inline: true,
      },
    );

  await sendLog(member.guild.id, embed, client, 'members');
}

/** Log a member boosting or stopping boosting the server. */
export async function logMemberBoost(
  member: GuildMember,
  oldBoosted: boolean,
  newBoosted: boolean,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed(
    newBoosted ? '💎 Member Started Boosting' : '💎 Member Stopped Boosting',
    newBoosted ? 0x57f287 : 0xed4245,
  )
    .setDescription(userLine(member.user))
    .addFields(
      { name: 'Member', value: `${member} (\`${member.id}\`)`, inline: true },
      {
        name: 'Boosting',
        value: `**Before:** ${oldBoosted}\n**After:** ${newBoosted}`,
        inline: true,
      },
    );

  await sendLog(member.guild.id, embed, client, 'members');
}

/** Log a member timeout (discord "timeout") change. */
export async function logMemberTimeout(
  member: GuildMember,
  oldTimeout: number | null,
  newTimeout: number | null,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('⏱️ Member Timeout Changed', 0xfeca57)
    .setDescription(userLine(member.user))
    .addFields(
      { name: 'Member', value: `${member} (\`${member.id}\`)`, inline: true },
      {
        name: 'Before',
        value: oldTimeout ? `<t:${Math.floor(oldTimeout / 1000)}:F>` : '(none)',
        inline: true,
      },
      {
        name: 'After',
        value: newTimeout ? `<t:${Math.floor(newTimeout / 1000)}:F>` : '(none)',
        inline: true,
      },
    );

  await sendLog(member.guild.id, embed, client, 'moderation');
}

/** Log a member ban. */
export async function logMemberBan(
  guild: { id: string; name: string; memberCount: number },
  user: User,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🔨 Member Banned', 0xed4245)
    .setDescription(userLine(user))
    .addFields(
      { name: 'User', value: `${user.username} (\`${user.id}\`)`, inline: true },
      {
        name: 'Member Count',
        value: String(guild.memberCount),
        inline: true,
      },
    );

  await sendLog(guild.id, embed, client, 'moderation');
}

/** Log a member unbanned. */
export async function logMemberUnban(
  guild: { id: string; memberCount: number },
  user: User,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🔓 Member Unbanned', 0x57f287)
    .setDescription(userLine(user))
    .addFields(
      { name: 'User', value: `${user.username} (\`${user.id}\`)`, inline: true },
      {
        name: 'Member Count',
        value: String(guild.memberCount),
        inline: true,
      },
    );

  await sendLog(guild.id, embed, client, 'moderation');
}

/* -------------------------------------------------------------------------- */
/* Channel events                                                             */
/* -------------------------------------------------------------------------- */

/** Log a channel being created. */
export async function logChannelCreate(
  channel: TextChannel,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🆕 Channel Created', 0x57f287)
    .addFields(
      { name: 'Channel', value: `${channel} (\`${channel.id}\`)`, inline: true },
      { name: 'Type', value: String(channel.type), inline: true },
      { name: 'Category', value: channel.parent?.name ?? '(none)', inline: true },
    );

  await sendLog(channel.guild.id, embed, client, 'channels');
}

/** Log a channel being deleted. */
export async function logChannelDelete(
  channel: TextChannel,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🗑️ Channel Deleted', 0xed4245)
    .addFields(
      { name: 'Channel', value: channel.name, inline: true },
      { name: 'Channel ID', value: `\`${channel.id}\``, inline: true },
      { name: 'Type', value: String(channel.type), inline: true },
    );

  await sendLog(channel.guild.id, embed, client, 'channels');
}

/** Log a channel being updated. */
export async function logChannelUpdate(
  oldChannel: TextChannel,
  newChannel: TextChannel,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('📝 Channel Updated', 0xfeca57)
    .addFields({
      name: 'Channel',
      value: `${newChannel} (\`${newChannel.id}\`)`,
      inline: true,
    });

  if (oldChannel.name !== newChannel.name) {
    embed.addFields({
      name: 'Name',
      value: `**Before:** ${oldChannel.name}\n**After:** ${newChannel.name}`,
    });
  }

  await sendLog(newChannel.guild.id, embed, client, 'channels');
}

/* -------------------------------------------------------------------------- */
/* Thread events                                                              */
/* -------------------------------------------------------------------------- */

/** Log a thread being created. */
export async function logThreadCreate(
  thread: AnyThreadChannel,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🧵 Thread Created', 0x57f287)
    .addFields(
      { name: 'Thread', value: `${thread} (\`${thread.id}\`)`, inline: true },
      { name: 'Type', value: String(thread.type), inline: true },
      {
        name: 'Parent',
        value: thread.parent?.name ?? '(none)',
        inline: true,
      },
    );

  await sendLog(thread.guild.id, embed, client, 'threads');
}

/** Log a thread being deleted. */
export async function logThreadDelete(
  thread: AnyThreadChannel,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🗑️ Thread Deleted', 0xed4245)
    .addFields(
      { name: 'Thread', value: thread.name, inline: true },
      { name: 'Thread ID', value: `\`${thread.id}\``, inline: true },
      { name: 'Type', value: String(thread.type), inline: true },
    );

  await sendLog(thread.guild.id, embed, client, 'threads');
}

/** Log a thread being updated. */
export async function logThreadUpdate(
  oldThread: AnyThreadChannel,
  newThread: AnyThreadChannel,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('📝 Thread Updated', 0xfeca57)
    .addFields({
      name: 'Thread',
      value: `${newThread} (\`${newThread.id}\`)`,
      inline: true,
    });

  if (oldThread.name !== newThread.name) {
    embed.addFields({
      name: 'Name',
      value: `**Before:** ${oldThread.name}\n**After:** ${newThread.name}`,
    });
  }
  if (oldThread.archived !== newThread.archived) {
    embed.addFields({
      name: 'Archived',
      value: `**Before:** ${oldThread.archived}\n**After:** ${newThread.archived}`,
      inline: true,
    });
  }
  if (oldThread.locked !== newThread.locked) {
    embed.addFields({
      name: 'Locked',
      value: `**Before:** ${oldThread.locked}\n**After:** ${newThread.locked}`,
      inline: true,
    });
  }

  await sendLog(newThread.guild.id, embed, client, 'threads');
}

/** Log thread members being added or removed. */
export async function logThreadMembersUpdate(
  addedMembers: ReadonlyMap<string, ThreadMember>,
  removedMembers: ReadonlyMap<string, ThreadMember | PartialThreadMember>,
  thread: AnyThreadChannel,
  client: LoggableClient,
): Promise<void> {
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (addedMembers.size > 0) {
    fields.push({
      name: `Members Added (${addedMembers.size})`,
      value: [...addedMembers.values()]
        .map((m) => `<@${m.id}> (\`${m.id}\`)`)
        .join('\n') || '—',
    });
  }
  if (removedMembers.size > 0) {
    fields.push({
      name: `Members Removed (${removedMembers.size})`,
      value: [...removedMembers.values()]
        .map((m) => `<@${m.id}> (\`${m.id}\`)`)
        .join('\n') || '—',
    });
  }

  const embed = baseEmbed('🧵 Thread Members Updated')
    .addFields(
      { name: 'Thread', value: `${thread} (\`${thread.id}\`)`, inline: true },
      ...fields,
    );

  await sendLog(thread.guild.id, embed, client, 'threads');
}

/* -------------------------------------------------------------------------- */
/* Stage instance events                                                      */
/* -------------------------------------------------------------------------- */

/** Log a stage instance being created. */
export async function logStageInstanceCreate(
  stageInstance: StageInstance,
  client: LoggableClient,
): Promise<void> {
  if (!stageInstance.guild) return;
  const embed = baseEmbed('🎤 Stage Instance Created', 0x57f287)
    .addFields(
      { name: 'Channel', value: `${stageInstance.channel} (\`${stageInstance.channelId}\`)`, inline: true },
      { name: 'Topic', value: stageInstance.topic || '(none)', inline: false },
      { name: 'Privacy', value: String(stageInstance.privacyLevel), inline: true },
    );

  await sendLog(stageInstance.guild.id, embed, client, 'stage');
}

/** Log a stage instance being updated. */
export async function logStageInstanceUpdate(
  oldStageInstance: StageInstance | null,
  newStageInstance: StageInstance,
  client: LoggableClient,
): Promise<void> {
  if (!newStageInstance.guild) return;
  const embed = baseEmbed('📝 Stage Instance Updated', 0xfeca57)
    .addFields({
      name: 'Channel',
      value: `${newStageInstance.channel} (\`${newStageInstance.channelId}\`)`,
      inline: true,
    });

  if (oldStageInstance && oldStageInstance.topic !== newStageInstance.topic) {
    embed.addFields({
      name: 'Topic',
      value: `**Before:** ${oldStageInstance.topic ?? '(none)'}\n**After:** ${newStageInstance.topic || '(none)'}`,
    });
  }

  await sendLog(newStageInstance.guild.id, embed, client, 'stage');
}

/** Log a stage instance being deleted. */
export async function logStageInstanceDelete(
  stageInstance: StageInstance,
  client: LoggableClient,
): Promise<void> {
  if (!stageInstance.guild) return;
  const embed = baseEmbed('🗑️ Stage Instance Deleted', 0xed4245)
    .addFields(
      { name: 'Channel', value: `${stageInstance.channel} (\`${stageInstance.channelId}\`)`, inline: true },
      { name: 'Topic', value: stageInstance.topic || '(none)', inline: false },
    );

  await sendLog(stageInstance.guild.id, embed, client, 'stage');
}

/* -------------------------------------------------------------------------- */
/* Emoji events                                                               */
/* -------------------------------------------------------------------------- */

/** Log an emoji being created. */
export async function logEmojiCreate(
  emoji: GuildEmoji,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🆕 Emoji Created', 0x57f287)
    .addFields(
      { name: 'Emoji', value: `${emoji} (\`${emoji.id}\`)`, inline: true },
      { name: 'Name', value: emoji.name, inline: true },
      { name: 'Animated', value: String(emoji.animated), inline: true },
    );

  await sendLog(emoji.guild.id, embed, client, 'emojis');
}

/** Log an emoji being updated. */
export async function logEmojiUpdate(
  oldEmoji: GuildEmoji,
  newEmoji: GuildEmoji,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('📝 Emoji Updated', 0xfeca57)
    .addFields(
      { name: 'Emoji', value: `${newEmoji} (\`${newEmoji.id}\`)`, inline: true },
    );

  if (oldEmoji.name !== newEmoji.name) {
    embed.addFields({
      name: 'Name',
      value: `**Before:** ${oldEmoji.name}\n**After:** ${newEmoji.name}`,
    });
  }

  await sendLog(newEmoji.guild.id, embed, client, 'emojis');
}

/** Log an emoji being deleted. */
export async function logEmojiDelete(
  emoji: GuildEmoji,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🗑️ Emoji Deleted', 0xed4245)
    .addFields(
      { name: 'Emoji', value: emoji.name, inline: true },
      { name: 'Emoji ID', value: `\`${emoji.id}\``, inline: true },
    );

  await sendLog(emoji.guild.id, embed, client, 'emojis');
}

/* -------------------------------------------------------------------------- */
/* Webhook events                                                             */
/* -------------------------------------------------------------------------- */

/** Log webhook updates in a channel. */
export async function logWebhookUpdate(
  channel: TextChannel,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🔗 Webhooks Updated', 0xfeca57)
    .addFields(
      { name: 'Channel', value: `${channel} (\`${channel.id}\`)`, inline: true },
      {
        name: 'Type',
        value: String(channel.type),
        inline: true,
      },
    );

  await sendLog(channel.guild.id, embed, client, 'webhooks');
}

/* -------------------------------------------------------------------------- */
/* Message events                                                             */
/* -------------------------------------------------------------------------- */

/** Log a message edit. */
export async function logMessageEdit(
  oldMessage: Message,
  newMessage: Message,
  client: LoggableClient,
): Promise<void> {
  if (!oldMessage.author || oldMessage.author.bot) return;
  if (!newMessage.author || newMessage.author.bot) return;
  if (oldMessage.content === newMessage.content) return;
  if (!newMessage.guild) return;

  const embed = baseEmbed('💬 Message Edited')
    .setDescription(
      `[Jump to message](${newMessage.url}) in ${newMessage.channel}`,
    )
    .addFields(
      { name: 'Author', value: `${newMessage.author} (\`${newMessage.author.id}\`)`, inline: true },
      { name: 'Channel', value: `${newMessage.channel}`, inline: true },
      {
        name: 'Before',
        value: truncate(oldMessage.content || '*no content*'),
      },
      {
        name: 'After',
        value: truncate(newMessage.content || '*no content*'),
      },
    );

  await sendLog(newMessage.guild.id, embed, client, 'messages');
}

/** Log a message delete. */
export async function logMessageDelete(
  message: Message,
  client: LoggableClient,
): Promise<void> {
  // Partial messages (uncached/old deletes) have no author/content.
  if (!message.author || message.author.bot) return;
  if (!message.guild) return;

  const embed = baseEmbed('🗑️ Message Deleted', 0xed4245)
    .addFields(
      { name: 'Author', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
      { name: 'Channel', value: `${message.channel}`, inline: true },
      {
        name: 'Content',
        value: truncate(message.content || '*no content*'),
      },
    );

  await sendLog(message.guild.id, embed, client, 'messages');
}

/** Log a bulk message delete. */
export async function logMessageBulkDelete(
  messages: ReadonlyMap<string, any>,
  channel: TextChannel,
  client: LoggableClient,
): Promise<void> {
  if (!channel.guild) return;

  const authors = new Map<string, { id: string }>();
  let count = 0;

  for (const msg of messages.values()) {
    count += 1;
    const author = msg?.author;
    if (author && !authors.has(author.id)) authors.set(author.id, author);
  }

  const authorList = [...authors.values()]
    .slice(0, 10)
    .map((u) => `<@${u.id}> (\`${u.id}\`)`)
    .join(', ');

  const embed = baseEmbed('🗑️ Messages Bulk Deleted', 0xed4245)
    .addFields(
      { name: 'Channel', value: `${channel}`, inline: true },
      { name: 'Count', value: String(count), inline: true },
      {
        name: 'Authors (up to 10)',
        value: authorList || '(unknown)',
        inline: false,
      },
    );

  await sendLog(channel.guild.id, embed, client, 'messages');
}

/* -------------------------------------------------------------------------- */
/* Voice events                                                               */
/* -------------------------------------------------------------------------- */

/** Log voice state changes (join, leave, move, mute, deafen, stream, video). */
export async function logVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
  client: LoggableClient,
): Promise<void> {
  const member = newState.member ?? oldState.member;
  if (!member || !member.guild) return;
  const user = member.user ?? { id: member.id };

  const joined = !oldState.channelId && !!newState.channelId;
  const left = !!oldState.channelId && !newState.channelId;
  const moved =
    !!oldState.channelId &&
    !!newState.channelId &&
    oldState.channelId !== newState.channelId;
  const mutedChanged = oldState.selfMute !== newState.selfMute;
  const deafenedChanged = oldState.selfDeaf !== newState.selfDeaf;
  const videoChanged = oldState.selfVideo !== newState.selfVideo;

  if (!joined && !left && !moved && !mutedChanged && !deafenedChanged && !videoChanged) {
    return;
  }

  const embed = baseEmbed('🔊 Voice State Updated')
    .setDescription(userLine(user))
    .addFields(
      { name: 'Member', value: `${member} (\`${member.id}\`)`, inline: true },
    );

  if (joined) {
    embed.setTitle('🔊 Voice Channel Joined').setColor(0x57f287);
    embed.addFields({
      name: 'Channel',
      value: `${newState.channel} (\`${newState.channelId}\`)`,
      inline: true,
    });
  } else if (left) {
    embed.setTitle('🔊 Voice Channel Left').setColor(0xed4245);
    embed.addFields({
      name: 'Channel',
      value: `${oldState.channel?.name ?? 'Unknown'} (\`${oldState.channelId}\`)`,
      inline: true,
    });
  } else if (moved) {
    embed.setTitle('🔊 Voice Channel Changed').setColor(0xfeca57);
    embed.addFields(
      {
        name: 'Before',
        value: `${oldState.channel?.name ?? 'Unknown'} (\`${oldState.channelId}\`)`,
        inline: true,
      },
      {
        name: 'After',
        value: `${newState.channel} (\`${newState.channelId}\`)`,
        inline: true,
      },
    );
  }

  if (mutedChanged) {
    embed.addFields({
      name: 'Self Muted',
      value: `**Before:** ${oldState.selfMute}\n**After:** ${newState.selfMute}`,
      inline: true,
    });
  }
  if (deafenedChanged) {
    embed.addFields({
      name: 'Self Deafened',
      value: `**Before:** ${oldState.selfDeaf}\n**After:** ${newState.selfDeaf}`,
      inline: true,
    });
  }
  if (videoChanged) {
    embed.addFields({
      name: 'Video',
      value: `**Before:** ${oldState.selfVideo}\n**After:** ${newState.selfVideo}`,
      inline: true,
    });
  }

  await sendLog(member.guild.id, embed, client, 'voice');
}

/* -------------------------------------------------------------------------- */
/* Guild events                                                               */
/* -------------------------------------------------------------------------- */

/** Log guild-wide setting changes (name, region, verification, etc.). */
export async function logGuildUpdate(
  oldGuild: Guild,
  newGuild: Guild,
  client: LoggableClient,
): Promise<void> {
  const embed = baseEmbed('🏰 Guild Updated', 0xfeca57)
    .addFields(
      { name: 'Guild', value: `${newGuild.name} (\`${newGuild.id}\`)`, inline: true },
    );

  if (oldGuild.name !== newGuild.name) {
    embed.addFields({
      name: 'Name',
      value: `**Before:** ${oldGuild.name}\n**After:** ${newGuild.name}`,
    });
  }
  if (oldGuild.description !== newGuild.description) {
    embed.addFields({
      name: 'Description',
      value: `**Before:** ${oldGuild.description ?? '(none)'}\n**After:** ${newGuild.description ?? '(none)'}`,
    });
  }
  if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
    embed.addFields({
      name: 'Verification Level',
      value: `**Before:** ${oldGuild.verificationLevel}\n**After:** ${newGuild.verificationLevel}`,
      inline: true,
    });
  }
  if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) {
    embed.addFields({
      name: 'Explicit Content Filter',
      value: `**Before:** ${oldGuild.explicitContentFilter}\n**After:** ${newGuild.explicitContentFilter}`,
      inline: true,
    });
  }

  await sendLog(newGuild.id, embed, client, 'guild');
}

/* -------------------------------------------------------------------------- */
/* Command & config events                                                    */
/* -------------------------------------------------------------------------- */

/** Log a slash command usage. */
export async function logCommandUsage(
  interaction: { user: { id: string; username: string }; commandName: string; guild?: Guild | null },
  client: LoggableClient,
): Promise<void> {
  if (!interaction.guild) return;

  const embed = baseEmbed('💬 Slash Command Used')
    .addFields(
      { name: 'User', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
      { name: 'Command', value: `/${interaction.commandName}`, inline: true },
    );

  await sendLog(interaction.guild.id, embed, client, 'commands');
}

/** Log a bot configuration change made via /config. */
export async function logConfigChange(
  interaction: { user: { id: string; username: string }; guild?: Guild | null },
  description: string,
  client: LoggableClient,
): Promise<void> {
  if (!interaction.guild) return;

  const embed = baseEmbed('⚙️ Bot Config Changed')
    .setDescription(description)
    .addFields(
      { name: 'User', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
    );

  await sendLog(interaction.guild.id, embed, client, 'config');
}
