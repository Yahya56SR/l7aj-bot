import { Message } from 'discord.js';
import { addXp } from '../db';
import { getConfig } from '../config';
import { randomXp } from '../utils/level';
import { handleLevelUp } from '../handlers/levelUp';
import { runAutomod } from '../utils/automod';

// Map of userId -> expiry timestamp (Date.now() + cooldownMs)
const userCooldowns = new Map<string, number>();

/**
 * MEE6-style XP earning:
 *  - random XP per message (15-25 by default)
 *  - max one XP-earning message per minute per user
 *  - no XP in excluded channels
 *  - if an XP channel is configured, only that channel gives XP
 */
export async function handleMessageCreate(message: Message): Promise<void> {
  // Run automod checks first
  let wasDeleted = false;
  try {
    wasDeleted = await runAutomod(message);
  } catch (err) {
    console.error('Automod check failed:', err);
  }
  if (wasDeleted) return;

  if (!message.guild) return;

  const cfg = getConfig();
  const xpCfg = cfg.xp;

  // Optionally ignore bots for text-channel XP
  if (xpCfg.ignoreBots && message.author.bot) return;

  // MEE6 `!nocxp` — excluded channels never give XP
  if (xpCfg.noXpChannels?.includes(message.channelId)) return;

  // MEE6 `!xpchannel` — when set, only that channel gives XP
  if (xpCfg.xpChannel && message.channelId !== xpCfg.xpChannel) return;

  const userId = message.author.id;
  const now = Date.now();
  const expiry = userCooldowns.get(userId);

  if (expiry && expiry > now) {
    return; // Still on cooldown
  }

  // Set new cooldown expiry
  userCooldowns.set(userId, now + xpCfg.cooldownSeconds * 1000);

  // Periodically clean up expired entries to prevent memory leak
  if (userCooldowns.size > 10000) {
    cleanupCooldowns(now);
  }

  const amount = randomXp(xpCfg.perMessageMin, xpCfg.perMessageMax);
  if (amount <= 0) return;

  try {
    const { leveledUp, newLevel, oldLevel } = addXp(userId, amount, 'message');

    if (leveledUp) {
      await handleLevelUp(message.guild, message.author, newLevel, oldLevel, message.channel);
    }
  } catch (err) {
    console.error('Failed to process XP for message:', err);
  }

  // Handle auto-reactions (after XP processing so it doesn't block)
  try {
    await handleAutoReactions(message, cfg);
  } catch (err) {
    console.error('Auto-reaction failed:', err);
  }
}

/**
 * Add configured reactions to messages in specific channels.
 */
async function handleAutoReactions(message: Message, cfg: ReturnType<typeof getConfig>): Promise<void> {
  const autoReactions = cfg.autoReactions;
  if (!autoReactions?.length) return;

  const channelConfig = autoReactions.find((ar) => ar.channelId === message.channelId);
  if (!channelConfig?.emojis?.length) return;

  // React with each configured emoji
  for (const emoji of channelConfig.emojis) {
    try {
      await message.react(emoji);
      // Small delay to avoid rate limits when reacting with multiple emojis
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch (err) {
      console.error(`Failed to react with ${emoji}:`, err);
    }
  }
}

/**
 * Remove expired cooldown entries to prevent memory leaks.
 */
function cleanupCooldowns(now: number): void {
  for (const [userId, expiry] of userCooldowns.entries()) {
    if (expiry <= now) {
      userCooldowns.delete(userId);
    }
  }
}
