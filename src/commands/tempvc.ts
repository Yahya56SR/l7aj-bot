import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  VoiceChannel,
  CategoryChannel,
  GuildMember,
} from 'discord.js';
import { setTempVC, getTempVC, listTempVC, deleteTempVC } from '../db';
import { getConfig } from '../config';

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

  setTempVC({ channelId: channel.id, ownerId: '', categoryId: category.id, createdAt: Date.now() });
  await interaction.reply({
    content: `✅ Temp VC setup: join <#${channel.id}> to create a channel in <#${category.id}>.`,
    ephemeral: true,
  });
}

async function config(interaction: ChatInputCommandInteraction): Promise<void> {
  const cfg = getConfig();
  // Find tempvc entry for this guild by matching category.
  const tempVcs = listTempVC();
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🔊 Temporary Voice Config');
  if (tempVcs.length === 0) {
    embed.setDescription('No temp VC configured. Use `/tempvc setup`.');
  } else {
    // show all
    embed.setDescription(tempVcs.map((t) => `Create channel: <#${t.channelId}> • Category: <#${t.categoryId}>`).join('\n'));
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
  await channel.setUserLimit(limit);
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
/* Event helpers (called from voiceStateUpdate handler)               */
/* ------------------------------------------------------------------ */

/** Call when a member's voice state updates. Returns true if it handled a temp VC action. */
export async function handleTempVC(
  oldChannelId: string | null,
  newChannelId: string | null,
  member: GuildMember,
): Promise<boolean> {
  const guildId = member.guild.id;
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
