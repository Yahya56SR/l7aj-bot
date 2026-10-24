import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChatInputCommandInteraction,
  ChannelType,
} from 'discord.js';
import { getConfig, updateConfig } from '../config';
import { GeminiLiveModerator } from '../utils/gemini-live';
import { logConfigChange } from '../utils/logger';
import {
  invalidateLiveLeaderboard,
  refreshLiveLeaderboard,
  type LiveLeaderboardResult,
} from '../utils/liveLeaderboard';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Show or modify bot configuration')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) => sub.setName('show').setDescription('Display current settings'))
  .addSubcommand((sub) =>
    sub
      .setName('logs')
      .setDescription('Set the server logging channel')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel where server change logs are sent')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
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
          .setDescription('Manage roles that bypass regex automod checks (still AI-moderated)')
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
      )
      .addSubcommand((sub) =>
        sub
          .setName('ai')
          .setDescription('Configure AI-powered moderation (Gemini Live)')
          .addStringOption((opt) =>
            opt
              .setName('action')
              .setDescription('Action to perform')
              .setRequired(true)
              .addChoices(
                { name: 'Toggle', value: 'toggle' },
                { name: 'Set model', value: 'set-model' },
                { name: 'Set prompt', value: 'set-prompt' },
                { name: 'Set threshold', value: 'set-threshold' },
                { name: 'Test (dry run)', value: 'test' },
              ),
          )
          .addBooleanOption((opt) =>
            opt.setName('enabled').setDescription('Enable or disable AI moderation (for toggle)'),
          )
          .addStringOption((opt) =>
            opt
              .setName('model')
              .setDescription('Gemini Live model id (for set-model)')
          )
          .addStringOption((opt) =>
            opt.setName('prompt').setDescription('Custom system prompt (for set-prompt)')
          )
          .addNumberOption((opt) =>
            opt
              .setName('threshold')
              .setDescription('Confidence threshold 0-1 (for set-threshold)')
              .setMinValue(0)
              .setMaxValue(1),
          )
          .addStringOption((opt) =>
            opt.setName('text').setDescription('Text to classify without deleting (for test)'),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('ai-bypass')
          .setDescription('Manage roles that skip AI moderation (regex filters still apply)')
          .addStringOption((opt) =>
            opt
              .setName('action')
              .setDescription('Add or remove a role')
              .setRequired(true)
              .addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }),
          )
          .addRoleOption((opt) => opt.setName('role').setDescription('Role to add/remove from the AI bypass list').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('modlogs')
          .setDescription('Set the channel where automod actions are logged')
          .addChannelOption((opt) =>
            opt
              .setName('channel')
              .setDescription('Channel where automod actions are logged')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText),
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
          .setDescription('Set up welcome channel and messages')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel to send welcome messages').setRequired(true).addChannelTypes(ChannelType.GuildText),
          )
          .addStringOption((opt) =>
            opt
              .setName('message')
              .setDescription('Welcome message template for Discord chat. Placeholders: {user} {username} {server} {memberCount}')
              .setRequired(false),
          )
          .addStringOption((opt) =>
            opt
              .setName('image-message')
              .setDescription('Welcome message template for welcome card. Placeholders: {user} {username} {server} {memberCount}')
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
  )
  .addSubcommandGroup((group) =>
    group
      .setName('leaderboard')
      .setDescription('Configure the single self-updating leaderboard message')
      .addSubcommand((sub) =>
        sub
          .setName('setup')
          .setDescription('Post (or re-point) the persistent leaderboard message')
          .addChannelOption((opt) =>
            opt
              .setName('channel')
              .setDescription('Channel that will hold the leaderboard message')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText),
          )
          .addIntegerOption((opt) =>
            opt
              .setName('interval-minutes')
              .setDescription('How often to refresh (1-1440, default 10)')
              .setMinValue(1)
              .setMaxValue(1440),
          )
          .addIntegerOption((opt) =>
            opt
              .setName('rows')
              .setDescription('How many ranked members to show (3-25, default 25)')
              .setMinValue(3)
              .setMaxValue(25),
          )
          .addStringOption((opt) =>
            opt.setName('title').setDescription('Optional embed title (default: server name)').setMaxLength(200),
          )
          .addBooleanOption((opt) =>
            opt.setName('enabled').setDescription('Enable automatic updates (default true)'),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('refresh').setDescription('Refresh the leaderboard message right now'),
      )
      .addSubcommand((sub) =>
        sub.setName('disable').setDescription('Stop updating the leaderboard message'),
      ),
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

  // Handle live leaderboard subcommands
  if (subcommandGroup === 'leaderboard') {
    await handleLeaderboardConfig(interaction, subcommand);
    return;
  }

  // Original show command
  if (subcommandGroup === null && subcommand === 'logs') {
    const channel = interaction.options.getChannel('channel', true);
    updateConfig((c) => {
      c.channels.logs = channel.id;
    });
    await logConfigChange(
      interaction,
      `Server logging channel set to ${channel}.`,
      interaction.client as { channels: { cache: Map<string, any> } },
    ).catch((err) => console.error('[Logging] config change error:', err));
    await interaction.reply({ content: `✅ Server logging channel set to ${channel}.`, ephemeral: true });
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
          ? `✅ Enabled · Channel: <#${cfg.welcome.channelId}>\nDiscord Message: \`${cfg.welcome.message}\`\nImage Message: \`${cfg.welcome.welcomeImageMessage || '(uses Discord message)'}\`\nBackground: \`${cfg.welcome.backgroundImage}\``
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
      {
        name: 'Live leaderboard',
        value: cfg.liveLeaderboard.enabled
          ? `✅ Enabled · Channel: <#${cfg.liveLeaderboard.channelId}> · every ${cfg.liveLeaderboard.intervalMinutes} min · top ${cfg.liveLeaderboard.rows}`
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
      await logConfigChange(
        interaction,
        `Automod **${feature}** ${enabled ? 'enabled' : 'disabled'}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
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
      await logConfigChange(
        interaction,
        `Automod thresholds updated (caps min length: ${capsMinLength ?? 'unchanged'}, max %: ${capsMaxPercent ?? 'unchanged'}).`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
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
      await logConfigChange(
        interaction,
        `Automod GIF whitelist role ${action === 'add' ? 'added' : 'removed'}: ${role}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
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
      await logConfigChange(
        interaction,
        `Automod ignored channel ${action === 'add' ? 'added' : 'removed'}: ${channel}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
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
      await logConfigChange(
        interaction,
        `Automod bypass role ${action === 'add' ? 'added' : 'removed'}: ${role}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({ content: `✅ Role ${role} ${action === 'add' ? 'added to' : 'removed from'} bypass roles.`, ephemeral: true });
      break;
    }
    case 'ai-bypass': {
      const action = interaction.options.getString('action', true);
      const role = interaction.options.getRole('role', true);
      updateConfig((c) => {
        const list = c.automod.aiModeration.bypassRoleIds;
        if (action === 'add') {
          if (!list.includes(role.id)) list.push(role.id);
        } else {
          const idx = list.indexOf(role.id);
          if (idx >= 0) list.splice(idx, 1);
        }
      });
      await logConfigChange(
        interaction,
        `AI moderation bypass role ${action === 'add' ? 'added' : 'removed'}: ${role}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({
        content: `✅ Role ${role} ${action === 'add' ? 'added to' : 'removed from'} AI moderation bypass roles.`,
        ephemeral: true,
      });
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
      await logConfigChange(
        interaction,
        `Automod attachment-only channel ${action === 'add' ? 'added' : 'removed'}: ${channel}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({ content: `✅ Channel ${channel} ${action === 'add' ? 'added to' : 'removed from'} attachment-only channels.`, ephemeral: true });
      break;
    }
    case 'modlogs': {
      const channel = interaction.options.getChannel('channel', true);
      updateConfig((c) => {
        c.automod.modLogsChannelId = channel.id;
      });
      await logConfigChange(
        interaction,
        `Automod mod-logs channel set to ${channel}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({ content: `✅ Mod-logs channel set to ${channel}.`, ephemeral: true });
      break;
    }
    case 'ai': {
      await handleAutomodAiConfig(interaction);
      break;
    }
  }
}

async function handleAutomodAiConfig(interaction: ChatInputCommandInteraction): Promise<void> {
  const action = interaction.options.getString('action', true);

  switch (action) {
    case 'toggle': {
      const enabled = interaction.options.getBoolean('enabled', true);
      updateConfig((c) => {
        c.automod.aiModeration.enabled = enabled;
      });
      await logConfigChange(
        interaction,
        `AI moderation ${enabled ? 'enabled' : 'disabled'}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({ content: `✅ AI moderation ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
      break;
    }
    case 'set-model': {
      const model = interaction.options.getString('model', true);
      updateConfig((c) => {
        c.automod.aiModeration.model = model;
      });
      await logConfigChange(
        interaction,
        `AI moderation model set to \`${model}\`.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({ content: `✅ AI moderation model set to \`${model}\`.`, ephemeral: true });
      break;
    }
    case 'set-prompt': {
      const prompt = interaction.options.getString('prompt', true);
      updateConfig((c) => {
        c.automod.aiModeration.systemPrompt = prompt;
      });
      await logConfigChange(
        interaction,
        'AI moderation system prompt updated.',
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({ content: '✅ AI moderation system prompt updated.', ephemeral: true });
      break;
    }
    case 'set-threshold': {
      const threshold = interaction.options.getNumber('threshold', true);
      updateConfig((c) => {
        c.automod.aiModeration.confidenceThreshold = threshold;
      });
      await logConfigChange(
        interaction,
        `AI moderation confidence threshold set to \`${threshold}\`.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({ content: `✅ AI moderation confidence threshold set to \`${threshold}\`.`, ephemeral: true });
      break;
    }
    case 'test': {
      const text = interaction.options.getString('text');
      if (!text) {
        await interaction.reply({ content: '❌ Please provide text to test.', ephemeral: true });
        return;
      }
      const cfg = getConfig();
      const ai = cfg.automod.aiModeration;
      const apiKey = process.env.GEMINI_API_KEY || ai.apiKey;
      if (!ai.enabled) {
        await interaction.reply({ content: '❌ AI moderation is not enabled.', ephemeral: true });
        return;
      }
      if (!apiKey) {
        await interaction.reply({ content: '❌ No GEMINI_API_KEY configured.', ephemeral: true });
        return;
      }
      const moderator = new GeminiLiveModerator({
        apiKey,
        model: ai.model,
        systemPrompt: ai.systemPrompt,
        categories: ai.categories,
        thinkingLevel: ai.thinkingLevel,
      });
      // deferReply lifts Discord's ~3s interaction limit, so allow a cold
      // connect + generation instead of failing open on the first message.
      await interaction.deferReply({ ephemeral: true });
      const verdict = await moderator.moderate(text, 10_000);
      moderator.close();
      if (!verdict) {
        await interaction.editReply({ content: '⚠️ AI moderation returned no verdict (fail open — message would be allowed).' });
        return;
      }
      await interaction.editReply({
        content:
          `**AI moderation test (dry run)**\n` +
          `Flagged: ${verdict.flagged ? '✅ YES' : '❌ no'}\n` +
          `Category: ${verdict.category}\n` +
          `Confidence: ${(verdict.confidence * 100).toFixed(0)}%\n` +
          `Reason: ${verdict.reason}\n` +
          `(No message was deleted.)`,
      });
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
    `**Mod-logs channel:** ${auto.modLogsChannelId ? `<#${auto.modLogsChannelId}>` : '(none)'}`,
    `**AI moderation:** ${auto.aiModeration?.enabled ? '✅ enabled' : '❌ disabled'} · \`${auto.aiModeration?.model || 'n/a'}\``,
    `**AI bypass roles:** ${auto.aiModeration?.bypassRoleIds?.length ? auto.aiModeration.bypassRoleIds.map((id: string) => `<@&${id}>`).join(', ') : '(none)'}`,
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

      await logConfigChange(
        interaction,
        `Auto-reactions added to ${channel} with emojis: ${emojis.join(' ')}`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({ content: `✅ Added auto-reactions to ${channel} with emojis: ${emojis.join(' ')}`, ephemeral: true });
      break;
    }
    case 'remove': {
      const channel = interaction.options.getChannel('channel', true);
      updateConfig((c) => {
        c.autoReactions = c.autoReactions.filter((ar) => ar.channelId !== channel.id);
      });
      await logConfigChange(
        interaction,
        `Auto-reactions removed from ${channel}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
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

      await logConfigChange(
        interaction,
        `Auto-reactions updated for ${channel} with emojis: ${emojis.join(' ')}`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
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
      const message = interaction.options.getString('message');
      const imageMessage = interaction.options.getString('image-message');
      const enabled = interaction.options.getBoolean('enabled') ?? true;

      updateConfig((c) => {
        c.welcome.channelId = channel.id;
        if (message !== null) c.welcome.message = message;
        if (imageMessage !== null) c.welcome.welcomeImageMessage = imageMessage;
        c.welcome.enabled = enabled;
      });

      const cfgAfter = getConfig();
      await logConfigChange(
        interaction,
        `Welcome messages configured: channel ${channel}, enabled ${enabled}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({
        content: `✅ Welcome messages configured!\n` +
          `Channel: ${channel}\n` +
          `Message: \`${cfgAfter.welcome.message}\`\n` +
          `Image message: \`${cfgAfter.welcome.welcomeImageMessage}\`\n` +
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
        await logConfigChange(
          interaction,
          'Welcome background image updated.',
          interaction.client as { channels: { cache: Map<string, any> } },
        ).catch((err) => console.error('[Logging] config change error:', err));
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
      const { getTotalMemberCount } = await import('../db');

      // A test must not inflate the all-time member counter.
      const totalMemberCount = getTotalMemberCount();
      const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 512 });

      const cardBuffer = await welcomeCard.generate({
        avatarUrl,
        displayName: interaction.user.displayName,
        guildName: interaction.guild!.name,
        memberCount: totalMemberCount,
        welcomeMessage: cfg.welcome.welcomeImageMessage || cfg.welcome.message,
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
      await logConfigChange(
        interaction,
        'Welcome messages disabled.',
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
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

      await logConfigChange(
        interaction,
        `Goodbye messages configured: channel ${channel}, enabled ${enabled}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
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
      await logConfigChange(
        interaction,
        'Goodbye messages disabled.',
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({ content: '✅ Goodbye messages disabled.', ephemeral: true });
      break;
    }
  }
}

function describeLeaderboardResult(result: LiveLeaderboardResult): string {
  switch (result.status) {
    case 'created':
      return `✅ Leaderboard posted in <#${result.channelId}> (${result.entries} ranked members). It will keep updating itself.`;
    case 'updated':
      return `✅ Leaderboard refreshed in <#${result.channelId}> (${result.entries} ranked members).`;
    case 'unchanged':
      return '✅ Leaderboard is already up to date.';
    case 'empty':
      return '⚠️ No XP records yet, so there is nothing to display.';
    case 'no-channel':
      return '❌ The configured channel is missing or the bot cannot post there.';
    case 'no-guild':
      return '❌ The bot is not connected to the server yet. Try again in a moment.';
    case 'disabled':
      return '❌ The live leaderboard is disabled. Use `/config leaderboard setup` first.';
    case 'error':
      return '❌ Discord rejected the update. Check that the bot can send messages and embed links in that channel.';
    default:
      return '❌ Unknown leaderboard state.';
  }
}

async function handleLeaderboardConfig(
  interaction: ChatInputCommandInteraction,
  subcommand: string,
): Promise<void> {
  switch (subcommand) {
    case 'setup': {
      const channel = interaction.options.getChannel('channel', true);
      const intervalMinutes = interaction.options.getInteger('interval-minutes');
      const rows = interaction.options.getInteger('rows');
      const title = interaction.options.getString('title');
      const enabled = interaction.options.getBoolean('enabled') ?? true;
      const previousChannel = getConfig().liveLeaderboard.channelId;

      // Rendering the podium plus a Discord round-trip can exceed the 3s
      // interaction budget, so acknowledge before doing any work.
      await interaction.deferReply({ ephemeral: true });

      updateConfig((c) => {
        c.liveLeaderboard.channelId = channel.id;
        // A new channel means a new message; keeping the old id would make the
        // bot try to edit a message that lives elsewhere.
        if (previousChannel !== channel.id) c.liveLeaderboard.messageId = '';
        if (intervalMinutes !== null) c.liveLeaderboard.intervalMinutes = intervalMinutes;
        if (rows !== null) c.liveLeaderboard.rows = rows;
        if (title !== null) c.liveLeaderboard.title = title;
        c.liveLeaderboard.enabled = enabled;
      });
      invalidateLiveLeaderboard();

      await logConfigChange(
        interaction,
        `Live leaderboard configured: channel ${channel}, every ${getConfig().liveLeaderboard.intervalMinutes} min, top ${getConfig().liveLeaderboard.rows}.`,
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));

      if (!enabled) {
        await interaction.editReply({
          content: `✅ Leaderboard settings saved and disabled.\nChannel: ${channel}\nRefresh: every ${getConfig().liveLeaderboard.intervalMinutes} min`,
        });
        return;
      }

      const result = await refreshLiveLeaderboard(interaction.client, { force: true });
      await interaction.editReply({
        content: `${describeLeaderboardResult(result)}\nRefreshes every ${getConfig().liveLeaderboard.intervalMinutes} min.`,
      });
      break;
    }
    case 'refresh': {
      if (!getConfig().liveLeaderboard.enabled || !getConfig().liveLeaderboard.channelId) {
        await interaction.reply({
          content: '❌ The live leaderboard is not configured. Use `/config leaderboard setup` first.',
          ephemeral: true,
        });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const result = await refreshLiveLeaderboard(interaction.client, { force: true });
      await interaction.editReply({ content: describeLeaderboardResult(result) });
      break;
    }
    case 'disable': {
      updateConfig((c) => {
        c.liveLeaderboard.enabled = false;
      });
      await logConfigChange(
        interaction,
        'Live leaderboard disabled.',
        interaction.client as { channels: { cache: Map<string, any> } },
      ).catch((err) => console.error('[Logging] config change error:', err));
      await interaction.reply({
        content: '✅ Live leaderboard disabled. The existing message stays where it is.',
        ephemeral: true,
      });
      break;
    }
  }
}
