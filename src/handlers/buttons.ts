import {
  ButtonInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
} from 'discord.js';
import { getConfig, PanelButton, RolePanel } from '../config';
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
      const styleValue = Number.isInteger(entry.style) && entry.style >= 1 && entry.style <= 4
        ? entry.style
        : ButtonStyle.Secondary;
      const button = new ButtonBuilder()
        .setCustomId(`${ROLE_PREFIX}${entry.roleId}`)
        .setLabel(entry.label)
        .setStyle(styleValue);
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
    await safeReply(interaction, {
      content: 'Verification is not set up. An admin needs to run `/verify setup`.',
      ephemeral: true,
    });
    return;
  }

  const role = await guild.roles.fetch(ver.roleId).catch(() => null);
  if (!role) {
    await safeReply(interaction, {
      content: 'The verification role no longer exists. Ask an admin to fix it.',
      ephemeral: true,
    });
    return;
  }

  const error = canAssignRole(guild, role);
  if (error) {
    await safeReply(interaction, { content: error, ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;
  const hasRole = member.roles.cache.has(ver.roleId);

  if (grant && hasRole) {
    await safeReply(interaction, {
      content: `✅ You are already verified (${role.name}).`,
      ephemeral: true,
    });
    return;
  }
  if (!grant && !hasRole) {
    await safeReply(interaction, {
      content: `You do not have the ${role.name} role.`,
      ephemeral: true,
    });
    return;
  }

  try {
    if (grant) {
      await member.roles.add(ver.roleId);
      await safeReply(interaction, {
        content: `🎉 You have been verified and received the **${role.name}** role. Welcome!`,
        ephemeral: true,
      });
    } else {
      await member.roles.remove(ver.roleId);
      await safeReply(interaction, {
        content: `➖ The **${role.name}** role has been removed.`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error('Failed to toggle verification role:', err);
    await safeReply(interaction, {
      content: 'Something went wrong while updating your roles.',
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
    await safeReply(interaction, {
      content: 'That role no longer exists. Ask an admin to fix the panel.',
      ephemeral: true,
    });
    return;
  }

  const error = canAssignRole(guild, role);
  if (error) {
    await safeReply(interaction, { content: error, ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;
  const hasRole = member.roles.cache.has(roleId);

  // Find which panel this role belongs to
  const config = getConfig();
  let sourcePanel: RolePanel | null = null;
  for (const panel of config.roles.panels) {
    if (panel.buttons.some((b) => b.roleId === roleId)) {
      sourcePanel = panel;
      break;
    }
  }

  try {
    if (hasRole) {
      await member.roles.remove(roleId);
      await safeReply(interaction, {
        content: `➖ Removed the **${role.name}** role.`,
        ephemeral: true,
      });
    } else {
      // If overrideRoles is enabled for this panel, remove other roles from the same panel
      if (sourcePanel?.overrideRoles) {
        const otherRoleIds = sourcePanel.buttons
          .map((b) => b.roleId)
          .filter((id) => id !== roleId && member.roles.cache.has(id));

        if (otherRoleIds.length > 0) {
          await member.roles.remove(otherRoleIds);
        }
      }

      await member.roles.add(roleId);
      await safeReply(interaction, {
        content: `✅ You now have the **${role.name}** role.`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error('Failed to toggle role from button:', err);
    await safeReply(interaction, {
      content: 'Something went wrong while updating your roles.',
      ephemeral: true,
    });
  }
}

/**
 * Safely reply to an interaction, handling cases where it may have already been replied to.
 */
async function safeReply(
  interaction: ButtonInteraction,
  options: { content: string; ephemeral: boolean },
): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(options).catch(() => undefined);
    } else {
      await interaction.reply(options).catch(() => undefined);
    }
  } catch {
    // Ignore errors (interaction expired, missing permissions, etc.)
  }
}
