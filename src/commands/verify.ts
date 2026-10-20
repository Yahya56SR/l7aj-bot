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
import { canAssignRole } from '../utils/discord';
import { VERIFY_GRANT, VERIFY_REVOKE } from '../handlers/buttons';

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Let members verify themselves with a button')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Post a verification message with a button')
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role granted on verification').setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to post the verification message in')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addStringOption((o) => o.setName('title').setDescription('Embed title'))
      .addStringOption((o) => o.setName('description').setDescription('Embed description'))
      .addBooleanOption((o) =>
        o
          .setName('unverify')
          .setDescription('Also show a button that removes the role')
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('disable').setDescription('Delete the verification message and turn it off'),
  )
  .addSubcommand((sub) => sub.setName('status').setDescription('Show the current setup'));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'setup':
      return setup(interaction);
    case 'disable':
      return disable(interaction);
    case 'status':
      return status(interaction);
    default:
      return;
  }
}

async function setup(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const role = interaction.options.getRole('role', true) as Role;
  const channelOption = interaction.options.getChannel('channel', true);
  const channel = await guild.channels.fetch(channelOption.id).catch(() => null);
  const title = interaction.options.getString('title') || '✅ Verification';
  const description =
    interaction.options.getString('description') ||
    'Click the button below to verify yourself and unlock the server.';
  const showUnverify = interaction.options.getBoolean('unverify') ?? true;

  if (!channel || !channel.isTextBased()) {
    await interaction.reply({ content: 'Please pick a text channel.', ephemeral: true });
    return;
  }

  const error = canAssignRole(guild, role);
  if (error) {
    await interaction.reply({ content: error, ephemeral: true });
    return;
  }

  // Remove an old verification message so there is only one
  const previous = getConfig().verification;
  if (previous.messageId && previous.channelId) {
    try {
      const oldChannel = await guild.channels.fetch(previous.channelId).catch(() => null);
      if (oldChannel && oldChannel.isTextBased()) {
        const oldMessage = await oldChannel.messages
          .fetch(previous.messageId)
          .catch(() => null);
        if (oldMessage) await oldMessage.delete();
      }
    } catch (err) {
      console.error('Failed to delete old verification message:', err);
    }
  }

  const embed = new EmbedBuilder().setColor(0x57f287).setTitle(title).setDescription(description);

  try {
    updateConfig((cfg) => {
      cfg.guildId = cfg.guildId || guild.id;
      cfg.verification.messageId = '';
      cfg.verification.channelId = channel.id;
      cfg.verification.roleId = role.id;
      cfg.verification.title = title;
      cfg.verification.description = description;
      cfg.verification.showUnverify = showUnverify;
    });

    const message = await (channel as TextChannel).send({
      embeds: [embed],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 3, label: 'Verify', custom_id: VERIFY_GRANT },
            ...(showUnverify
              ? [{ type: 2, style: 2, label: 'Unverify', custom_id: VERIFY_REVOKE }]
              : []),
          ],
        },
      ],
    });

    updateConfig((cfg) => {
      cfg.verification.messageId = message.id;
    });

    await interaction.reply({
      content: `✅ Verification message posted in <#${channel.id}>.\nMembers who click **Verify** get the **${role.name}** role.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error('Failed to create verification message:', err);
    updateConfig((cfg) => {
      cfg.verification.messageId = '';
      cfg.verification.channelId = '';
      cfg.verification.roleId = '';
    });
    await interaction.reply({
      content: 'I could not post in that channel. Check my permissions and try again.',
      ephemeral: true,
    });
  }
}

async function disable(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const ver = getConfig().verification;

  if (!ver.messageId) {
    await interaction.reply({ content: 'Verification is not set up.', ephemeral: true });
    return;
  }

  try {
    const channel = await guild.channels.fetch(ver.channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages.fetch(ver.messageId).catch(() => null);
      if (message) await message.delete();
    }
  } catch (err) {
    console.error('Failed to delete verification message:', err);
  }

  updateConfig((cfg) => {
    cfg.verification.messageId = '';
    cfg.verification.channelId = '';
    cfg.verification.roleId = '';
  });

  await interaction.reply({
    content: '✅ Verification turned off and the message deleted. Members keep the role they had.',
    ephemeral: true,
  });
}

async function status(interaction: ChatInputCommandInteraction): Promise<void> {
  const ver = getConfig().verification;
  const embed = new EmbedBuilder().setColor(0x57f287).setTitle('✅ Verification status');

  if (!ver.roleId) {
    embed.setDescription('Verification is not set up. Run `/verify setup`.');
  } else {
    embed.setDescription(
      [
        `Role: <@&${ver.roleId}>`,
        `Message: ${ver.channelId ? `<#${ver.channelId}>` : '(unknown channel)'}`,
        `Unverify button: ${ver.showUnverify ? 'enabled' : 'disabled'}`,
      ].join('\n'),
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
