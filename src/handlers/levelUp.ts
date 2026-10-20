import { Guild, User, TextChannel, Channel } from 'discord.js';
import { getConfig } from '../config';
import { getUser } from '../db';
import { levelFromXp } from '../utils/level';

export async function handleLevelUp(
  guild: Guild,
  user: User,
  newLevel: number,
  oldLevel: number,
  channel?: Channel,
): Promise<void> {
  const cfg = getConfig();
  const levelRoles = cfg.levelRoles;
  const newRoleId = levelRoles[String(newLevel)];

  const rolesToAdd: string[] = [];
  const rolesToRemove: string[] = [];

  if (newRoleId) {
    rolesToAdd.push(newRoleId);
    // Remove previous tier roles so tiers stay exclusive
    for (const [level, roleId] of Object.entries(levelRoles)) {
      if (parseInt(level, 10) < newLevel) {
        rolesToRemove.push(roleId);
      }
    }
  }

  let member;
  try {
    member = await guild.members.fetch(user.id);
  } catch (err) {
    console.error(`Failed to fetch member ${user.id} in guild ${guild.id}:`, err);
    return;
  }
  if (!member) return;

  if (rolesToAdd.length > 0) {
    try {
      await member.roles.add(rolesToAdd);
    } catch (err) {
      console.error(`Failed to add level role to ${user.id}:`, err);
    }
  }
  if (rolesToRemove.length > 0) {
    try {
      await member.roles.remove(rolesToRemove);
    } catch (err) {
      console.error(`Failed to remove old level roles from ${user.id}:`, err);
    }
  }

  // Announce in the level-up channel, falling back to the channel where the XP was earned
  let targetChannel: Channel | undefined;
  if (cfg.channels.levelUp) {
    targetChannel = guild.channels.cache.get(cfg.channels.levelUp);
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
    .replace(/\{role\}/g, newRoleId ? `<@&${newRoleId}>` : '')
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
