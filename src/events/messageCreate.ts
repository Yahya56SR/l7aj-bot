import { Message } from 'discord.js';
import { addXp, getUser, getTicketByChannel, updateTicketActivity } from '../db';
import { getConfig } from '../config';
import { randomXp } from '../utils/level';
import { handleLevelUp } from '../handlers/levelUp';
import { runAutomod } from '../utils/automod';
import { handleAutoReplies } from '../utils/autoReply';
import { handleL7ajMessage } from '../utils/l7aj';

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

  // The L7aj persona listens to its configured channels and decides on its own
  // whether to join the conversation. Fire-and-forget: a slow model must never
  // delay ticket activity, auto-replies, or XP. It also records bot messages
  // as context, so it is called before the world is filtered for XP.
  try {
    handleL7ajMessage(message);
  } catch (err) {
    console.error('L7aj handler failed:', err);
  }

  // Keep ticket auto-close timers accurate (every message counts as activity,
  // including staff replies).
  try {
    const ticket = getTicketByChannel(message.channelId);
    if (ticket && (ticket.status === 'open' || ticket.status === 'claimed')) {
      updateTicketActivity(ticket.id);
    }
  } catch (err) {
    console.error('Failed to update ticket activity:', err);
  }

  // Auto-reactions are independent of XP eligibility: they must fire even in
  // no-XP channels and while the author is on the XP cooldown.
  if (!message.author.bot) {
    try {
      await handleAutoReactions(message, cfg);
    } catch (err) {
      console.error('Auto-reaction failed:', err);
    }

    // Auto-replies are also independent of XP. The handler ignores bots itself,
    // and replies to at most one rule per message.
    try {
      await handleAutoReplies(message);
    } catch (err) {
      console.error('Auto-reply failed:', err);
    }
  }

  const xpCfg = cfg.xp;

  // Optionally ignore bots for text-channel XP
  if (xpCfg.ignoreBots && message.author.bot) return;

  // MEE6 `!nocxp` — excluded channels never give XP
  if (xpCfg.noXpChannels?.includes(message.channelId)) return;

  // MEE6 `!xpchannel` — when set, only that channel gives XP
  if (xpCfg.xpChannel && message.channelId !== xpCfg.xpChannel) return;

  const userId = message.author.id;
  const now = Date.now();
  const cooldownMs = Math.max(0, xpCfg.cooldownSeconds) * 1000;

  // The in-memory map is the fast path. The persisted `last_msg_ts` keeps the
  // cooldown alive across restarts instead of handing out a free extra grant.
  const storedExpiry = (getUser(userId)?.last_msg_ts ?? 0) + cooldownMs;
  const expiry = Math.max(userCooldowns.get(userId) ?? 0, storedExpiry);

  if (expiry > now) {
    return; // Still on cooldown
  }

  const amount = randomXp(xpCfg.perMessageMin, xpCfg.perMessageMax);
  if (amount <= 0) return;

  try {
    const { leveledUp, newLevel, oldLevel } = addXp(userId, amount, 'message');

    // Start the cooldown only once XP was actually awarded, so a failed write
    // does not silently cost the member their next message.
    userCooldowns.set(userId, now + cooldownMs);

    // Periodically clean up expired entries to prevent memory leak
    if (userCooldowns.size > 10000) {
      cleanupCooldowns(now);
    }

    if (leveledUp) {
      await handleLevelUp(message.guild, message.author, newLevel, oldLevel, message.channel);
    }
  } catch (err) {
    console.error('Failed to process XP for message:', err);
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
