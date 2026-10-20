import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { getConfig } from '../config';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Show the current bot configuration')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) => sub.setName('show').setDescription('Display current settings'));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

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
      { name: 'Guild ID', value: cfg.guildId || '(missing)', inline: true },
    )
    .setFooter({ text: 'Token is never displayed for security reasons.' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

function xpRange(min: number, max: number): string {
  return min === max ? `${min}` : `${min}-${max} (random)`;
}
