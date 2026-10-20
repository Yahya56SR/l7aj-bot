import {
  ButtonInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
} from 'discord.js';
import { getConfig, PanelButton } from '../config';
import { canAssignRole } from '../utils/discord';

export const VERIFY_GRANT = 'verify:grant';
export const VERIFY_REVOKE = 'verify:revoke';
export const ROLE_PREFIX = 'role:toggle:';

export const BUTTONS_PER_ROW = 5;
export const MAX_BUTTONS = 25;

/**
 * Build the action rows for the self-assign role panel.
 */
export function buildPanelRows(buttons: PanelButton[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const entry of buttons.slice(i, i + BUTTONS_PER_ROW)) {
      const button = new ButtonBuilder()
        .setCustomId(`${ROLE_PREFIX}${entry.roleId}`)
        .setLabel(entry.label)
        .setStyle((entry.style as ButtonStyle) || ButtonStyle.Secondary);
      if (entry.emoji) button.setEmoji(entry.emoji);
      row.addComponents(button);
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Route a button click to the right handler.
 */
export async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  if (customId === VERIFY_GRANT) return handleVerification(interaction, true);
  if (customId === VERIFY_REVOKE) return handleVerification(interaction, false);
  if (customId.startsWith(ROLE_PREFIX)) return handleRoleToggle(interaction);
}

/**
 * Grant or remove the verification role.
 */
async function handleVerification(interaction: ButtonInteraction, grant: boolean): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ver = getConfig().verification;
  if (!ver.roleId) {
    await interaction.reply({
      content: 'Verification is not set up. An admin needs to run `/verify setup`.',
      ephemeral: true,
    });
    return;
  }

  const role = await guild.roles.fetch(ver.roleId).catch(() => null);
  if (!role) {
    await interaction.reply({
      content: 'The verification role no longer exists. Ask an admin to fix it.',
      ephemeral: true,
    });
    return;
  }

  const error = canAssignRole(guild, role);
  if (error) {
    await interaction.reply({ content: error, ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;
  const hasRole = member.roles.cache.has(ver.roleId);

  if (grant && hasRole) {
    await interaction.reply({
      content: `✅ You are already verified (${role.name}).`,
      ephemeral: true,
    });
    return;
  }
  if (!grant && !hasRole) {
    await interaction.reply({
      content: `You do not have the ${role.name} role.`,
      ephemeral: true,
    });
    return;
  }

  if (grant) {
    await member.roles.add(ver.roleId);
    await interaction.reply({
      content: `🎉 You have been verified and received the **${role.name}** role. Welcome!`,
      ephemeral: true,
    });
  } else {
    await member.roles.remove(ver.roleId);
    await interaction.reply({
      content: `➖ The **${role.name}** role has been removed.`,
      ephemeral: true,
    });
  }
}

/**
 * Toggle a role from the self-assign panel.
 */
async function handleRoleToggle(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const roleId = interaction.customId.slice(ROLE_PREFIX.length);
  if (!roleId) return;

  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    await interaction.reply({
      content: 'That role no longer exists. Ask an admin to fix the panel.',
      ephemeral: true,
    });
    return;
  }

  const error = canAssignRole(guild, role);
  if (error) {
    await interaction.reply({ content: error, ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;
  const hasRole = member.roles.cache.has(roleId);

  try {
    if (hasRole) {
      await member.roles.remove(roleId);
      await interaction.reply({
        content: `➖ Removed the **${role.name}** role.`,
        ephemeral: true,
      });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({
        content: `✅ You now have the **${role.name}** role.`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error('Failed to toggle role from button:', err);
    await interaction.reply({
      content: 'Something went wrong while updating your roles.',
      ephemeral: true,
    });
  }
}
