import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChatInputCommandInteraction,
  ChannelType,
} from 'discord.js';
import { getConfig, updateConfig } from '../config';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Show or modify bot configuration')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) => sub.setName('show').setDescription('Display current settings'))
  .addSubcommandGroup((group) =>
    group
      .setName('automod')
      .setDescription('Configure automod settings')
      .addSubcommand((sub) =>
        sub
          .setName('toggle')
          .setDescription('Enable or disable an automod feature')
          .addStringOption((opt) =>
            opt
              .setName('feature')
              .setDescription('Feature to toggle')
              .setRequired(true)
              .addChoices(
                { name: 'Block URLs', value: 'blockUrls' },
                { name: 'Block GIFs', value: 'blockGifs' },
                { name: 'Block CAPS', value: 'blockCaps' },
              ),
          )
          .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable or disable').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('set')
          .setDescription('Set automod thresholds')
          .addIntegerOption((opt) =>
            opt.setName('caps-min-length').setDescription('Minimum message length to check for caps').setMinValue(1).setMaxValue(500),
          )
          .addIntegerOption((opt) =>
            opt.setName('caps-max-percent').setDescription('Maximum percentage of caps allowed (0-100)').setMinValue(1).setMaxValue(100),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('whitelist')
          .setDescription('Manage GIF URL whitelist roles')
          .addStringOption((opt) =>
            opt
              .setName('action')
              .setDescription('Add or remove a role')
              .setRequired(true)
              .addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }),
          )
          .addRoleOption((opt) => opt.setName('role').setDescription('Role to add/remove from whitelist').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('ignore')
          .setDescription('Manage ignored channels (automod disabled)')
          .addStringOption((opt) =>
            opt
              .setName('action')
              .setDescription('Add or remove a channel')
              .setRequired(true)
              .addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }),
          )
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel to add/remove').setRequired(true).addChannelTypes(ChannelType.GuildText),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('bypass')
          .setDescription('Manage roles that bypass all automod checks')
          .addStringOption((opt) =>
            opt
              .setName('action')
              .setDescription('Add or remove a role')
              .setRequired(true)
              .addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }),
          )
          .addRoleOption((opt) => opt.setName('role').setDescription('Role to add/remove from bypass list').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('attachment-only')
          .setDescription('Manage channels where messages must have attachments')
          .addStringOption((opt) =>
            opt
              .setName('action')
              .setDescription('Add or remove a channel')
              .setRequired(true)
              .addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }),
          )
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel to add/remove').setRequired(true).addChannelTypes(ChannelType.GuildText),
          ),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('autoreact')
      .setDescription('Configure auto-reactions')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add a channel with auto-reactions')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel to add auto-reactions to').setRequired(true).addChannelTypes(ChannelType.GuildText),
          )
          .addStringOption((opt) =>
            opt
              .setName('emojis')
              .setDescription('Comma-separated list of emojis (unicode or custom like <:name:id>)')
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove auto-reactions from a channel')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel to remove auto-reactions from').setRequired(true).addChannelTypes(ChannelType.GuildText),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('edit')
          .setDescription('Edit emojis for an existing auto-reaction channel')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel to edit').setRequired(true).addChannelTypes(ChannelType.GuildText),
          )
          .addStringOption((opt) =>
            opt
              .setName('emojis')
              .setDescription('Comma-separated list of emojis (unicode or custom like <:name:id>)')
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('List all auto-reaction channels')),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('welcome')
      .setDescription('Configure welcome messages')
      .addSubcommand((sub) =>
        sub
          .setName('setup')
          .setDescription('Set up welcome channel and message')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel to send welcome messages').setRequired(true).addChannelTypes(ChannelType.GuildText),
          )
          .addStringOption((opt) =>
            opt
              .setName('message')
              .setDescription('Welcome message template. Placeholders: {user} {username} {server} {memberCount}')
              .setRequired(false),
          )
          .addBooleanOption((opt) =>
            opt.setName('enabled').setDescription('Enable welcome messages').setRequired(false),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('background')
          .setDescription('Set custom background image for welcome cards')
          .addAttachmentOption((opt) =>
            opt.setName('image').setDescription('Background image file (will be saved to assets/bg.jpg)').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('test')
          .setDescription('Send a test welcome card to the configured channel'),
      )
      .addSubcommand((sub) => sub.setName('disable').setDescription('Disable welcome messages')),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('goodbye')
      .setDescription('Configure goodbye messages')
      .addSubcommand((sub) =>
        sub
          .setName('setup')
          .setDescription('Set up goodbye channel and message')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel to send goodbye messages').setRequired(true).addChannelTypes(ChannelType.GuildText),
          )
          .addStringOption((opt) =>
            opt
              .setName('message')
              .setDescription('Goodbye message template. Placeholders: {user} {username} {server} {memberCount}')
              .setRequired(false),
          )
          .addBooleanOption((opt) =>
            opt.setName('enabled').setDescription('Enable goodbye messages').setRequired(false),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('test')
          .setDescription('Send a test goodbye message to the configured channel'),
      )
      .addSubcommand((sub) => sub.setName('disable').setDescription('Disable goodbye messages')),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const subcommandGroup = interaction.options.getSubcommandGroup();

  // Handle automod subcommands
  if (subcommandGroup === 'automod') {
    await handleAutomodConfig(interaction, subcommand);
    return;
  }

  // Handle auto-react subcommands
  if (subcommandGroup === 'autoreact') {
    await handleAutoReactConfig(interaction, subcommand);
    return;
  }

  // Handle welcome subcommands
  if (subcommandGroup === 'welcome') {
    await handleWelcomeConfig(interaction, subcommand);
    return;
  }

  // Handle goodbye subcommands
  if (subcommandGroup === 'goodbye') {
    await handleGoodbyeConfig(interaction, subcommand);
    return;
  }

  // Original show command
  const cfg = getConfig();
  const mappings = Object.entries(cfg.reactionRoles.mappings);
  const levelRoles = Object.entries(cfg.levelRoles).sort((a, b) => Number(a[0]) - Number(b[0]));
  const panels = cfg.roles.panels ?? [];

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚙️ Bot configuration')
    .addFields(
      {
        name: 'Reaction-role message',
        value: cfg.reactionRoles.messageId
          ? `<#${cfg.reactionRoles.channelId}> · \`${cfg.reactionRoles.messageId}\``
          : '(not set)',
        inline: false,
      },
      {
        name: 'Reaction-role mappings',
        value:
          mappings.length > 0
            ? mappings.map(([emoji, roleId]) => `${emoji} → <@&${roleId}>`).join('\n')
            : '(none)',
        inline: false,
      },
      {
        name: 'Button role panels',
        value:
          panels.length > 0
            ? panels
                .map(
                  (panel) =>
                    `**${panel.name}** (<#${panel.channelId}>) — ${panel.buttons.length} button(s)`,
                )
                .join('\n')
            : '(none)',
        inline: false,
      },
      {
        name: 'Verification',
        value: cfg.verification.roleId
          ? `Role <@&${cfg.verification.roleId}> · message in <#${cfg.verification.channelId}>`
          : '(not set)',
        inline: false,
      },
      {
        name: 'Level reward roles',
        value:
          levelRoles.length > 0
            ? levelRoles.map(([level, roleId]) => `Level ${level} → <@&${roleId}>`).join('\n')
            : '(none)',
        inline: false,
      },
      { name: 'XP per message', value: xpRange(cfg.xp.perMessageMin, cfg.xp.perMessageMax), inline: true },
      { name: 'Message cooldown', value: `${cfg.xp.cooldownSeconds}s`, inline: true },
      { name: 'Voice XP / minute', value: xpRange(cfg.xp.perVoiceMinuteMin, cfg.xp.perVoiceMinuteMax), inline: true },
      {
        name: 'No-XP channels',
        value:
          cfg.xp.noXpChannels && cfg.xp.noXpChannels.length > 0
            ? cfg.xp.noXpChannels.map((id) => `<#${id}>`).join('\n')
            : '(none)',
        inline: true,
      },
      {
        name: 'Exclusive XP channel',
        value: cfg.xp.xpChannel ? `<#${cfg.xp.xpChannel}>` : '(all channels)',
        inline: true,
      },
      {
        name: 'Level-up channel',
        value: cfg.channels.levelUp ? `<#${cfg.channels.levelUp}>` : '(current channel)',
        inline: true,
      },
      {
        name: 'Log channel',
        value: cfg.channels.logs ? `<#${cfg.channels.logs}>` : '(none)',
        inline: true,
      },
      {
        name: 'AutoMod',
        value: formatAutomod(cfg.automod),
        inline: false,
      },
      {
        name: 'Welcome',
        value: cfg.welcome.enabled
          ? `✅ Enabled · Channel: <#${cfg.welcome.channelId}>\nMessage: \`${cfg.welcome.message}\`\nBackground: \`${cfg.welcome.backgroundImage}\``
          : '❌ Disabled',
        inline: false,
      },
      {
        name: 'Goodbye',
        value: cfg.goodbye.enabled
          ? `✅ Enabled · Channel: <#${cfg.goodbye.channelId}>\nMessage: \`${cfg.goodbye.message}\``
          : '❌ Disabled',
        inline: false,
      },
      { name: 'Guild ID', value: cfg.guildId || '(missing)', inline: true },
    )
    .setFooter({ text: 'Token is never displayed for security reasons.' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleAutomodConfig(interaction: ChatInputCommandInteraction, subcommand: string): Promise<void> {
  const cfg = getConfig();
  const automod = cfg.automod;

  switch (subcommand) {
    case 'toggle': {
      const feature = interaction.options.getString('feature', true) as keyof typeof automod;
      const enabled = interaction.options.getBoolean('enabled', true);
      if (!['blockUrls', 'blockGifs', 'blockCaps'].includes(feature)) {
        await interaction.reply({ content: 'Invalid feature.', ephemeral: true });
        return;
      }
      updateConfig((c) => {
        (c.automod as any)[feature] = enabled;
      });
      await interaction.reply({ content: `✅ Automod **${feature}** ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
      break;
    }
    case 'set': {
      const capsMinLength = interaction.options.getInteger('caps-min-length');
      const capsMaxPercent = interaction.options.getInteger('caps-max-percent');
      updateConfig((c) => {
        if (capsMinLength !== null) c.automod.capsMinLength = capsMinLength;
        if (capsMaxPercent !== null) c.automod.capsMaxPercent = capsMaxPercent;
      });
      await interaction.reply({ content: '✅ Automod thresholds updated.', ephemeral: true });
      break;
    }
    case 'whitelist': {
      const action = interaction.options.getString('action', true);
      const role = interaction.options.getRole('role', true);
      updateConfig((c) => {
        const list = c.automod.gifWhitelistRoles;
        if (action === 'add') {
          if (!list.includes(role.id)) list.push(role.id);
        } else {
          const idx = list.indexOf(role.id);
          if (idx >= 0) list.splice(idx, 1);
        }
      });
      await interaction.reply({ content: `✅ Role ${role} ${action === 'add' ? 'added to' : 'removed from'} GIF whitelist.`, ephemeral: true });
      break;
    }
    case 'ignore': {
      const action = interaction.options.getString('action', true);
      const channel = interaction.options.getChannel('channel', true);
      updateConfig((c) => {
        const list = c.automod.ignoredChannels;
        if (action === 'add') {
          if (!list.includes(channel.id)) list.push(channel.id);
        } else {
          const idx = list.indexOf(channel.id);
          if (idx >= 0) list.splice(idx, 1);
        }
      });
      await interaction.reply({ content: `✅ Channel ${channel} ${action === 'add' ? 'added to' : 'removed from'} ignored channels.`, ephemeral: true });
      break;
    }
    case 'bypass': {
      const action = interaction.options.getString('action', true);
      const role = interaction.options.getRole('role', true);
      updateConfig((c) => {
        const list = c.automod.bypassRoles;
        if (action === 'add') {
          if (!list.includes(role.id)) list.push(role.id);
        } else {
          const idx = list.indexOf(role.id);
          if (idx >= 0) list.splice(idx, 1);
        }
      });
      await interaction.reply({ content: `✅ Role ${role} ${action === 'add' ? 'added to' : 'removed from'} bypass roles.`, ephemeral: true });
      break;
    }
    case 'attachment-only': {
      const action = interaction.options.getString('action', true);
      const channel = interaction.options.getChannel('channel', true);
      updateConfig((c) => {
        const list = c.automod.attachmentOnlyChannels;
        if (action === 'add') {
          if (!list.includes(channel.id)) list.push(channel.id);
        } else {
          const idx = list.indexOf(channel.id);
          if (idx >= 0) list.splice(idx, 1);
        }
      });
      await interaction.reply({ content: `✅ Channel ${channel} ${action === 'add' ? 'added to' : 'removed from'} attachment-only channels.`, ephemeral: true });
      break;
    }
  }
}

function formatAutomod(auto: any): string {
  return [
    `**Block URLs:** ${auto.blockUrls ? '✅' : '❌'}`,
    `**Block GIFs:** ${auto.blockGifs ? '✅' : '❌'}`,
    `**Block CAPS:** ${auto.blockCaps ? '✅' : '❌'}`,
    `**CAPS min length:** ${auto.capsMinLength}`,
    `**CAPS max %:** ${auto.capsMaxPercent}%`,
    `**GIF whitelist roles:** ${auto.gifWhitelistRoles?.length ? auto.gifWhitelistRoles.map((id: string) => `<@&${id}>`).join(', ') : '(none)'}`,
    `**Ignored channels:** ${auto.ignoredChannels?.length ? auto.ignoredChannels.map((id: string) => `<#${id}>`).join(', ') : '(none)'}`,
    `**Bypass roles:** ${auto.bypassRoles?.length ? auto.bypassRoles.map((id: string) => `<@&${id}>`).join(', ') : '(none)'}`,
    `**Attachment-only channels:** ${auto.attachmentOnlyChannels?.length ? auto.attachmentOnlyChannels.map((id: string) => `<#${id}>`).join(', ') : '(none)'}`,
  ].join('\n');
}

function xpRange(min: number, max: number): string {
  return min === max ? `${min}` : `${min}-${max} (random)`;
}

async function handleAutoReactConfig(interaction: ChatInputCommandInteraction, subcommand: string): Promise<void> {
  const cfg = getConfig();

  switch (subcommand) {
    case 'add': {
      const channel = interaction.options.getChannel('channel', true);
      const emojisStr = interaction.options.getString('emojis', true);
      const emojis = emojisStr.split(',').map((e) => e.trim()).filter((e) => e.length > 0);

      if (emojis.length === 0) {
        await interaction.reply({ content: '❌ Please provide at least one emoji.', ephemeral: true });
        return;
      }

      updateConfig((c) => {
        // Remove existing entry for this channel if any
        c.autoReactions = c.autoReactions.filter((ar) => ar.channelId !== channel.id);
        // Add new entry
        c.autoReactions.push({ channelId: channel.id, emojis });
      });

      await interaction.reply({ content: `✅ Added auto-reactions to ${channel} with emojis: ${emojis.join(' ')}`, ephemeral: true });
      break;
    }
    case 'remove': {
      const channel = interaction.options.getChannel('channel', true);
      updateConfig((c) => {
        c.autoReactions = c.autoReactions.filter((ar) => ar.channelId !== channel.id);
      });
      await interaction.reply({ content: `✅ Removed auto-reactions from ${channel}.`, ephemeral: true });
      break;
    }
    case 'edit': {
      const channel = interaction.options.getChannel('channel', true);
      const emojisStr = interaction.options.getString('emojis', true);
      const emojis = emojisStr.split(',').map((e) => e.trim()).filter((e) => e.length > 0);

      if (emojis.length === 0) {
        await interaction.reply({ content: '❌ Please provide at least one emoji.', ephemeral: true });
        return;
      }

      const existing = cfg.autoReactions.find((ar) => ar.channelId === channel.id);
      if (!existing) {
        await interaction.reply({ content: `❌ No auto-reactions configured for ${channel}. Use \`/config autoreact add\` instead.`, ephemeral: true });
        return;
      }

      updateConfig((c) => {
        const idx = c.autoReactions.findIndex((ar) => ar.channelId === channel.id);
        if (idx >= 0) {
          c.autoReactions[idx].emojis = emojis;
        }
      });

      await interaction.reply({ content: `✅ Updated auto-reactions for ${channel} with emojis: ${emojis.join(' ')}`, ephemeral: true });
      break;
    }
    case 'list': {
      const autoReactions = cfg.autoReactions;
      if (!autoReactions.length) {
        await interaction.reply({ content: 'No auto-reaction channels configured.', ephemeral: true });
        return;
      }

      const lines = autoReactions.map((ar) => `<#${ar.channelId}>: ${ar.emojis.join(' ')}`);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🤖 Auto-Reaction Channels')
        .setDescription(lines.join('\n'))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      break;
    }
  }
}

async function handleWelcomeConfig(interaction: ChatInputCommandInteraction, subcommand: string): Promise<void> {
  const cfg = getConfig();

  switch (subcommand) {
    case 'setup': {
      const channel = interaction.options.getChannel('channel', true);
      const message = interaction.options.getString('message') || 'Welcome {user} to {server}! 🎉';
      const enabled = interaction.options.getBoolean('enabled') ?? true;

      updateConfig((c) => {
        c.welcome.channelId = channel.id;
        c.welcome.message = message;
        c.welcome.enabled = enabled;
      });

      await interaction.reply({
        content: `✅ Welcome messages configured!\n` +
          `Channel: ${channel}\n` +
          `Message: \`${message}\`\n` +
          `Status: ${enabled ? 'Enabled' : 'Disabled'}`,
        ephemeral: true,
      });
      break;
    }
    case 'background': {
      const attachment = interaction.options.getAttachment('image', true);
      if (!attachment.contentType?.startsWith('image/')) {
        await interaction.reply({ content: '❌ Please provide a valid image file.', ephemeral: true });
        return;
      }

      // Save the image to assets/bg.jpg
      const fs = await import('fs');
      const path = await import('path');
      const { pipeline } = await import('node:stream/promises');
      const { Readable } = await import('node:stream');

      const assetsDir = path.join(process.cwd(), 'assets');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }
      const destPath = path.join(assetsDir, 'bg.jpg');

      try {
        const res = await fetch(attachment.url);
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const tmp = `${destPath}.part`;
        await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
        fs.renameSync(tmp, destPath);
        updateConfig((c) => {
          c.welcome.backgroundImage = 'assets/bg.jpg';
        });
        await interaction.reply({ content: `✅ Welcome background image updated! Saved to \`assets/bg.jpg\``, ephemeral: true });
      } catch (error) {
        console.error('[Welcome] Failed to download background image:', error);
        await interaction.reply({ content: '❌ Failed to download and save the image.', ephemeral: true });
      }
      break;
    }
    case 'test': {
      if (!cfg.welcome.enabled || !cfg.welcome.channelId) {
        await interaction.reply({ content: '❌ Welcome messages are not configured. Use `/config welcome setup` first.', ephemeral: true });
        return;
      }

      const channel = interaction.guild?.channels.cache.get(cfg.welcome.channelId);
      if (!channel || !channel.isTextBased()) {
        await interaction.reply({ content: '❌ Configured welcome channel not found.', ephemeral: true });
        return;
      }

      // Import welcome card and db
      const { welcomeCard } = await import('../utils/welcomecard');
      const { incrementTotalMembers } = await import('../db');

      const totalMemberCount = incrementTotalMembers();
      const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 512 });

      const cardBuffer = await welcomeCard.generate({
        avatarUrl,
        username: interaction.user.username,
        guildName: interaction.guild!.name,
        memberCount: totalMemberCount,
        welcomeMessage: cfg.welcome.message,
      });

      const { AttachmentBuilder } = await import('discord.js');
      const messageContent = cfg.welcome.message
        .replace(/{user}/g, `<@${interaction.user.id}>`)
        .replace(/{username}/g, interaction.user.username)
        .replace(/{server}/g, interaction.guild!.name)
        .replace(/{memberCount}/g, totalMemberCount.toString());

      const attachment = new AttachmentBuilder(cardBuffer, { name: 'welcome.png' });

      await (channel as any).send({
        content: `**Test Welcome:**\n${messageContent}`,
        files: [attachment],
      });

      await interaction.reply({ content: '✅ Test welcome card sent!', ephemeral: true });
      break;
    }
    case 'disable': {
      updateConfig((c) => {
        c.welcome.enabled = false;
      });
      await interaction.reply({ content: '✅ Welcome messages disabled.', ephemeral: true });
      break;
    }
  }
}

async function handleGoodbyeConfig(interaction: ChatInputCommandInteraction, subcommand: string): Promise<void> {
  const cfg = getConfig();

  switch (subcommand) {
    case 'setup': {
      const channel = interaction.options.getChannel('channel', true);
      const message = interaction.options.getString('message') || 'Goodbye {username}, we\'ll miss you! 👋';
      const enabled = interaction.options.getBoolean('enabled') ?? true;

      updateConfig((c) => {
        c.goodbye.channelId = channel.id;
        c.goodbye.message = message;
        c.goodbye.enabled = enabled;
      });

      await interaction.reply({
        content: `✅ Goodbye messages configured!\n` +
          `Channel: ${channel}\n` +
          `Message: \`${message}\`\n` +
          `Status: ${enabled ? 'Enabled' : 'Disabled'}`,
        ephemeral: true,
      });
      break;
    }
    case 'test': {
      if (!cfg.goodbye.enabled || !cfg.goodbye.channelId) {
        await interaction.reply({ content: '❌ Goodbye messages are not configured. Use `/config goodbye setup` first.', ephemeral: true });
        return;
      }

      const channel = interaction.guild?.channels.cache.get(cfg.goodbye.channelId);
      if (!channel || !channel.isTextBased()) {
        await interaction.reply({ content: '❌ Configured goodbye channel not found.', ephemeral: true });
        return;
      }

      const { getTotalMemberCount } = await import('../db');
      const totalMemberCount = getTotalMemberCount();

      const messageContent = cfg.goodbye.message
        .replace(/{user}/g, `<@${interaction.user.id}>`)
        .replace(/{username}/g, interaction.user.username)
        .replace(/{server}/g, interaction.guild!.name)
        .replace(/{memberCount}/g, totalMemberCount.toString());

      await (channel as any).send({
        content: `**Test Goodbye:**\n${messageContent}`,
      });

      await interaction.reply({ content: '✅ Test goodbye message sent!', ephemeral: true });
      break;
    }
    case 'disable': {
      updateConfig((c) => {
        c.goodbye.enabled = false;
      });
      await interaction.reply({ content: '✅ Goodbye messages disabled.', ephemeral: true });
      break;
    }
  }
}
