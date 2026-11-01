import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  AuditLogEvent,
  type Client,
  type Guild,
} from 'discord.js';
import { Role, GuildChannel, User } from 'discord.js';
import { getAntiNuke, setAntiNuke } from '../db';

export const slashData = new SlashCommandBuilder()
  .setName('antinuke')
  .setDescription('Configure server anti-nuke protection')
  .setDefaultMemberPermissions(0n)
  .addSubcommand((sub) =>
    sub.setName('toggle').setDescription('Enable or disable anti-nuke')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Enabled?').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub.setName('punishment').setDescription('Set punishment for nuke actions')
      .addStringOption((o) =>
        o.setName('type').setDescription('Punishment type').setRequired(true)
          .addChoices(
            { name: 'None (log only)', value: 'none' },
            { name: 'Kick', value: 'kick' },
            { name: 'Ban', value: 'ban' },
            { name: 'Timeout (1h)', value: 'timeout' },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('whitelist').setDescription('Whitelist a user from anti-nuke')
      .addUserOption((o) => o.setName('user').setDescription('User to whitelist').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub.setName('unwhitelist').setDescription('Remove a user from whitelist')
      .addUserOption((o) => o.setName('user').setDescription('User to unwhitelist').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub.setName('actions').setDescription('Toggle which actions are protected')
      .addBooleanOption((o) => o.setName('role').setDescription('Protect role create/delete').setRequired(true))
      .addBooleanOption((o) => o.setName('channel').setDescription('Protect channel create/delete').setRequired(true))
      .addBooleanOption((o) => o.setName('ban').setDescription('Protect bans').setRequired(true))
      .addBooleanOption((o) => o.setName('kick').setDescription('Protect kicks').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub.setName('view').setDescription('View anti-nuke config'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'toggle': return toggle(interaction);
    case 'punishment': return punishment(interaction);
    case 'whitelist': return whitelist(interaction);
    case 'unwhitelist': return unwhitelist(interaction);
    case 'actions': return actions(interaction);
    case 'view': return view(interaction);
    default: return;
  }
}

async function toggle(interaction: ChatInputCommandInteraction): Promise<void> {
  const enabled = interaction.options.getBoolean('enabled', true);
  setAntiNuke({ enabled });
  await interaction.reply({ content: `✅ Anti-nuke ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
}

async function punishment(interaction: ChatInputCommandInteraction): Promise<void> {
  const type = interaction.options.getString('type', true) as 'none' | 'kick' | 'ban' | 'timeout';
  setAntiNuke({ punishment: type });
  await interaction.reply({ content: `✅ Anti-nuke punishment set to **${type}**.`, ephemeral: true });
}

async function whitelist(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = interaction.options.getUser('user', true);
  const current = getAntiNuke();
  if (current.whitelist.includes(user.id)) {
    await interaction.reply({ content: `<@${user.id}> is already whitelisted.`, ephemeral: true });
    return;
  }
  setAntiNuke({ whitelist: [...current.whitelist, user.id] });
  await interaction.reply({ content: `✅ Whitelisted <@${user.id}> from anti-nuke.`, ephemeral: true });
}

async function unwhitelist(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = interaction.options.getUser('user', true);
  const current = getAntiNuke();
  if (!current.whitelist.includes(user.id)) {
    await interaction.reply({ content: `<@${user.id}> is not whitelisted.`, ephemeral: true });
    return;
  }
  setAntiNuke({ whitelist: current.whitelist.filter((id) => id !== user.id) });
  await interaction.reply({ content: `✅ Removed <@${user.id}> from anti-nuke whitelist.`, ephemeral: true });
}

async function actions(interaction: ChatInputCommandInteraction): Promise<void> {
  setAntiNuke({
    actions: {
      role: interaction.options.getBoolean('role', true),
      channel: interaction.options.getBoolean('channel', true),
      ban: interaction.options.getBoolean('ban', true),
      kick: interaction.options.getBoolean('kick', true),
    },
  });
  await interaction.reply({ content: '✅ Anti-nuke protected actions updated.', ephemeral: true });
}

async function view(interaction: ChatInputCommandInteraction): Promise<void> {
  const cfg = getAntiNuke();
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('🛡️ Anti-Nuke Configuration')
    .addFields(
      { name: 'Enabled', value: String(cfg.enabled), inline: true },
      { name: 'Punishment', value: cfg.punishment, inline: true },
      { name: 'Whitelisted', value: String(cfg.whitelist.length), inline: true },
      {
        name: 'Protected Actions',
        value: `Roles: ${cfg.actions.role} • Channels: ${cfg.actions.channel} • Bans: ${cfg.actions.ban} • Kicks: ${cfg.actions.kick}`,
        inline: false,
      },
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Event handling                                                      */
/* ------------------------------------------------------------------ */

export interface NukeContext {
  client: Client;
  guild: Guild;
  actor: { id: string; username: string } | null;
  reason: string | null;
}

async function applyPunishment(ctx: NukeContext, userId: string): Promise<void> {
  const cfg = getAntiNuke();
  if (cfg.punishment === 'none') return;
  const member = ctx.guild.members.cache.get(userId);
  if (!member) return;
  try {
    if (cfg.punishment === 'kick') await member.kick('Anti-nuke action');
    else if (cfg.punishment === 'ban') await member.ban({ reason: 'Anti-nuke action' });
    else if (cfg.punishment === 'timeout') await member.timeout(60 * 60 * 1000, 'Anti-nuke action');
  } catch {
    /* ignore */
  }
}

async function resolveActor(
  guild: Guild,
  type: AuditLogEvent,
  targetId: string,
): Promise<{ id: string; username: string; reason: string | null } | null> {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = [...logs.entries.values()].find(
      (e) => e.targetId === targetId && Date.now() - e.createdTimestamp < 15000,
    );
    if (!entry) return null;
    const executor = entry.executor ?? (entry.executorId ? await guild.members.fetch(entry.executorId).catch(() => null) : null);
    const username = executor
      ? 'user' in executor
        ? (executor as { user: { username: string } }).user.username
        : (executor as { username: string }).username
      : 'unknown';
    return {
      id: entry.executorId ?? entry.executor?.id ?? '',
      username,
      reason: entry.reason ?? null,
    };
  } catch {
    return null;
  }
}

export async function handleRoleCreate(role: Role, ctx: NukeContext): Promise<void> {
  const cfg = getAntiNuke();
  if (!cfg.enabled || !cfg.actions.role) return;
  const actor = await resolveActor(role.guild, AuditLogEvent.RoleCreate, role.id);
  if (actor && cfg.whitelist.includes(actor.id)) return;
  ctx.actor = actor ?? { id: '', username: 'unknown' };
  ctx.reason = actor?.reason ?? null;
  await applyPunishment(ctx, actor?.id ?? role.guild.ownerId);
}

export async function handleRoleDelete(role: Role, ctx: NukeContext): Promise<void> {
  const cfg = getAntiNuke();
  if (!cfg.enabled || !cfg.actions.role) return;
  const actor = await resolveActor(role.guild, AuditLogEvent.RoleDelete, role.id);
  if (actor && cfg.whitelist.includes(actor.id)) return;
  ctx.actor = actor ?? { id: '', username: 'unknown' };
  ctx.reason = actor?.reason ?? null;
  await applyPunishment(ctx, actor?.id ?? role.guild.ownerId);
}

export async function handleChannelCreate(channel: GuildChannel, ctx: NukeContext): Promise<void> {
  const cfg = getAntiNuke();
  if (!cfg.enabled || !cfg.actions.channel) return;
  const actor = await resolveActor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  if (actor && cfg.whitelist.includes(actor.id)) return;
  ctx.actor = actor ?? { id: '', username: 'unknown' };
  ctx.reason = actor?.reason ?? null;
  await applyPunishment(ctx, actor?.id ?? channel.guild.ownerId);
}

export async function handleChannelDelete(channel: GuildChannel, ctx: NukeContext): Promise<void> {
  const cfg = getAntiNuke();
  if (!cfg.enabled || !cfg.actions.channel) return;
  const actor = await resolveActor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  if (actor && cfg.whitelist.includes(actor.id)) return;
  ctx.actor = actor ?? { id: '', username: 'unknown' };
  ctx.reason = actor?.reason ?? null;
  await applyPunishment(ctx, actor?.id ?? channel.guild.ownerId);
}

export async function handleMemberBan(guild: Guild, user: User, ctx: NukeContext): Promise<void> {
  const cfg = getAntiNuke();
  if (!cfg.enabled || !cfg.actions.ban) return;
  const actor = await resolveActor(guild, AuditLogEvent.MemberBanAdd, user.id);
  if (actor && cfg.whitelist.includes(actor.id)) return;
  ctx.actor = actor ?? { id: '', username: 'unknown' };
  ctx.reason = actor?.reason ?? null;
  await applyPunishment(ctx, actor?.id ?? guild.ownerId);
}

export async function handleMemberKick(guild: Guild, user: User, ctx: NukeContext): Promise<void> {
  const cfg = getAntiNuke();
  if (!cfg.enabled || !cfg.actions.kick) return;
  const actor = await resolveActor(guild, AuditLogEvent.MemberKick, user.id);
  if (actor && cfg.whitelist.includes(actor.id)) return;
  ctx.actor = actor ?? { id: '', username: 'unknown' };
  ctx.reason = actor?.reason ?? null;
  await applyPunishment(ctx, actor?.id ?? guild.ownerId);
}
