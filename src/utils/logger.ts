/**
 * Centralized server logging utility.
 *
 * Sends structured embed messages to the configured logs channel
 * (`config.channels.logs`) for server changes: role assignments/removals,
 * nickname changes, channel events, bans, message edits/deletes, etc.
 *
 * Designed to fail open: if the logs channel is missing or the message
 * cannot be sent, logging is silently skipped so it never blocks core bot
 * functionality.
 */

import {
  EmbedBuilder,
  GuildMember,
  Role,
  TextChannel,
  User,
  Message,
  AuditLogEvent,
} from 'discord.js';
import { getConfig } from '../config';

const LOG_COLOR = 0x5865f2;
const EMBED_FOOTER = 'TALABA <3 Server Logs';

/** Resolve the configured logs channel, if any. */
function resolveLogsChannel(guildId: string): TextChannel | null {
  const cfg = getConfig();
  const channelId = cfg.channels.logs;
  if (!channelId) return null;

  // We need the guild instance to resolve the channel. The caller passes
  // guildId so we can look it up via the client if needed, but here we only
  // have config. Return null; the caller should pass the channel directly.
  return null;
}

/**
 * Send a log embed to the configured logs channel for the given guild.
 * @param guildId - The guild whose logs channel to use.
 * @param channel - A text channel in the guild (used to fetch the client).
 */
async function sendLog(
  guildId: string,
  embed: EmbedBuilder,
  client: { channels: { cache: Map<string, any> } },
): Promise<void> {
  const cfg = getConfig();
  const channelId = cfg.channels.logs;
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

/* -------------------------------------------------------------------------- */
/* Role events                                                                */
/* -------------------------------------------------------------------------- */

/** Log a role being created. */
export async function logRoleCreate(
  role: Role,
  client: { channels: { cache: Map<string, any> } },
): Promise<void> {
  const embed = baseEmbed('🆕 Role Created', 0x57f287)
    .addFields(
      { name: 'Role', value: `${role} (\`${role.id}\`)`, inline: true },
      { name: 'Color', value: role.hexColor ?? 'Default', inline: true },
      { name: 'Mentionable', value: String(role.mentionable), inline: true },
      { name: 'Hoisted', value: String(role.hoist), inline: true },
    );
  await sendLog(role.guild.id, embed, client);
}

/** Log a role being deleted. */
export async function logRoleDelete(
  role: Role,
  client: { channels: { cache: Map<string, any> } },
): Promise<void> {
  const embed = baseEmbed('🗑️ Role Deleted', 0xed4245)
    .addFields(
      { name: 'Role', value: role.name, inline: true },
      { name: 'Role ID', value: `\`${role.id}\``, inline: true },
      { name: 'Color', value: role.hexColor ?? 'Default', inline: true },
    );
  await sendLog(role.guild.id, embed, client);
}

/** Log a role being updated (name, color, permissions, etc.). */
export async function logRoleUpdate(
  oldRole: Role,
  newRole: Role,
  client: { channels: { cache: Map<string, any> } },
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

  await sendLog(newRole.guild.id, embed, client);
}

/** Log a member gaining or losing roles. */
export async function logMemberRoleChange(
  member: GuildMember,
  addedRoles: Role[],
  removedRoles: Role[],
  client: { channels: { cache: Map<string, any> } },
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

  await sendLog(member.guild.id, embed, client);
}

/** Log a nickname change. */
export async function logNicknameChange(
  member: GuildMember,
  oldNick: string | null,
  newNick: string | null,
  client: { channels: { cache: Map<string, any> } },
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

  await sendLog(member.guild.id, embed, client);
}

/* -------------------------------------------------------------------------- */
/* Member events                                                              */
/* -------------------------------------------------------------------------- */

/** Log a member joining. */
export async function logMemberJoin(
  member: GuildMember,
  client: { channels: { cache: Map<string, any> } },
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

  await sendLog(member.guild.id, embed, client);
}

/** Log a member leaving. */
export async function logMemberLeave(
  member: GuildMember,
  client: { channels: { cache: Map<string, any> } },
): Promise<void> {
  const embed = baseEmbed('📤 Member Left', 0xed4245)
    .setDescription(userLine(member.user))
    .addFields(
      { name: 'Member', value: `${member.user.username} (\`${member.id}\`)`, inline: true },
      {
        name: 'Member Count',
        value: String(member.guild.memberCount),
        inline: true,
      },
    );

  await sendLog(member.guild.id, embed, client);
}

/** Log a member ban. */
export async function logMemberBan(
  guild: { id: string; name: string; memberCount: number },
  user: User,
  client: { channels: { cache: Map<string, any> } },
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

  await sendLog(guild.id, embed, client);
}

/** Log a member unbanned. */
export async function logMemberUnban(
  guild: { id: string; memberCount: number },
  user: User,
  client: { channels: { cache: Map<string, any> } },
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

  await sendLog(guild.id, embed, client);
}

/* -------------------------------------------------------------------------- */
/* Channel events                                                             */
/* -------------------------------------------------------------------------- */

/** Log a channel being created. */
export async function logChannelCreate(
  channel: TextChannel,
  client: { channels: { cache: Map<string, any> } },
): Promise<void> {
  const embed = baseEmbed('🆕 Channel Created', 0x57f287)
    .addFields(
      { name: 'Channel', value: `${channel} (\`${channel.id}\`)`, inline: true },
      { name: 'Type', value: String(channel.type), inline: true },
      { name: 'Category', value: channel.parent?.name ?? '(none)', inline: true },
    );

  await sendLog(channel.guild.id, embed, client);
}

/** Log a channel being deleted. */
export async function logChannelDelete(
  channel: TextChannel,
  client: { channels: { cache: Map<string, any> } },
): Promise<void> {
  const embed = baseEmbed('🗑️ Channel Deleted', 0xed4245)
    .addFields(
      { name: 'Channel', value: channel.name, inline: true },
      { name: 'Channel ID', value: `\`${channel.id}\``, inline: true },
      { name: 'Type', value: String(channel.type), inline: true },
    );

  await sendLog(channel.guild.id, embed, client);
}

/** Log a channel being updated. */
export async function logChannelUpdate(
  oldChannel: TextChannel,
  newChannel: TextChannel,
  client: { channels: { cache: Map<string, any> } },
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

  await sendLog(newChannel.guild.id, embed, client);
}

/* -------------------------------------------------------------------------- */
/* Message events                                                             */
/* -------------------------------------------------------------------------- */

/** Log a message edit. */
export async function logMessageEdit(
  oldMessage: Message,
  newMessage: Message,
  client: { channels: { cache: Map<string, any> } },
): Promise<void> {
  if (oldMessage.author.bot) return;
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
        value: oldMessage.content || '*no content*',
      },
      {
        name: 'After',
        value: newMessage.content || '*no content*',
      },
    );

  await sendLog(newMessage.guild.id, embed, client);
}

/** Log a message delete. */
export async function logMessageDelete(
  message: Message,
  client: { channels: { cache: Map<string, any> } },
): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return;

  const embed = baseEmbed('🗑️ Message Deleted', 0xed4245)
    .addFields(
      { name: 'Author', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
      { name: 'Channel', value: `${message.channel}`, inline: true },
      {
        name: 'Content',
        value: message.content || '*no content*',
      },
    );

  await sendLog(message.guild.id, embed, client);
}
