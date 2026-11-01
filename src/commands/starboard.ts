import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
} from 'discord.js';
import { getStarboard, setStarboard } from '../db';

const starboardPosted = new Set<string>();

export const data = new SlashCommandBuilder()
  .setName('starboard')
  .setDescription('Configure the starboard')
  .setDefaultMemberPermissions(0n)
  .addSubcommand((sub) =>
    sub
      .setName('channel')
      .setDescription('Set the starboard channel')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Starboard channel')
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('emoji')
      .setDescription('Set the star emoji')
      .addStringOption((o) =>
        o.setName('emoji').setDescription('Emoji to use (e.g. ⭐)').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('threshold')
      .setDescription('Set the star count required to post')
      .addIntegerOption((o) =>
        o.setName('count').setDescription('Star threshold').setRequired(true).setMinValue(1).setMaxValue(50),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('view').setDescription('View current starboard config'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'channel': return setChannel(interaction);
    case 'emoji': return setEmoji(interaction);
    case 'threshold': return setThreshold(interaction);
    case 'view': return view(interaction);
    default: return;
  }
}

async function setChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  if (channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: 'Please pick a text channel.', ephemeral: true });
    return;
  }
  setStarboard({ channelId: channel.id });
  await interaction.reply({ content: `✅ Starboard channel set to ${channel}.`, ephemeral: true });
}

async function setEmoji(interaction: ChatInputCommandInteraction): Promise<void> {
  const emoji = interaction.options.getString('emoji', true);
  setStarboard({ emoji });
  await interaction.reply({ content: `✅ Star emoji set to ${emoji}.`, ephemeral: true });
}

async function setThreshold(interaction: ChatInputCommandInteraction): Promise<void> {
  const count = interaction.options.getInteger('count', true);
  setStarboard({ threshold: count });
  await interaction.reply({ content: `✅ Star threshold set to ${count}.`, ephemeral: true });
}

async function view(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = getStarboard();
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('⭐ Starboard Configuration')
    .addFields(
      { name: 'Channel', value: config.channelId ? `<#${config.channelId}>` : '(not set)', inline: true },
      { name: 'Emoji', value: config.emoji, inline: true },
      { name: 'Threshold', value: String(config.threshold), inline: true },
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Reaction handler (called from messageReactionAdd)                  */
/* ------------------------------------------------------------------ */

/** Handle a star reaction: post to the starboard channel when threshold is reached. */
export async function handleStarboardReaction(
  reaction: {
    emoji: { name: string | null; id: string | null };
    count: number;
    message: {
      id: string;
      channel: { id: string };
      content: string;
      author: { id: string; username: string };
      url: string;
    };
  },
  client: { channels: { cache: Map<string, any> }; guilds: { cache: Map<string, any> } },
): Promise<boolean> {
  const cfg = getStarboard();
  if (!cfg.channelId) return false;
  if (reaction.emoji.name !== cfg.emoji) return false;
  if (reaction.count < cfg.threshold) return false;
  if (starboardPosted.has(reaction.message.id)) return false;

  const guildId = [...client.guilds.cache.keys()][0];
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;
  const channel = guild.channels.cache.get(cfg.channelId) as TextChannel | undefined;
  if (!channel || !channel.isTextBased()) return false;

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('⭐ Starred Message')
    .setDescription(reaction.message.content || '*no content*')
    .addFields(
      { name: 'Author', value: `<@${reaction.message.author.id}>`, inline: true },
      { name: 'Stars', value: String(reaction.count), inline: true },
      { name: 'Channel', value: `<#${reaction.message.channel.id}>`, inline: true },
      { name: 'Jump', value: `[Link](${reaction.message.url})`, inline: true },
    )
    .setTimestamp();

  try {
    await (channel as TextChannel).send({ embeds: [embed] });
    starboardPosted.add(reaction.message.id);
    return true;
  } catch {
    return false;
  }
}
