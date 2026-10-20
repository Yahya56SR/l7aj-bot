import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
} from 'discord.js';
import { getConfig, updateConfig } from '../config';

/**
 * MEE6 parity:
 *   !xpchannel  -> /xp channel
 *   !nocxp      -> /xp nocxp
 */
export const data = new SlashCommandBuilder()
  .setName('xp')
  .setDescription('Configure how XP is earned')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('channel')
      .setDescription('Only earn XP in one channel (or allow all channels again)')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('The only channel where XP is earned — leave blank to allow all')
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('nocxp')
      .setDescription('Channels where members earn no XP')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Exclude a channel from XP')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Channel to exclude')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Allow XP in an excluded channel again')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Channel to re-enable')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('List excluded channels')),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  if (group === 'nocxp') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return nocxpAdd(interaction);
    if (sub === 'remove') return nocxpRemove(interaction);
    if (sub === 'list') return nocxpList(interaction);
    return;
  }

  if (interaction.options.getSubcommand() === 'channel') {
    return xpChannel(interaction);
  }
}

async function xpChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel('channel');

  updateConfig((cfg) => {
    cfg.xp.xpChannel = channel ? channel.id : '';
  });

  if (channel) {
    await interaction.reply({
      content: `✅ XP is now only earned in <#${channel.id}>. Use \`/xp channel\` with no channel to allow all channels again.`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: '✅ XP can now be earned in every channel (no-XP channels still apply).',
      ephemeral: true,
    });
  }
}

async function nocxpAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  const cfg = getConfig();

  if (cfg.xp.noXpChannels.includes(channel.id)) {
    await interaction.reply({
      content: `<#${channel.id}> is already excluded from XP.`,
      ephemeral: true,
    });
    return;
  }

  updateConfig((c) => {
    c.xp.noXpChannels.push(channel.id);
  });

  await interaction.reply({
    content: `✅ Members earn no XP in <#${channel.id}>.`,
    ephemeral: true,
  });
}

async function nocxpRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  const cfg = getConfig();

  if (!cfg.xp.noXpChannels.includes(channel.id)) {
    await interaction.reply({
      content: `<#${channel.id}> is not excluded from XP.`,
      ephemeral: true,
    });
    return;
  }

  updateConfig((c) => {
    c.xp.noXpChannels = c.xp.noXpChannels.filter((id) => id !== channel.id);
  });

  await interaction.reply({
    content: `✅ Members earn XP in <#${channel.id}> again.`,
    ephemeral: true,
  });
}

async function nocxpList(interaction: ChatInputCommandInteraction): Promise<void> {
  const cfg = getConfig();
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🚫 Channels without XP');

  if (cfg.xp.noXpChannels.length === 0) {
    embed.setDescription('No channels are excluded — XP is earned everywhere.');
  } else {
    embed.setDescription(cfg.xp.noXpChannels.map((id) => `<#${id}>`).join('\n'));
  }

  if (cfg.xp.xpChannel) {
    embed.addFields({ name: 'Exclusive XP channel', value: `<#${cfg.xp.xpChannel}>` });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
