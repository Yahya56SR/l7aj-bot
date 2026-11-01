import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  GuildMember,
  TextChannel,
} from 'discord.js';
import { getConfig } from '../config';
import {
  addWarning,
  clearWarnings,
  getWarning,
  getWarnings,
  removeWarning,
  type WarnRow,
} from '../db';
import { logChannelLock, logChannelSlowmode, logChannelUnlock, logMemberWarn } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('moderation')
  .setDescription('Moderate members and channels')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('kick')
      .setDescription('Kick a member from the server')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member to kick').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('Reason for the kick').setMaxLength(512),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('ban')
      .setDescription('Ban a member from the server')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member to ban').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('Reason for the ban').setMaxLength(512),
      )
      .addIntegerOption((o) =>
        o
          .setName('delete-message-days')
          .setDescription('Days of messages to delete (0-7)')
          .setMinValue(0)
          .setMaxValue(7),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('unban')
      .setDescription('Unban a user from the server')
      .addStringOption((o) =>
        o
          .setName('user-id')
          .setDescription('The user id to unban')
          .setRequired(true)
          .setMinLength(15)
          .setMaxLength(25),
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('Reason for the unban').setMaxLength(512),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('timeout')
      .setDescription('Timeout a member (temporarily disable communication)')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member to timeout').setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('minutes')
          .setDescription('Timeout duration in minutes (max 40320 = 28 days)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(40_320),
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('Reason for the timeout').setMaxLength(512),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('untimeout')
      .setDescription("Remove a member's timeout")
      .addUserOption((o) =>
        o.setName('member').setDescription('Member to untimeout').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('Reason for removing the timeout').setMaxLength(512),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('warn')
      .setDescription('Warn a member (stored in the bot database)')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member to warn').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('Reason for the warning').setRequired(true).setMaxLength(1000),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('warnings')
      .setDescription('List a member\'s warnings')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member to check').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('removewarn')
      .setDescription('Remove a specific warning by its ID')
      .addStringOption((o) =>
        o.setName('warn-id').setDescription('The warning ID to remove').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('clearwarns')
      .setDescription('Clear all warnings for a member')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member whose warnings to clear').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('slowmode')
      .setDescription('Set or remove slowmode on a channel')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to set slowmode in')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('seconds')
          .setDescription('Slowmode seconds (0 to disable)')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(21600),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('lock')
      .setDescription('Lock a channel so @everyone cannot send messages')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to lock')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('Reason for locking').setMaxLength(512),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('unlock')
      .setDescription('Unlock a channel so @everyone can send messages again')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to unlock')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('Reason for unlocking').setMaxLength(512),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'kick': return kick(interaction);
    case 'ban': return ban(interaction);
    case 'unban': return unban(interaction);
    case 'timeout': return timeoutMember(interaction);
    case 'untimeout': return untimeoutMember(interaction);
    case 'warn': return warn(interaction);
    case 'warnings': return warnings(interaction);
    case 'removewarn': return removeWarn(interaction);
    case 'clearwarns': return clearWarns(interaction);
    case 'slowmode': return slowmode(interaction);
    case 'lock': return lock(interaction);
    case 'unlock': return unlock(interaction);
    default: return;
  }
}

/* ------------------------------------------------------------------ */
/* Permission helpers                                                 */
/* ------------------------------------------------------------------ */

/** Required Discord permission per subcommand (returned as a bigint bitfield). */
function requiredPermission(sub: string): bigint {
  switch (sub) {
    case 'kick': return PermissionFlagsBits.KickMembers;
    case 'ban': return PermissionFlagsBits.BanMembers;
    case 'unban': return PermissionFlagsBits.BanMembers;
    case 'timeout': return PermissionFlagsBits.ModerateMembers;
    case 'untimeout': return PermissionFlagsBits.ModerateMembers;
    case 'warn':
    case 'warnings':
    case 'removewarn':
    case 'clearwarns': return PermissionFlagsBits.ManageMessages;
    case 'slowmode':
    case 'lock':
    case 'unlock': return PermissionFlagsBits.ManageChannels;
    default: return PermissionFlagsBits.ManageGuild;
  }
}

function memberPermits(interaction: ChatInputCommandInteraction, sub: string): boolean {
  const member = interaction.member as { permissions: { has: (bits: bigint) => boolean } };
  return member.permissions.has(requiredPermission(sub));
}

function botPermits(guild: { members: { me: { permissions: { has: (bits: bigint) => boolean } } | null } }, sub: string): string | null {
  const me = guild.members.me;
  if (!me) return 'I could not resolve my own member object.';
  if (!me.permissions.has(requiredBotPermission(sub))) {
    return `I need the **${requiredBotPermission(sub).toString().replace(/_/g, ' ')}** permission to do that.`;
  }
  return null;
}

function requiredBotPermission(sub: string): bigint {
  switch (sub) {
    case 'kick': return PermissionFlagsBits.KickMembers;
    case 'ban': return PermissionFlagsBits.BanMembers;
    case 'unban': return PermissionFlagsBits.BanMembers;
    case 'timeout': return PermissionFlagsBits.ModerateMembers;
    case 'untimeout': return PermissionFlagsBits.ModerateMembers;
    case 'warn':
    case 'warnings':
    case 'removewarn':
    case 'clearwarns': return PermissionFlagsBits.ManageMessages;
    case 'slowmode':
    case 'lock':
    case 'unlock': return PermissionFlagsBits.ManageChannels;
    default: return PermissionFlagsBits.ManageGuild;
  }
}

/** True when the bot cannot moderate the target (role hierarchy). */
function botCannotModerate(me: GuildMember, target: GuildMember): string | null {
  if (target.id === me.guild.id) return 'I cannot moderate **@everyone**.';
  if (target.user.bot) return 'I cannot moderate bots.';
  if (target.roles.highest.position >= me.roles.highest.position) {
    return `That role is higher than (or equal to) my highest role, so I cannot moderate <@${target.id}>. Move my role above it.`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Member actions                                                     */
/* ------------------------------------------------------------------ */

async function kick(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const member = interaction.options.getMember('member') as GuildMember;
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!memberPermits(interaction, 'kick')) {
    await interaction.reply({ content: 'You need the **Kick Members** permission to kick members.', ephemeral: true });
    return;
  }
  if (!member.kickable) {
    await interaction.reply({ content: 'I cannot kick that member (role hierarchy or missing permissions).', ephemeral: true });
    return;
  }

  try {
    await member.kick(reason);
    await interaction.reply({ content: `✅ Kicked ${userLine(member)}. Reason: ${reason}`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `Failed to kick: ${describeError(err)}`, ephemeral: true });
  }
}

async function ban(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const member = interaction.options.getMember('member') as GuildMember;
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const deleteDays = interaction.options.getInteger('delete-message-days') ?? 0;

  if (!memberPermits(interaction, 'ban')) {
    await interaction.reply({ content: 'You need the **Ban Members** permission to ban members.', ephemeral: true });
    return;
  }
  if (!member.bannable) {
    await interaction.reply({ content: 'I cannot ban that member (role hierarchy or missing permissions).', ephemeral: true });
    return;
  }

  try {
    await member.ban({ reason, deleteMessageSeconds: deleteDays * 86400 });
    await interaction.reply({ content: `✅ Banned ${userLine(member)}. Reason: ${reason}`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `Failed to ban: ${describeError(err)}`, ephemeral: true });
  }
}

async function unban(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const userId = interaction.options.getString('user-id')!;
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!/^\d{15,25}$/.test(userId)) {
    await interaction.reply({ content: 'That does not look like a valid Discord user id.', ephemeral: true });
    return;
  }
  if (!memberPermits(interaction, 'unban')) {
    await interaction.reply({ content: 'You need the **Ban Members** permission to unban members.', ephemeral: true });
    return;
  }

  try {
    // Resolve the username for a nicer confirmation (fails open).
    let username = userId;
    try {
      const fetched = await interaction.client.users.fetch(userId);
      username = fetched.username;
    } catch {
      /* ignore — we can still unban by id */
    }

    await guild.members.unban(userId, reason);
    await interaction.reply({ content: `✅ Unbanned **${username}** (<@${userId}>). Reason: ${reason}`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `Failed to unban: ${describeError(err)}`, ephemeral: true });
  }
}

async function timeoutMember(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const member = interaction.options.getMember('member') as GuildMember;
  const minutes = interaction.options.getInteger('minutes')!;
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const durationMs = minutes * 60 * 1000;

  if (!memberPermits(interaction, 'timeout')) {
    await interaction.reply({ content: 'You need the **Moderate Members** permission to timeout members.', ephemeral: true });
    return;
  }
  if (!member.moderatable) {
    await interaction.reply({ content: 'I cannot timeout that member (role hierarchy or missing permissions).', ephemeral: true });
    return;
  }

  try {
    await member.timeout(durationMs, reason);
    await interaction.reply({
      content: `✅ Timed out ${userLine(member)} for **${minutes} minute(s)** (until <t:${Math.floor(Date.now() / 1000) + minutes * 60}:R>). Reason: ${reason}`,
      ephemeral: true,
    });
  } catch (err) {
    await interaction.reply({ content: `Failed to timeout: ${describeError(err)}`, ephemeral: true });
  }
}

async function untimeoutMember(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const member = interaction.options.getMember('member') as GuildMember;
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (!memberPermits(interaction, 'untimeout')) {
    await interaction.reply({ content: 'You need the **Moderate Members** permission to remove timeouts.', ephemeral: true });
    return;
  }
  if (!member.moderatable) {
    await interaction.reply({ content: 'I cannot modify that member\'s timeout (role hierarchy or missing permissions).', ephemeral: true });
    return;
  }

  try {
    await member.timeout(null, reason);
    await interaction.reply({ content: `✅ Removed timeout for ${userLine(member)}. Reason: ${reason}`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `Failed to remove timeout: ${describeError(err)}`, ephemeral: true });
  }
}

async function warn(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const member = interaction.options.getMember('member') as GuildMember;
  const reason = interaction.options.getString('reason')!;
  const moderator = interaction.user;

  if (!memberPermits(interaction, 'warn')) {
    await interaction.reply({ content: 'You need the **Manage Messages** permission to warn members.', ephemeral: true });
    return;
  }
  if (member.user.bot) {
    await interaction.reply({ content: 'I cannot warn bots.', ephemeral: true });
    return;
  }

  const warnRow = addWarning(member.id, moderator.id, reason);

  await logMemberWarn(
    guild,
    { id: member.id, username: member.user.username, tag: member.user.tag },
    { id: moderator.id, username: moderator.username },
    reason,
    warnRow.id,
    { channels: { cache: interaction.client.channels.cache } },
  );

  const warnings = getWarnings(member.id);
  await interaction.reply({
    content: `✅ Warned ${userLine(member)} (warning #${warnings.length}). Reason: ${reason}`,
    ephemeral: true,
  });
}

async function warnings(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const member = interaction.options.getMember('member') as GuildMember;
  const warns = getWarnings(member.id);

  const embed = new EmbedBuilder()
    .setColor(0xfeca57)
    .setTitle(`⚠️ Warnings for ${member.user.username}`)
    .setDescription(member.user.bot ? 'Bots cannot be warned.' : null);

  if (warns.length === 0) {
    embed.setDescription(`${userLine(member)} has no warnings.`);
  } else {
    embed.addFields({
      name: `Warnings (${warns.length})`,
      value: warns
        .map((w) => `• **#${w.id}** — <@${w.moderatorId}> — ${w.reason}\n  <t:${Math.floor(w.createdAt / 1000)}:R>`)
        .join('\n'),
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function removeWarn(interaction: ChatInputCommandInteraction): Promise<void> {
  const warnId = interaction.options.getString('warn-id')!;
  if (!/^W-\d+$/.test(warnId)) {
    await interaction.reply({ content: 'That does not look like a valid warning id (e.g. `W-1`).', ephemeral: true });
    return;
  }
  if (!memberPermits(interaction, 'removewarn')) {
    await interaction.reply({ content: 'You need the **Manage Messages** permission to remove warnings.', ephemeral: true });
    return;
  }

  const existing = getWarning(warnId);
  if (!existing) {
    await interaction.reply({ content: `No warning found with id **${warnId}**.`, ephemeral: true });
    return;
  }

  removeWarning(warnId);
  await interaction.reply({ content: `✅ Removed warning **${warnId}** (was for <@${existing.userId}>).`, ephemeral: true });
}

async function clearWarns(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.options.getMember('member') as GuildMember;
  if (!memberPermits(interaction, 'clearwarns')) {
    await interaction.reply({ content: 'You need the **Manage Messages** permission to clear warnings.', ephemeral: true });
    return;
  }

  const removed = clearWarnings(member.id);
  await interaction.reply({ content: `✅ Cleared **${removed}** warning(s) for ${userLine(member)}.`, ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Channel actions                                                    */
/* ------------------------------------------------------------------ */

async function slowmode(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel('channel') as TextChannel;
  const seconds = interaction.options.getInteger('seconds')!;

  if (!memberPermits(interaction, 'slowmode')) {
    await interaction.reply({ content: 'You need the **Manage Channels** permission to set slowmode.', ephemeral: true });
    return;
  }
  const botErr = botPermits(guild, 'slowmode');
  if (botErr) {
    await interaction.reply({ content: botErr, ephemeral: true });
    return;
  }

  try {
    await channel.setRateLimitPerUser(seconds);
    await logChannelSlowmode(
      { id: channel.id, name: channel.name, guild },
      interaction.user,
      seconds,
      { channels: { cache: interaction.client.channels.cache } },
    );
    await interaction.reply({
      content: seconds === 0 ? `✅ Slowmode disabled in ${channel}.` : `✅ Slowmode set to **${seconds} second(s)** in ${channel}.`,
      ephemeral: true,
    });
  } catch (err) {
    await interaction.reply({ content: `Failed to set slowmode: ${describeError(err)}`, ephemeral: true });
  }
}

async function lock(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel('channel') as TextChannel;
  const reason = interaction.options.getString('reason') || null;

  if (!memberPermits(interaction, 'lock')) {
    await interaction.reply({ content: 'You need the **Manage Channels** permission to lock channels.', ephemeral: true });
    return;
  }
  const botErr = botPermits(guild, 'lock');
  if (botErr) {
    await interaction.reply({ content: botErr, ephemeral: true });
    return;
  }

  const everyone = guild.roles.everyone;
  const current = channel.permissionOverwrites.cache.get(everyone.id);
  if (current?.deny.has(PermissionFlagsBits.SendMessages)) {
    await interaction.reply({ content: `${channel} is already locked.`, ephemeral: true });
    return;
  }

  try {
    await channel.permissionOverwrites.edit(everyone, {
      SendMessages: false,
    });
    await logChannelLock(
      { id: channel.id, name: channel.name, guild },
      interaction.user,
      reason,
      { channels: { cache: interaction.client.channels.cache } },
    );
    await interaction.reply({ content: `🔒 Locked ${channel}. ${reason ? `Reason: ${reason}` : ''}`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `Failed to lock channel: ${describeError(err)}`, ephemeral: true });
  }
}

async function unlock(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel('channel') as TextChannel;
  const reason = interaction.options.getString('reason') || null;

  if (!memberPermits(interaction, 'unlock')) {
    await interaction.reply({ content: 'You need the **Manage Channels** permission to unlock channels.', ephemeral: true });
    return;
  }
  const botErr = botPermits(guild, 'unlock');
  if (botErr) {
    await interaction.reply({ content: botErr, ephemeral: true });
    return;
  }

  const everyone = guild.roles.everyone;
  const current = channel.permissionOverwrites.cache.get(everyone.id);
  if (!current?.deny.has(PermissionFlagsBits.SendMessages)) {
    await interaction.reply({ content: `${channel} is not locked.`, ephemeral: true });
    return;
  }

  try {
    await channel.permissionOverwrites.edit(everyone, {
      SendMessages: null,
    });
    await logChannelUnlock(
      { id: channel.id, name: channel.name, guild },
      interaction.user,
      reason,
      { channels: { cache: interaction.client.channels.cache } },
    );
    await interaction.reply({ content: `🔓 Unlocked ${channel}. ${reason ? `Reason: ${reason}` : ''}`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `Failed to unlock channel: ${describeError(err)}`, ephemeral: true });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function userLine(member: GuildMember | { id: string }): string {
  return `<@${member.id}> (\`${member.id}\`)`;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const record = err as { message?: string; code?: number };
    return record.message || `Error code ${record.code ?? 'unknown'}`;
  }
  return String(err);
}
