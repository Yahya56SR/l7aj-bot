import { Message, TextChannel, ThreadChannel } from 'discord.js';
import { getConfig } from '../config';

/** Regex to match URLs */
const URL_REGEX = /https?:\/\/[^\s]+/gi;

/** Regex to match GIF URLs (common GIF hosting domains) */
const GIF_URL_REGEX = /https?:\/\/(?:[^\s]*\.)?(?:giphy|tenor|imgur|media\.giphy|media\.tenor|i\.giphy|i\.imgur)\.(?:com|media|gif|gifv|webp)(?:\/[^\s]*)?/gi;

/** Check if a message attachment is a GIF */
function isGifAttachment(message: Message): boolean {
  for (const attachment of message.attachments.values()) {
    const contentType = attachment.contentType || '';
    const name = attachment.name?.toLowerCase() || '';
    if (contentType === 'image/gif' || name.endsWith('.gif') || name.endsWith('.gifv')) {
      return true;
    }
  }
  return false;
}

/** Check if message content contains a GIF URL */
function hasGifUrl(content: string): boolean {
  return GIF_URL_REGEX.test(content);
}

/** Check if message content contains any URL */
function hasUrl(content: string): boolean {
  return URL_REGEX.test(content);
}

/** Check if message has excessive caps */
function hasExcessiveCaps(content: string, minLength: number, maxPercent: number): boolean {
  // Remove URLs from content before checking caps
  const textWithoutUrls = content.replace(URL_REGEX, '').trim();
  if (textWithoutUrls.length < minLength) return false;

  const letters = textWithoutUrls.match(/[a-zA-Z]/g);
  if (!letters || letters.length < minLength) return false;

  const upperCount = letters.filter((c) => c === c.toUpperCase()).length;
  const percent = (upperCount / letters.length) * 100;
  return percent > maxPercent;
}

/** Check if member has any of the bypass roles */
function hasBypassRole(message: Message, bypassRoles: string[]): boolean {
  if (!message.member || !message.guild) return false;
  return message.member.roles.cache.some((role) => bypassRoles.includes(role.id));
}

/** Check if member has any of the GIF whitelist roles */
function hasGifWhitelistRole(message: Message, gifWhitelistRoles: string[]): boolean {
  if (!message.member || !message.guild) return false;
  return message.member.roles.cache.some((role) => gifWhitelistRoles.includes(role.id));
}

/** Check if message has attachments */
function hasAttachments(message: Message): boolean {
  return message.attachments.size > 0;
}

/** Send a temporary warning message */
async function sendWarning(message: Message, content: string): Promise<void> {
  if (!message.guild) return;
  const channel = message.channel;
  if (!channel.isTextBased() || channel.isDMBased()) return;
  try {
    const sent = await channel.send({ content, allowedMentions: { users: [] } });
    setTimeout(() => sent.delete().catch(() => undefined), 5000);
  } catch {
    // Ignore send errors (missing permissions, etc.)
  }
}

/**
 * Run automod checks on a message.
 * Returns true if the message was deleted (blocked), false otherwise.
 */
export async function runAutomod(message: Message): Promise<boolean> {
  if (message.author.bot) return false;
  if (!message.guild) return false;

  const cfg = getConfig();
  const automod = cfg.automod;

  // Check if channel is ignored
  if (automod.ignoredChannels?.includes(message.channelId)) return false;

  // Check if user has bypass role
  if (automod.bypassRoles?.length && hasBypassRole(message, automod.bypassRoles)) return false;

  // Check for attachment-only channels
  if (automod.attachmentOnlyChannels?.includes(message.channelId)) {
    if (!hasAttachments(message)) {
      try {
        await message.delete();
      } catch {
        // Ignore delete errors
      }
      await sendWarning(message, `❌ ${message.author}, messages in this channel must have an attachment.`);
      return true;
    }
  }

  // Check for URLs
  if (automod.blockUrls && hasUrl(message.content)) {
    try {
      await message.delete();
    } catch {
      // Ignore delete errors (missing permissions, already deleted, etc.)
    }
    await sendWarning(message, `❌ ${message.author}, URLs are not allowed in this server.`);
    return true;
  }

  // Check for GIF attachments
  if (automod.blockGifs && isGifAttachment(message)) {
    try {
      await message.delete();
    } catch {
      // Ignore delete errors
    }
    await sendWarning(message, `❌ ${message.author}, GIFs are not allowed in this server.`);
    return true;
  }

  // Check for GIF URLs (only if not whitelisted)
  if (automod.blockGifs && hasGifUrl(message.content)) {
    const isWhitelisted = automod.gifWhitelistRoles?.length && hasGifWhitelistRole(message, automod.gifWhitelistRoles);
    if (!isWhitelisted) {
      try {
        await message.delete();
      } catch {
        // Ignore delete errors
      }
      await sendWarning(message, `❌ ${message.author}, GIF URLs are not allowed in this server.`);
      return true;
    }
  }

  // Check for excessive caps
  if (automod.blockCaps && hasExcessiveCaps(message.content, automod.capsMinLength, automod.capsMaxPercent)) {
    try {
      await message.delete();
    } catch {
      // Ignore delete errors
    }
    await sendWarning(message, `❌ ${message.author}, please avoid excessive capitalization.`);
    return true;
  }

  return false;
}