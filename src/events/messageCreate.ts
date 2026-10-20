import { Message } from 'discord.js';
import { addXp } from '../db';
import { getConfig } from '../config';
import { randomXp } from '../utils/level';
import { handleLevelUp } from '../handlers/levelUp';

const userCooldowns = new Set<string>();

/**
 * MEE6-style XP earning:
 *  - random XP per message (15-25 by default)
 *  - max one XP-earning message per minute per user
 *  - no XP in excluded channels
 *  - if an XP channel is configured, only that channel gives XP
 */
export async function handleMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return;

  const cfg = getConfig();
  const xpCfg = cfg.xp;

  // MEE6 `!nocxp` — excluded channels never give XP
  if (xpCfg.noXpChannels?.includes(message.channelId)) return;

  // MEE6 `!xpchannel` — when set, only that channel gives XP
  if (xpCfg.xpChannel && message.channelId !== xpCfg.xpChannel) return;

  const userId = message.author.id;
  if (userCooldowns.has(userId)) return;
  userCooldowns.add(userId);
  setTimeout(
    () => {
      userCooldowns.delete(userId);
    },
    xpCfg.cooldownSeconds * 1000,
  );

  const amount = randomXp(xpCfg.perMessageMin, xpCfg.perMessageMax);
  if (amount <= 0) return;

  const { leveledUp, newLevel, oldLevel } = addXp(userId, amount, 'message');

  if (leveledUp) {
    await handleLevelUp(message.guild, message.author, newLevel, oldLevel, message.channel);
  }
}
