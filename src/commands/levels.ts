import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  Role,
} from 'discord.js';
import { getConfig, updateConfig } from '../config';
import { canAssignRole } from '../utils/discord';

export const data = new SlashCommandBuilder()
  .setName('levels')
  .setDescription('Configure the XP and level system')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Configure XP rates and announcement channels')
      .addChannelOption((o) =>
        o
          .setName('announce_channel')
          .setDescription('Where level-up messages are posted (default: current channel)')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addIntegerOption((o) =>
        o
          .setName('xp_per_message')
          .setDescription('Minimum XP per message (MEE6 default 15)')
          .setMinValue(0)
          .setMaxValue(10000),
      )
      .addIntegerOption((o) =>
        o
          .setName('xp_per_message_max')
          .setDescription('Maximum XP per message (MEE6 default 25)')
          .setMinValue(0)
          .setMaxValue(10000),
      )
      .addIntegerOption((o) =>
        o
          .setName('cooldown_seconds')
          .setDescription('Seconds between XP-earning messages per user (MEE6 default 60)')
          .setMinValue(0)
          .setMaxValue(3600),
      )
      .addIntegerOption((o) =>
        o
          .setName('xp_per_voice_minute')
          .setDescription('Minimum XP per voice minute (MEE6 default 5)')
          .setMinValue(0)
          .setMaxValue(10000),
      )
      .addIntegerOption((o) =>
        o
          .setName('xp_per_voice_minute_max')
          .setDescription('Maximum XP per voice minute (MEE6 default 8)')
          .setMinValue(0)
          .setMaxValue(10000),
      )
      .addChannelOption((o) =>
        o
          .setName('log_channel')
          .setDescription('Channel for bot logs (optional)')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((o) =>
        o
          .setName('announce_message')
          .setDescription(
            'Level-up text. Placeholders: {user} {username} {level} {server} {role} {xp} {xpneeded}',
          )
          .setMaxLength(2000),
      )
      .addIntegerOption((o) =>
        o
          .setName('ignore_bots')
          .setDescription('Whether bots earn XP: 1 = ignore bots (no XP), 0 = allow bots to earn XP')
          .addChoices(
            { name: 'Yes — bots earn no XP', value: 1 },
            { name: 'No — bots can earn XP', value: 0 },
          ),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('role')
      .setDescription('Manage level reward roles')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Grant a role when a user reaches a level')
          .addIntegerOption((o) =>
            o
              .setName('level')
              .setDescription('Level milestone')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(1000),
          )
          .addRoleOption((o) =>
            o.setName('role').setDescription('Role to grant').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove the role reward for a level')
          .addIntegerOption((o) =>
            o
              .setName('level')
              .setDescription('Level milestone to remove')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(1000),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('List all level reward roles'),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  if (group === 'role') {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'add':
        return roleAdd(interaction);
      case 'remove':
        return roleRemove(interaction);
      case 'list':
        return roleList(interaction);
      default:
        return;
    }
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'setup') return setup(interaction);
}

async function setup(interaction: ChatInputCommandInteraction): Promise<void> {
  const announce = interaction.options.getChannel('announce_channel');
  const xpPerMessage = interaction.options.getInteger('xp_per_message');
  const xpPerMessageMax = interaction.options.getInteger('xp_per_message_max');
  const cooldown = interaction.options.getInteger('cooldown_seconds');
  const xpPerVoice = interaction.options.getInteger('xp_per_voice_minute');
  const xpPerVoiceMax = interaction.options.getInteger('xp_per_voice_minute_max');
  const ignoreBots = interaction.options.getInteger('ignore_bots');
  const logChannel = interaction.options.getChannel('log_channel');
  const announceMessage = interaction.options.getString('announce_message');

  if (
    !announce &&
    xpPerMessage === null &&
    xpPerMessageMax === null &&
    cooldown === null &&
    xpPerVoice === null &&
    xpPerVoiceMax === null &&
    ignoreBots === null &&
    !logChannel &&
    !announceMessage
  ) {
    await interaction.reply({
      content:
        'Nothing to change. Pass at least one option, e.g. `xp_per_message: 15` or `announce_channel: #levels`.',
      ephemeral: true,
    });
    return;
  }

  const changes: string[] = [];

  updateConfig((cfg) => {
    cfg.guildId = cfg.guildId || interaction.guild!.id;

    if (announce) {
      cfg.channels.levelUp = announce.id;
      changes.push(`Level-up channel → <#${announce.id}>`);
    }
    if (xpPerMessage !== null) {
      cfg.xp.perMessageMin = xpPerMessage;
      // A lone min above the current max would leave an inverted range, which
      // `randomXp` can only resolve by ignoring the max entirely.
      if (cfg.xp.perMessageMax < cfg.xp.perMessageMin) {
        cfg.xp.perMessageMax = cfg.xp.perMessageMin;
      }
      changes.push(`XP per message → **${xpPerMessage}**`);
    }
    if (xpPerMessageMax !== null) {
      cfg.xp.perMessageMax = xpPerMessageMax;
      if (cfg.xp.perMessageMin > cfg.xp.perMessageMax) {
        cfg.xp.perMessageMin = cfg.xp.perMessageMax;
      }
      changes.push(`Max XP per message → **${xpPerMessageMax}**`);
    }
    if (cooldown !== null) {
      cfg.xp.cooldownSeconds = cooldown;
      changes.push(`Message cooldown → **${cooldown}s**`);
    }
    if (xpPerVoice !== null) {
      cfg.xp.perVoiceMinuteMin = xpPerVoice;
      if (cfg.xp.perVoiceMinuteMax < cfg.xp.perVoiceMinuteMin) {
        cfg.xp.perVoiceMinuteMax = cfg.xp.perVoiceMinuteMin;
      }
      changes.push(`Voice XP per minute → **${xpPerVoice}**`);
    }
    if (xpPerVoiceMax !== null) {
      cfg.xp.perVoiceMinuteMax = xpPerVoiceMax;
      if (cfg.xp.perVoiceMinuteMin > cfg.xp.perVoiceMinuteMax) {
        cfg.xp.perVoiceMinuteMin = cfg.xp.perVoiceMinuteMax;
      }
      changes.push(`Max voice XP per minute → **${xpPerVoiceMax}**`);
    }
    if (ignoreBots !== null) {
      cfg.xp.ignoreBots = ignoreBots === 1;
      changes.push(
        `Ignore bots for XP → ${cfg.xp.ignoreBots ? 'yes (bots earn no XP)' : 'no (bots can earn XP)'}`,
      );
    }
    if (logChannel) {
      cfg.channels.logs = logChannel.id;
      changes.push(`Log channel → <#${logChannel.id}>`);
    }
    if (announceMessage) {
      cfg.channels.levelUpMessage = announceMessage;
      changes.push('Level-up message template updated');
    }
  });

  const cfg = getConfig();

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('✅ Level system updated')
    .setDescription(changes.map((c) => `• ${c}`).join('\n'))
    .addFields(
      {
        name: 'XP per message',
        value:
          cfg.xp.perMessageMin === cfg.xp.perMessageMax
            ? `${cfg.xp.perMessageMin}`
            : `${cfg.xp.perMessageMin}-${cfg.xp.perMessageMax} (random)`,
        inline: true,
      },
      { name: 'Cooldown', value: `${cfg.xp.cooldownSeconds}s`, inline: true },
      {
        name: 'Voice XP/min',
        value:
          cfg.xp.perVoiceMinuteMin === cfg.xp.perVoiceMinuteMax
            ? `${cfg.xp.perVoiceMinuteMin}`
            : `${cfg.xp.perVoiceMinuteMin}-${cfg.xp.perVoiceMinuteMax} (random)`,
        inline: true,
      },
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function roleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const level = interaction.options.getInteger('level', true);
  const role = interaction.options.getRole('role', true) as Role;

  // @everyone has no position to compare against, so it would otherwise pass
  // the hierarchy check and fail at grant time.
  if (role.id === guild.id) {
    await interaction.reply({
      content: 'You cannot use **@everyone** as a level reward — pick a real role.',
      ephemeral: true,
    });
    return;
  }

  const permissionError = canAssignRole(guild, role);
  if (permissionError) {
    await interaction.reply({ content: permissionError, ephemeral: true });
    return;
  }

  const previous = getConfig().levelRoles[String(level)];

  updateConfig((cfg) => {
    cfg.guildId = cfg.guildId || guild.id;
    cfg.levelRoles[String(level)] = role.id;
  });

  await interaction.reply({
    content: `✅ Level **${level}** now grants <@&${role.id}>.${
      previous && previous !== role.id ? `\n(Replaced <@&${previous}>.)` : ''
    }\nExisting members receive it the next time they level up.`,
    ephemeral: true,
  });
}

async function roleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const level = interaction.options.getInteger('level', true);
  const existing = getConfig().levelRoles[String(level)];

  if (!existing) {
    await interaction.reply({
      content: `No role is configured for level ${level}.`,
      ephemeral: true,
    });
    return;
  }

  updateConfig((cfg) => {
    delete cfg.levelRoles[String(level)];
  });

  await interaction.reply({
    content: `✅ Removed the role reward for level ${level} (was <@&${existing}>).`,
    ephemeral: true,
  });
}

async function roleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const levelRoles = getConfig().levelRoles;
  const entries = Object.entries(levelRoles).sort((a, b) => Number(a[0]) - Number(b[0]));

  const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle('🏅 Level reward roles');

  if (entries.length === 0) {
    embed.setDescription('No level roles configured. Add one with `/levels role add`.');
  } else {
    embed.setDescription(entries.map(([level, roleId]) => `Level **${level}** → <@&${roleId}>`).join('\n'));
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
