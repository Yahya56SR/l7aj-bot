import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  TextChannel,
  Role,
} from 'discord.js';
import { getConfig, updateConfig } from '../config';
import { canAssignRole, emojiKeyMatches, parseEmojiForReact } from '../utils/discord';

export const data = new SlashCommandBuilder()
  .setName('reactionroles')
  .setDescription('Manage reaction-based roles')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Post a new reaction-role message')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to post the role message in')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addStringOption((o) => o.setName('title').setDescription('Embed title'))
      .addStringOption((o) => o.setName('description').setDescription('Embed description')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Add an emoji → role mapping to the role message')
      .addStringOption((o) =>
        o
          .setName('emoji')
          .setDescription('Emoji users react with (unicode or custom <:name:id>)')
          .setRequired(true),
      )
      .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove an emoji → role mapping')
      .addStringOption((o) =>
        o.setName('emoji').setDescription('Emoji mapping to remove').setRequired(true),
      ),
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('List current emoji → role mappings'));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'setup':
      return setup(interaction);
    case 'add':
      return add(interaction);
    case 'remove':
      return remove(interaction);
    case 'list':
      return list(interaction);
    default:
      return;
  }
}

async function setup(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channelOption = interaction.options.getChannel('channel', true);
  const channel = await guild.channels.fetch(channelOption.id).catch(() => null);
  const title = interaction.options.getString('title') || '🎭 Reaction Roles';
  const description =
    interaction.options.getString('description') ||
    'React below to get a role. Remove your reaction to drop it.';

  if (!channel || !channel.isTextBased()) {
    await interaction.reply({ content: 'Please pick a text channel.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(description);

  try {
    updateConfig((cfg) => {
      cfg.guildId = cfg.guildId || guild.id;
      cfg.reactionRoles.messageId = '';
      cfg.reactionRoles.channelId = channel.id;
      cfg.reactionRoles.mappings = {};
    });

    const message = await (channel as TextChannel).send({ embeds: [embed] });

    updateConfig((cfg) => {
      cfg.reactionRoles.messageId = message.id;
    });

    await interaction.reply({
      content: `✅ Reaction-role message posted in <#${channel.id}>.\nAdd mappings with \`/reactionroles add\` — the bot will react automatically.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error('Failed to create reaction role message:', err);
    updateConfig((cfg) => {
      cfg.reactionRoles.messageId = '';
      cfg.reactionRoles.channelId = '';
      cfg.reactionRoles.mappings = {};
    });
    await interaction.reply({
      content: 'I could not post in that channel. Check my permissions and try again.',
      ephemeral: true,
    });
  }
}

async function add(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const emoji = interaction.options.getString('emoji', true).trim();
  const role = interaction.options.getRole('role', true) as Role;

  const cfg = getConfig();
  if (!cfg.reactionRoles.messageId || !cfg.reactionRoles.channelId) {
    await interaction.reply({
      content: 'No reaction-role message configured yet. Run `/reactionroles setup` first.',
      ephemeral: true,
    });
    return;
  }

  const permissionError = canAssignRole(guild, role);
  if (permissionError) {
    await interaction.reply({ content: permissionError, ephemeral: true });
    return;
  }

  const channel = await guild.channels.fetch(cfg.reactionRoles.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    await interaction.reply({
      content: 'The configured reaction-role channel no longer exists. Run `/reactionroles setup` again.',
      ephemeral: true,
    });
    return;
  }

  const message = await channel.messages.fetch(cfg.reactionRoles.messageId).catch(() => null);
  if (!message) {
    await interaction.reply({
      content: 'The configured reaction-role message no longer exists. Run `/reactionroles setup` again.',
      ephemeral: true,
    });
    return;
  }

  try {
    updateConfig((c) => {
      c.reactionRoles.mappings[emoji] = role.id;
    });

    await message.react(parseEmojiForReact(emoji));
  } catch (err) {
    console.error(`Failed to react with ${emoji}:`, err);
    // Rollback config on failure
    updateConfig((c) => {
      delete c.reactionRoles.mappings[emoji];
    });
    await interaction.reply({
      content: `I could not react with ${emoji}. Make sure it is a valid emoji (custom emoji must be from this server).`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `✅ ${emoji} → <@&${role.id}> added and reacted to the message.`,
    ephemeral: true,
  });
}

async function remove(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const emoji = interaction.options.getString('emoji', true).trim();
  const cfg = getConfig();

  if (!cfg.reactionRoles.mappings[emoji]) {
    await interaction.reply({
      content: `${emoji} is not configured. Use \`/reactionroles list\` to see mappings.`,
      ephemeral: true,
    });
    return;
  }

  updateConfig((c) => {
    delete c.reactionRoles.mappings[emoji];
  });

  try {
    const channel = await guild.channels.fetch(cfg.reactionRoles.channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages.fetch(cfg.reactionRoles.messageId).catch(() => null);
      if (message) {
        const reaction = message.reactions.cache.find((r) => emojiKeyMatches(r.emoji, emoji));
        if (reaction) await reaction.remove();
      }
    }
  } catch (err) {
    console.error('Failed to remove reaction from message:', err);
  }

  await interaction.reply({ content: `✅ Removed ${emoji} from reaction roles.`, ephemeral: true });
}

async function list(interaction: ChatInputCommandInteraction): Promise<void> {
  const cfg = getConfig();
  const entries = Object.entries(cfg.reactionRoles.mappings);

  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('Reaction-role mappings');

  if (entries.length === 0) {
    embed.setDescription('No mappings yet. Add one with `/reactionroles add`.');
  } else {
    embed.setDescription(entries.map(([emoji, roleId]) => `${emoji} → <@&${roleId}>`).join('\n'));
    if (cfg.reactionRoles.channelId) {
      embed.setFooter({ text: `Channel: #${cfg.reactionRoles.channelId}` });
    }
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
