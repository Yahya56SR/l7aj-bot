import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  GuildMember,
  Role,
  TextChannel,
  VoiceChannel,
  CategoryChannel,
} from 'discord.js';
import { getConfig } from '../config';
import { getTotalMemberCount, countRanked, getLeaderboard, getRankPosition, getUser } from '../db';

export const data = new SlashCommandBuilder()
  .setName('utility')
  .setDescription('Server and member information utilities')
  .addSubcommand((sub) =>
    sub
      .setName('userinfo')
      .setDescription('View information about a member')
      .addUserOption((o) => o.setName('member').setDescription('Member to inspect').setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('serverinfo')
      .setDescription('View information about the server'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('avatar')
      .setDescription('View a member\'s avatar')
      .addUserOption((o) => o.setName('member').setDescription('Member whose avatar to view').setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('banner')
      .setDescription('View a member\'s banner (if they have one)')
      .addUserOption((o) => o.setName('member').setDescription('Member whose banner to view').setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('ping')
      .setDescription('Check the bot\'s latency'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('uptime')
      .setDescription('Check how long the bot has been running'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('roleinfo')
      .setDescription('View information about a role')
      .addRoleOption((o) => o.setName('role').setDescription('Role to inspect').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('channelinfo')
      .setDescription('View information about a channel')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to inspect')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildAnnouncement, ChannelType.GuildForum),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'userinfo': return userinfo(interaction);
    case 'serverinfo': return serverinfo(interaction);
    case 'avatar': return avatar(interaction);
    case 'banner': return banner(interaction);
    case 'ping': return ping(interaction);
    case 'uptime': return uptime(interaction);
    case 'roleinfo': return roleinfo(interaction);
    case 'channelinfo': return channelinfo(interaction);
    default: return;
  }
}

async function userinfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const target = interaction.options.getMember('member') ?? interaction.member;
  const member = target as GuildMember;
  const user = member.user;

  const userRow = getUser(member.id);
  const xpLine = userRow
    ? `**XP:** ${userRow.xp} · **Level:** ${userRow.level} · **Rank:** #${getRankPosition(member.id)}`
    : 'No XP record yet.';

  const roles = [...member.roles.cache.values()]
    .filter((role) => role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => role.toString())
    .slice(0, 20);

  const embed = new EmbedBuilder()
    .setColor(member.displayColor || 0x5865f2)
    .setTitle('👤 Member Information')
    .setThumbnail(user.displayAvatarURL({ extension: 'png', size: 256 }))
    .addFields(
      { name: 'Username', value: user.username, inline: true },
      { name: 'Display Name', value: member.displayName, inline: true },
      { name: 'ID', value: `\`${user.id}\``, inline: true },
      { name: 'Bot', value: String(user.bot), inline: true },
      {
        name: 'Account Created',
        value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
        inline: true,
      },
      {
        name: 'Joined Server',
        value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : 'Unknown',
        inline: true,
      },
    )
    .addFields({ name: 'XP / Level / Rank', value: xpLine, inline: false });

  if (roles.length > 0) {
    embed.addFields({ name: `Roles (${roles.length})`, value: roles.join(', ') || 'None', inline: false });
  }

  embed.setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });
  embed.setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function serverinfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;

  const textChannels = guild.channels.cache.filter((c) => c.isTextBased() && !c.isDMBased()).size;
  const voiceChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).size;
  const categories = guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).size;
  const roles = guild.roles.cache.size;
  const emojis = guild.emojis.cache.size;
  const boosts = guild.premiumSubscriptionCount ?? 0;
  const tier = guild.premiumTier;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🏰 ${guild.name}`)
    .setThumbnail(guild.iconURL({ extension: 'png', size: 256 }))
    .addFields(
      { name: 'Server ID', value: `\`${guild.id}\``, inline: true },
      { name: 'Owner', value: guild.ownerId ? `<@${guild.ownerId}>` : 'Unknown', inline: true },
      { name: 'Region', value: guild.preferredLocale, inline: true },
      { name: 'Members', value: String(guild.memberCount), inline: true },
      { name: 'Total Tracked', value: String(getTotalMemberCount()), inline: true },
      { name: 'Ranked Members', value: String(countRanked()), inline: true },
      { name: 'Text Channels', value: String(textChannels), inline: true },
      { name: 'Voice Channels', value: String(voiceChannels), inline: true },
      { name: 'Categories', value: String(categories), inline: true },
      { name: 'Roles', value: String(roles), inline: true },
      { name: 'Emojis', value: String(emojis), inline: true },
      { name: 'Boost Level', value: `${tier} (${boosts} boosts)`, inline: true },
      {
        name: 'Created',
        value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
        inline: true,
      },
      {
        name: 'Verification',
        value: String(guild.verificationLevel),
        inline: true,
      },
    )
    .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function avatar(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser('member') ?? interaction.user;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🖼️ ${target.username}'s Avatar`)
    .setImage(target.displayAvatarURL({ extension: 'png', size: 1024 }))
    .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
    .setTimestamp();
  await interaction.reply({ embeds: [embed] });
}

async function banner(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetId = interaction.options.getUser('member')?.id ?? interaction.user.id;
  let user;
  try {
    user = await interaction.client.users.fetch(targetId);
  } catch {
    await interaction.reply({ content: 'I could not fetch that user.', ephemeral: true });
    return;
  }

  if (!user.banner) {
    await interaction.reply({ content: `${user.username} does not have a banner set.`, ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎨 ${user.username}'s Banner`)
    .setImage(user.bannerURL({ extension: 'png', size: 1024 }) ?? '')
    .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
    .setTimestamp();
  await interaction.reply({ embeds: [embed] });
}

async function ping(interaction: ChatInputCommandInteraction): Promise<void> {
  const sent = await interaction.reply({ content: '🏓 Pinging...', ephemeral: true, fetchReply: true });
  const latency = sent.createdTimestamp - interaction.createdTimestamp;
  const heartbeat = Math.round(interaction.client.ws.ping);
  await interaction.editReply({
    content: `🏓 Pong!\n• **Roundtrip:** ${latency}ms\n• **Heartbeat:** ${heartbeat}ms`,
  });
}

async function uptime(interaction: ChatInputCommandInteraction): Promise<void> {
  const seconds = Math.floor(interaction.client.uptime / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('⏱️ Bot Uptime')
    .addFields(
      { name: 'Uptime', value: `${days}d ${hours}h ${minutes}m ${secs}s`, inline: true },
      { name: 'Servers', value: String(interaction.client.guilds.cache.size), inline: true },
      { name: 'Ping', value: `${Math.round(interaction.client.ws.ping)}ms`, inline: true },
    )
    .setTimestamp();
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function roleinfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const role = interaction.options.getRole('role', true) as Role;
  const me = guild.members.me;
  const assignable = me ? !role.managed && role.position < me.roles.highest.position : false;

  const embed = new EmbedBuilder()
    .setColor(role.hexColor ?? 0x5865f2)
    .setTitle(`🏷️ ${role.name}`)
    .addFields(
      { name: 'Role ID', value: `\`${role.id}\``, inline: true },
      { name: 'Color', value: role.hexColor ?? 'Default', inline: true },
      { name: 'Position', value: String(role.position), inline: true },
      { name: 'Members', value: String(role.members.size), inline: true },
      { name: 'Mentionable', value: String(role.mentionable), inline: true },
      { name: 'Hoisted', value: String(role.hoist), inline: true },
      { name: 'Managed', value: String(role.managed), inline: true },
      { name: 'Assignable by me', value: String(assignable), inline: true },
    )
    .setTimestamp();
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function channelinfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel('channel') ?? interaction.channel ?? null;
  if (!channel || !guild.channels.cache.has(channel.id)) {
    await interaction.reply({ content: 'I could not find that channel.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📺 ${(channel as { name: string }).name}`)
    .addFields(
      { name: 'Channel ID', value: `\`${channel.id}\``, inline: true },
      { name: 'Type', value: String(channel.type), inline: true },
      { name: 'Position', value: 'position' in channel ? String(channel.position) : 'N/A', inline: true },
    );

  const parentName = (channel as { parent?: { name: string } | null }).parent?.name;
  if (parentName) embed.addFields({ name: 'Category', value: parentName, inline: true });

  const ctype = (channel as { type: ChannelType }).type;
  const isText =
    ctype === ChannelType.GuildText ||
    ctype === ChannelType.GuildAnnouncement ||
    ctype === ChannelType.GuildForum ||
    ctype === ChannelType.GuildMedia;

  if (isText) {
    const textChannel = channel as TextChannel;
    embed.addFields({ name: 'NSFW', value: String(textChannel.nsfw), inline: true });
    if (textChannel.topic) embed.addFields({ name: 'Topic', value: textChannel.topic, inline: false });
    embed.addFields({ name: 'Slowmode', value: `${textChannel.rateLimitPerUser} second(s)`, inline: true });
  }

  if (ctype === ChannelType.GuildVoice) {
    const vc = channel as unknown as { bitrate: number; userLimit: number };
    embed.addFields({ name: 'Bitrate', value: `${Math.floor(vc.bitrate / 1000)} kbps`, inline: true });
    embed.addFields({ name: 'User Limit', value: vc.userLimit === 0 ? 'Unlimited' : String(vc.userLimit), inline: true });
  }

  if (ctype === ChannelType.GuildCategory) {
    const cat = channel as unknown as { children: { size: number } };
    embed.addFields({ name: 'Channels', value: String(cat.children.size), inline: true });
  }

  embed.setTimestamp();
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
