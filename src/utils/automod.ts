import { Message, TextChannel, ThreadChannel, EmbedBuilder } from 'discord.js';
import { getConfig } from '../config';
import { GeminiLiveModerator, AiVerdict } from './gemini-live';

let geminiModerator: GeminiLiveModerator | null = null;

function getGeminiModerator(apiKey: string, model: string): GeminiLiveModerator {
  if (!geminiModerator) {
    geminiModerator = new GeminiLiveModerator(apiKey, model);
  }
  return geminiModerator;
}

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

/** Truncate a string to a max length, appending an ellipsis when cut. */
function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + '…';
}

/** Send the warning to the offender via DM instead of in-channel. */
async function sendDmWarning(message: Message, content: string): Promise<void> {
  try {
    await message.author.send(content);
  } catch {
    // Ignore (DMs closed, user blocked the bot, etc.)
  }
}

/** Log the automod action to the configured mod-logs channel. */
async function logToModChannel(message: Message, category: string, reason: string): Promise<void> {
  const cfg = getConfig();
  const channelId = cfg.automod.modLogsChannelId;
  if (!channelId || !message.guild) return;
  const channel = message.guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0xff9900)
    .setTitle('🚨 Automod action')
    .addFields(
      { name: 'User', value: `<@${message.author.id}> (${message.author.id})`, inline: true },
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Category', value: category, inline: true },
      { name: 'Reason', value: reason },
      { name: 'Message', value: message.content ? truncate(message.content, 1000) : '*no text*' },
    )
    .setTimestamp();

  try {
    await channel.send({ embeds: [embed] });
  } catch {
    // Ignore mod-log send errors (missing permissions, etc.)
  }
}

/**
 * Run the LLM-based moderation check on a message using Groq.
 * Returns true if the message was deleted (blocked), false otherwise.
 * Fails open: if the model is unreachable or returns invalid output, the
 * message is allowed through.
 */
async function runAiModeration(message: Message): Promise<boolean> {
  const cfg = getConfig();
  const ai = cfg.automod.aiModeration;

  console.debug('[Automod:AI] Checking message', {
    messageId: message.id,
    authorId: message.author.id,
    channelId: message.channelId,
    contentLength: message.content?.length ?? 0,
    enabled: ai.enabled,
    minLength: ai.minLength,
  });

  if (!ai.enabled) {
    console.debug('[Automod:AI] Skipped — AI moderation is disabled.');
    return false;
  }
  if (!message.content || message.content.length < ai.minLength) {
    console.debug('[Automod:AI] Skipped — message too short or empty.');
    return false;
  }

  const apiKey = process.env.GEMINI_API_KEY || ai.apiKey;
  if (!apiKey) {
    console.warn('[Automod:AI] AI moderation is enabled but no GEMINI_API_KEY is configured.');
    return false;
  }

  const moderator = getGeminiModerator(apiKey, ai.model);

  let verdict: AiVerdict | null;
  try {
    verdict = await moderator.moderate(message.content);
  } catch (err) {
    console.error('[Automod:AI] Moderation threw:', err);
    return false;
  }

  console.debug('[Automod:AI] Verdict received', {
    messageId: message.id,
    flagged: verdict?.flagged ?? null,
    category: verdict?.category ?? null,
    confidence: verdict?.confidence ?? null,
    threshold: ai.confidenceThreshold,
  });

  if (!verdict || !verdict.flagged) {
    console.debug('[Automod:AI] Not flagged — allowing message.');
    return false;
  }
  if (verdict.confidence < ai.confidenceThreshold) {
    console.debug('[Automod:AI] Confidence below threshold — allowing message.');
    return false;
  }

  // Block the message, matching the behaviour of the regex checks.
  try {
    await message.delete();
  } catch {
    // Ignore delete errors (missing permissions, already deleted, etc.)
  }
  console.debug('[Automod:AI] Message deleted — sending warning + mod-log.', {
    messageId: message.id,
    category: verdict.category,
    confidence: verdict.confidence,
  });
  await sendDmWarning(
    message,
    `❌ Your message was removed by automated moderation (**${verdict.category}**): ${verdict.reason}`,
  );
  await logToModChannel(message, verdict.category, verdict.reason);
  return true;
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
      await sendDmWarning(message, `❌ Messages in this channel must have an attachment.`);
      await logToModChannel(message, 'attachment-only', 'Message had no attachment in an attachment-only channel.');
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
    await sendDmWarning(message, `❌ URLs are not allowed in this server.`);
    await logToModChannel(message, 'urls', 'Message contained a URL.');
    return true;
  }

  // Check for GIF attachments
  if (automod.blockGifs && isGifAttachment(message)) {
    try {
      await message.delete();
    } catch {
      // Ignore delete errors
    }
    await sendDmWarning(message, `❌ GIFs are not allowed in this server.`);
    await logToModChannel(message, 'gif', 'Message contained a GIF attachment.');
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
      await sendDmWarning(message, `❌ GIF URLs are not allowed in this server.`);
      await logToModChannel(message, 'gif-url', 'Message contained a GIF URL.');
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
    await sendDmWarning(message, `❌ Please avoid excessive capitalization.`);
    await logToModChannel(message, 'caps', 'Message had excessive capitalization.');
    return true;
  }

  // LLM-based moderation (runs last so cheap regex checks short-circuit first)
  if (await runAiModeration(message)) return true;

  return false;
}