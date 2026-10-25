import { Guild, User, TextChannel, Channel, GuildMember, Role } from 'discord.js';
import { getConfig } from '../config';
import { getUser } from '../db';
import { levelFromXp } from '../utils/level';
import { canAssignRole } from '../utils/discord';

interface ResolvedLevelRoles {
  /** Highest configured tier the member has reached (may be undefined). */
  grantRoleId?: string;
  /** Lower tiers that must be removed to keep tiers exclusive. */
  removeRoleIds: string[];
}

/**
 * Level rewards are tiers: a member holds the highest configured role whose
 * level is at or below their level, and every lower tier is removed.
 *
 * Matching the highest reached tier instead of only the exact level matters
 * because members can skip levels — a voice tick, a raised XP range, or the
 * first XP grant to a member whose stored level was stale can all jump several
 * levels at once. An exact match would then grant nothing at all.
 */
export function resolveLevelRoles(
  levelRoles: Record<string, string>,
  level: number,
): ResolvedLevelRoles {
  const tiers = Object.entries(levelRoles)
    .filter(([key, roleId]) => /^\d+$/.test(key) && typeof roleId === 'string' && roleId !== '')
    .map(([key, roleId]) => ({ level: Number.parseInt(key, 10), roleId }))
    .filter((tier) => tier.level <= level)
    .sort((a, b) => a.level - b.level);

  const best = tiers[tiers.length - 1];
  if (!best) return { removeRoleIds: [] };

  return {
    grantRoleId: best.roleId,
    // The same role can be configured for several levels; never queue the role
    // we are granting for removal (add then remove would strip it again), and
    // de-duplicate so Discord receives one id per role.
    removeRoleIds: [
      ...new Set(
        tiers.filter((tier) => tier.roleId !== best.roleId).map((tier) => tier.roleId),
      ),
    ],
  };
}

/**
 * Grant the tier role and drop the lower ones.
 *
 * Removals only happen after the new role is actually in place, so a missing
 * permission or a deleted role can never leave the member without a tier.
 */
async function applyLevelRoles(
  guild: Guild,
  member: GuildMember,
  grantRoleId: string | undefined,
  removeRoleIds: string[],
): Promise<void> {
  if (!grantRoleId) return;

  let role: Role | null = guild.roles.cache.get(grantRoleId) ?? null;
  if (!role) {
    role = await guild.roles.fetch(grantRoleId).catch(() => null);
  }
  if (!role) {
    console.warn(
      `[LevelUp] Level role ${grantRoleId} no longer exists in guild ${guild.id}; nothing granted to ${member.id}.`,
    );
    return;
  }

  const permissionError = canAssignRole(guild, role);
  if (permissionError) {
    console.warn(
      `[LevelUp] Cannot grant "${role.name}" (${role.id}) to ${member.id}: ${permissionError}`,
    );
    return;
  }

  if (!member.roles.cache.has(role.id)) {
    try {
      await member.roles.add(role.id, 'Level reward');
    } catch (err) {
      console.error(`[LevelUp] Failed to grant "${role.name}" (${role.id}) to ${member.id}:`, err);
      return;
    }
  }

  // Only pass roles the member really has. An unknown/deleted id makes Discord
  // reject the whole batch, which would silently keep every lower tier.
  const rewardRoleId = role.id;
  const rolesToRemove = removeRoleIds.filter(
    (roleId) => roleId !== rewardRoleId && member.roles.cache.has(roleId),
  );
  if (rolesToRemove.length === 0) return;

  try {
    await member.roles.remove(rolesToRemove, 'Replaced by a higher level reward');
  } catch (err) {
    console.error(`[LevelUp] Failed to remove old level roles from ${member.id}:`, err);
  }
}

/**
 * Bring a member's reward roles in line with their level: grant the tier they
 * qualify for and drop the lower ones. Safe to call outside a level-up (e.g.
 * when someone rejoins and their roles were lost).
 */
export async function syncLevelRoles(
  guild: Guild,
  member: GuildMember,
  level: number,
): Promise<void> {
  const { grantRoleId, removeRoleIds } = resolveLevelRoles(getConfig().levelRoles, level);
  await applyLevelRoles(guild, member, grantRoleId, removeRoleIds);
}

export async function handleLevelUp(
  guild: Guild,
  user: User,
  newLevel: number,
  oldLevel: number,
  channel?: Channel,
): Promise<void> {
  const cfg = getConfig();
  const { grantRoleId, removeRoleIds } = resolveLevelRoles(cfg.levelRoles, newLevel);

  let member: GuildMember | undefined;
  try {
    member = await guild.members.fetch(user.id);
  } catch (err) {
    // Role handling needs the member, but the announcement does not.
    console.error(`[LevelUp] Failed to fetch member ${user.id} in guild ${guild.id}:`, err);
  }

  if (member) {
    await applyLevelRoles(guild, member, grantRoleId, removeRoleIds);
  }

  // Announce in the level-up channel, falling back to the channel where the XP was earned
  let targetChannel: Channel | null | undefined;
  if (cfg.channels.levelUp) {
    targetChannel = guild.channels.cache.get(cfg.channels.levelUp);
    if (!targetChannel) {
      targetChannel = await guild.channels.fetch(cfg.channels.levelUp).catch(() => null);
    }
  }
  if (!targetChannel && channel) {
    targetChannel = channel;
  }

  if (!targetChannel || !('send' in targetChannel) || typeof targetChannel.send !== 'function') {
    return;
  }

  const row = getUser(user.id);
  const info = levelFromXp(row?.xp ?? 0);

  const template =
    cfg.channels.levelUpMessage ||
    '🎉 Congratulations {user}, you have reached **level {level}**!';

  const content = template
    .replace(/\{user\}/g, `<@${user.id}>`)
    .replace(/\{username\}/g, user.username)
    .replace(/\{level\}/g, String(newLevel))
    .replace(/\{server\}/g, guild.name)
    .replace(/\{role\}/g, grantRoleId ? `<@&${grantRoleId}>` : '')
    .replace(/\{xp\}/g, info.xpInLevel.toLocaleString())
    .replace(/\{xpneeded\}/g, info.xpForNext.toLocaleString())
    .trim();

  try {
    await (targetChannel as TextChannel).send({
      content,
      // Only the user who levelled up gets pinged.
      allowedMentions: { users: [user.id] },
    });
  } catch (err) {
    console.error('Failed to send level-up announcement:', err);
  }
}
