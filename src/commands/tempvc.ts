import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  VoiceChannel,
  CategoryChannel,
  GuildMember,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  TextChannel,
  type Message,
  type Client,
  type ButtonInteraction,
} from 'discord.js';
import { setTempVC, getTempVC, listTempVC, deleteTempVC } from '../db';
import { getConfig } from '../config';

const TEMPVC_PREFIX = 'tempvc:';

const PANEL_BUTTONS = [
  { id: 'rename', label: 'RENAME', emoji: '✏️', style: ButtonStyle.Secondary },
  { id: 'limit', label: 'LIMIT', emoji: '👥', style: ButtonStyle.Secondary },
  { id: 'lock', label: 'LOCK', emoji: '🔒', style: ButtonStyle.Secondary },
  { id: 'unlock', label: 'UNLOCK', emoji: '🔓', style: ButtonStyle.Secondary },
  { id: 'invite', label: 'INVITE', emoji: '✉️', style: ButtonStyle.Secondary },
  { id: 'delete', label: 'DELETE', emoji: '🗑️', style: ButtonStyle.Danger },
  { id: 'hide', label: 'HIDE', emoji: '👁️‍🗨️', style: ButtonStyle.Secondary },
  { id: 'show', label: 'SHOW', emoji: '👁️', style: ButtonStyle.Secondary },
  { id: 'trust', label: 'TRUST', emoji: '✅', style: ButtonStyle.Success },
  { id: 'untrust', label: 'UNTRUST', emoji: '❌', style: ButtonStyle.Secondary },
  { id: 'claim', label: 'CLAIM', emoji: '📥', style: ButtonStyle.Secondary },
  { id: 'transfer', label: 'TRANSFER', emoji: '🔄', style: ButtonStyle.Secondary },
  { id: 'kick', label: 'KICK', emoji: '👢', style: ButtonStyle.Danger },
  { id: 'block', label: 'BLOCK', emoji: '🚫', style: ButtonStyle.Danger },
  { id: 'unblock', label: 'UNBLOCK', emoji: '✅', style: ButtonStyle.Secondary },
];

export const data = new SlashCommandBuilder()
  .setName('tempvc')
  .setDescription('Manage join-to-create temporary voice channels')
  .setDefaultMemberPermissions(0n)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Set the join-to-create channel and category')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Voice channel members join to create a temp VC')
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName('category')
          .setDescription('Category where temp VCs are created')
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('panel')
      .setDescription('Post the temp VC control panel in a channel')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to post the control panel in')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('limit').setDescription('Set your temp VC user limit')
      .addIntegerOption((o) => o.setName('limit').setDescription('User limit (0 = unlimited)').setRequired(true).setMinValue(0).setMaxValue(99)),
  )
  .addSubcommand((sub) =>
    sub.setName('name').setDescription('Set your temp VC name')
      .addStringOption((o) => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(100)),
  )
  .addSubcommand((sub) =>
    sub.setName('kick').setDescription('Kick a member from your temp VC')
      .addUserOption((o) => o.setName('member').setDescription('Member to kick').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub.setName('config').setDescription('View temp VC config'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'setup': return setup(interaction);
    case 'panel': return panel(interaction);
    case 'limit': return setLimit(interaction);
    case 'name': return setName(interaction);
    case 'kick': return kick(interaction);
    case 'config': return config(interaction);
    default: return;
  }
}

async function setup(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel('channel', true) as VoiceChannel;
  const category = interaction.options.getChannel('category', true) as CategoryChannel;

  const cfg = getConfig();
  cfg.tempvc.createChannelId = channel.id;
  cfg.tempvc.categoryId = category.id;

  await interaction.reply({
    content: `✅ Temp VC setup: join <#${channel.id}> to create a channel in <#${category.id}>.`,
    ephemeral: true,
  });
}

async function panel(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel('channel', true) as TextChannel;

  const cfg = getConfig();
  if (!cfg.tempvc.createChannelId || !cfg.tempvc.categoryId) {
    await interaction.reply({ content: 'Set up temp VC first with `/tempvc setup`.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔊 Temporary Voice Control Panel')
    .setDescription(
      'Use the buttons below to manage your temporary voice channel. ' +
      'Buttons only work when you are in a temp VC you own (or claimed).',
    )
    .setTimestamp();

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < PANEL_BUTTONS.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const btn of PANEL_BUTTONS.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${TEMPVC_PREFIX}${btn.id}`)
          .setLabel(btn.label)
          .setEmoji(btn.emoji)
          .setStyle(btn.style),
      );
    }
    rows.push(row);
  }

  const existingMessageId = cfg.tempvc.panelMessageId;
  let message: Message | null = null;

  if (existingMessageId) {
    try {
      message = await channel.messages.fetch(existingMessageId).catch(() => null);
    } catch {
      message = null;
    }
  }

  if (message) {
    await message.edit({ embeds: [embed], components: rows });
  } else {
    message = await channel.send({ embeds: [embed], components: rows });
  }

  cfg.tempvc.panelChannelId = channel.id;
  cfg.tempvc.panelMessageId = message.id;

  await interaction.reply({ content: `✅ Temp VC panel posted in ${channel}.`, ephemeral: true });
}

async function config(interaction: ChatInputCommandInteraction): Promise<void> {
  const cfg = getConfig();
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🔊 Temporary Voice Config');

  if (!cfg.tempvc.createChannelId || !cfg.tempvc.categoryId) {
    embed.setDescription('No temp VC configured. Use `/tempvc setup`.');
  } else {
    embed.setDescription(
      `Create channel: <#${cfg.tempvc.createChannelId}>\n` +
      `Category: <#${cfg.tempvc.categoryId}>\n` +
      `Panel channel: ${cfg.tempvc.panelChannelId ? `<#${cfg.tempvc.panelChannelId}>` : 'not set'}\n` +
      `Panel message: ${cfg.tempvc.panelMessageId || 'not posted'}`,
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function setLimit(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member as { voice: { channel: { id: string } | null } };
  const channelId = member.voice?.channel?.id;
  if (!channelId) {
    await interaction.reply({ content: 'You must be in a voice channel to set its limit.', ephemeral: true });
    return;
  }
  const temp = getTempVC(channelId);
  if (!temp || temp.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'You only can change limits on a temp VC you own.', ephemeral: true });
    return;
  }
  const limit = interaction.options.getInteger('limit', true);
  const channel = interaction.guild!.channels.cache.get(channelId) as VoiceChannel | undefined;
  if (!channel) {
    await interaction.reply({ content: 'Channel not found.', ephemeral: true });
    return;
  }
  await channel.setRateLimitPerUser(limit);
  await interaction.reply({ content: `✅ Temp VC user limit set to ${limit === 0 ? 'unlimited' : limit}.`, ephemeral: true });
}

async function setName(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member as { voice: { channel: { id: string; name: string; edit: (opts: { name: string }) => Promise<void> } | null } };
  const channelId = member.voice?.channel?.id;
  if (!channelId) {
    await interaction.reply({ content: 'You must be in a voice channel to rename it.', ephemeral: true });
    return;
  }
  const temp = getTempVC(channelId);
  if (!temp || temp.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'You only can rename a temp VC you own.', ephemeral: true });
    return;
  }
  const name = interaction.options.getString('name', true);
  const channel = interaction.guild!.channels.cache.get(channelId);
  if (!channel || !('edit' in channel)) {
    await interaction.reply({ content: 'Channel not editable.', ephemeral: true });
    return;
  }
  await (channel as unknown as { edit: (opts: { name: string }) => Promise<void> }).edit({ name });
  await interaction.reply({ content: `✅ Temp VC renamed to **${name}**.`, ephemeral: true });
}

async function kick(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member as { voice: { channel: { id: string } | null } };
  const channelId = member.voice?.channel?.id;
  if (!channelId) {
    await interaction.reply({ content: 'You must be in a voice channel to kick someone.', ephemeral: true });
    return;
  }
  const temp = getTempVC(channelId);
  if (!temp || temp.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'You only can kick from a temp VC you own.', ephemeral: true });
    return;
  }
  const target = interaction.options.getMember('member') as GuildMember | null;
  if (!target) {
    await interaction.reply({ content: 'Member not found.', ephemeral: true });
    return;
  }
  if (!target.voice.channel || target.voice.channel.id !== channelId) {
    await interaction.reply({ content: 'That member is not in your temp VC.', ephemeral: true });
    return;
  }
  try {
    await target.voice.setChannel(null);
    await interaction.reply({ content: `✅ Kicked ${target.user.username} from your temp VC.`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `Failed to kick: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
  }
}

/* ------------------------------------------------------------------ */
/* Button panel handler (called from interactionCreate)               */
/* ------------------------------------------------------------------ */

export interface TempvcButtonInteraction {
  customId: string;
  member: GuildMember | null;
  guild: { id: string; channels: { cache: Map<string, any> }; members: { me: { roles: { highest: { position: number } } } } };
  reply: (opts: { content: string; ephemeral: boolean }) => Promise<unknown>;
  followUp: (opts: { content: string; ephemeral: boolean }) => Promise<unknown>;
  replied: boolean;
  deferred: boolean;
}

/** Returns true if the interaction was a temp VC panel button click. */
export async function handleTempvcButton(interaction: TempvcButtonInteraction): Promise<boolean> {
  const customId = interaction.customId;
  if (!customId.startsWith(TEMPVC_PREFIX)) return false;

  const action = customId.slice(TEMPVC_PREFIX.length);
  const member = interaction.member;
  if (!member) return false;

  const vcChannelId = member.voice?.channel?.id;
  if (!vcChannelId) {
    await safeReply(interaction, { content: 'You must be in a voice channel to use these controls.', ephemeral: true });
    return true;
  }

  const temp = getTempVC(vcChannelId);
  if (!temp) {
    await safeReply(interaction, { content: 'This is not a temporary voice channel.', ephemeral: true });
    return true;
  }

  const isOwner = temp.ownerId === member.id;
  const guild = member.guild;

  switch (action) {
    case 'rename':
      if (!isOwner) {
        await safeReply(interaction, { content: 'Only the VC owner can rename it.', ephemeral: true });
        return true;
      }
      await interaction.reply({ content: 'Use `/tempvc name <name>` to rename your VC.', ephemeral: true });
      return true;

    case 'limit':
      if (!isOwner) {
        await safeReply(interaction, { content: 'Only the VC owner can set the limit.', ephemeral: true });
        return true;
      }
      await interaction.reply({ content: 'Use `/tempvc limit <number>` to set the user limit.', ephemeral: true });
      return true;

    case 'lock':
      if (!isOwner) {
        await safeReply(interaction, { content: 'Only the VC owner can lock it.', ephemeral: true });
        return true;
      }
      try {
        await (member.voice.channel as unknown as { permissionOverwrites: { edit: (id: string, opts: { Connect: boolean }) => Promise<void> } }).permissionOverwrites.edit(guild.id, { Connect: false });
        await safeReply(interaction, { content: '🔒 VC locked.', ephemeral: true });
      } catch (err) {
        await safeReply(interaction, { content: `Failed to lock: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
      }
      return true;

    case 'unlock':
      if (!isOwner) {
        await safeReply(interaction, { content: 'Only the VC owner can unlock it.', ephemeral: true });
        return true;
      }
      try {
        await (member.voice.channel as unknown as { permissionOverwrites: { edit: (id: string, opts: { Connect: boolean | null }) => Promise<void> } }).permissionOverwrites.edit(guild.id, { Connect: null });
        await safeReply(interaction, { content: '🔓 VC unlocked.', ephemeral: true });
      } catch (err) {
        await safeReply(interaction, { content: `Failed to unlock: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
      }
      return true;

    case 'invite':
      if (!isOwner) {
        await safeReply(interaction, { content: 'Only the VC owner can invite.', ephemeral: true });
        return true;
      }
      await interaction.reply({ content: `Invite someone: <#${vcChannelId}>`, ephemeral: true });
      return true;

    case 'delete':
      if (!isOwner) {
        await safeReply(interaction, { content: 'Only the VC owner can delete it.', ephemeral: true });
        return true;
      }
      try {
        await (member.voice.channel as unknown as { delete: () => Promise<void> }).delete();
        deleteTempVC(vcChannelId);
        await safeReply(interaction, { content: '🗑️ VC deleted.', ephemeral: true });
      } catch (err) {
        await safeReply(interaction, { content: `Failed to delete: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
      }
      return true;

    case 'hide':
      if (!isOwner) {
        await safeReply(interaction, { content: 'Only the VC owner can hide it.', ephemeral: true });
        return true;
      }
      try {
        await (member.voice.channel as unknown as { permissionOverwrites: { edit: (id: string, opts: { ViewChannel: boolean }) => Promise<void> } }).permissionOverwrites.edit(guild.id, { ViewChannel: false });
        await safeReply(interaction, { content: '👁️‍🗨️ VC hidden.', ephemeral: true });
      } catch (err) {
        await safeReply(interaction, { content: `Failed to hide: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
      }
      return true;

    case 'show':
      if (!isOwner) {
        await safeReply(interaction, { content: 'Only the VC owner can show it.', ephemeral: true });
        return true;
      }
      try {
        await (member.voice.channel as unknown as { permissionOverwrites: { edit: (id: string, opts: { ViewChannel: boolean | null }) => Promise<void> } }).permissionOverwrites.edit(guild.id, { ViewChannel: null });
        await safeReply(interaction, { content: '👁️ VC shown.', ephemeral: true });
      } catch (err) {
        await safeReply(interaction, { content: `Failed to show: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
      }
      return true;

    case 'trust':
      await safeReply(interaction, { content: 'Trust: use `/tempvc kick` to manage members.', ephemeral: true });
      return true;

    case 'untrust':
      await safeReply(interaction, { content: 'Untrust: use `/tempvc kick` to manage members.', ephemeral: true });
      return true;

    case 'claim':
      if (isOwner) {
        await safeReply(interaction, { content: 'You already own this VC.', ephemeral: true });
        return true;
      }
      if (!temp.ownerId || !guild.members.cache.has(temp.ownerId)) {
        temp.ownerId = member.id;
        await safeReply(interaction, { content: '📥 VC claimed.', ephemeral: true });
      } else {
        await safeReply(interaction, { content: 'This VC already has an owner.', ephemeral: true });
      }
      return true;

    case 'transfer':
      await safeReply(interaction, { content: 'Transfer: use the dashboard or ask an admin.', ephemeral: true });
      return true;

    case 'kick':
      if (!isOwner) {
        await safeReply(interaction, { content: 'Only the VC owner can kick members.', ephemeral: true });
        return true;
      }
      await interaction.reply({ content: 'Use `/tempvc kick <member>` to kick from your VC.', ephemeral: true });
      return true;

    case 'block':
      if (!isOwner) {
        await safeReply(interaction, { content: 'Only the VC owner can block members.', ephemeral: true });
        return true;
      }
      await safeReply(interaction, { content: 'Block: use `/tempvc kick` to remove members.', ephemeral: true });
      return true;

    case 'unblock':
      await safeReply(interaction, { content: 'Unblock: blocked members can rejoin if the VC is unlocked.', ephemeral: true });
      return true;

    default:
      return false;
  }
}

async function safeReply(
  interaction: TempvcButtonInteraction,
  options: { content: string; ephemeral: boolean },
): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(options).catch(() => undefined);
    } else {
      await interaction.reply(options).catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Event helpers (called from voiceStateUpdate handler)               */
/* ------------------------------------------------------------------ */

/** Call when a member's voice state updates. Returns true if it handled a temp VC action. */
export async function handleTempVC(
  oldChannelId: string | null,
  newChannelId: string | null,
  member: GuildMember,
): Promise<boolean> {
  const tempVcs = listTempVC();
  const setup = tempVcs.find((t) => {
    const cat = member.guild.channels.cache.get(t.categoryId);
    return cat ? cat.id === t.categoryId : false;
  });
  if (!setup) return false;

  // If they joined the create channel, spawn a temp VC.
  if (newChannelId === setup.channelId && oldChannelId !== newChannelId) {
    const category = member.guild.channels.cache.get(setup.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) return false;
    try {
      const vc = await member.guild.channels.create({
        name: `${member.user.username}'s VC`,
        type: ChannelType.GuildVoice,
        parent: category,
        reason: 'Join-to-create temp VC',
      });
      await member.voice.setChannel(vc);
      setTempVC({ channelId: vc.id, ownerId: member.id, categoryId: setup.categoryId, createdAt: Date.now() });
      return true;
    } catch {
      return false;
    }
  }

  // If they left a temp VC and it's now empty, delete it.
  if (oldChannelId && oldChannelId !== newChannelId) {
    const temp = getTempVC(oldChannelId);
    if (temp) {
      const channel = member.guild.channels.cache.get(oldChannelId) as VoiceChannel | undefined;
      if (channel && channel.members.size === 0) {
        try {
          await channel.delete();
        } catch {
          /* ignore */
        }
        deleteTempVC(oldChannelId);
        return true;
      }
    }
  }

  return false;
}
