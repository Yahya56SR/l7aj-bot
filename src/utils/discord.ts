import { Guild, PermissionFlagsBits, Role } from 'discord.js';

/**
 * Returns a human-readable error if the bot cannot assign the role,
 * or null if it can.
 */
export function canAssignRole(guild: Guild, role: Role): string | null {
  const me = guild.members.me;
  if (!me) return 'I could not resolve my own member object.';
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'I need the **Manage Roles** permission to assign roles.';
  }
  if (role.managed) return 'That role is managed by an integration and cannot be assigned manually.';
  if (role.position >= me.roles.highest.position) {
    return 'That role is higher than (or equal to) my highest role, so I cannot assign it. Move my role above it.';
  }
  return null;
}

/**
 * Convert a stored emoji string into something `Message.react()` accepts.
 * Custom emoji like `<:name:123>` / `<a:name:123>` become the raw ID.
 */
export function parseEmojiForReact(input: string): string {
  const match = input.match(/^<a?:[^:]+:(\d+)>$/);
  return match ? match[1] : input;
}

/**
 * True when a reaction's emoji corresponds to a stored mapping key.
 */
export function emojiKeyMatches(
  emoji: { name: string | null; id: string | null },
  key: string,
): boolean {
  if (emoji.name === key) return true;
  if (emoji.id) {
    return key === `<:${emoji.name}:${emoji.id}>` || key === `<a:${emoji.name}:${emoji.id}>`;
  }
  return false;
}

/**
 * Resolve the role ID for a reacted emoji using the configured mappings.
 * Prefers exact custom-emoji ID matches, then falls back to the emoji name.
 */
export function roleIdForReactionEmoji(
  emoji: { name: string | null; id: string | null },
  mappings: Record<string, string>,
): string | undefined {
  const name = emoji.name;
  if (!name) return undefined;

  if (emoji.id) {
    const normal = `<:${name}:${emoji.id}>`;
    const animated = `<a:${name}:${emoji.id}>`;
    if (mappings[normal]) return mappings[normal];
    if (mappings[animated]) return mappings[animated];
  }

  return mappings[name];
}
