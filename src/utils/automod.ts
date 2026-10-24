import { Message, TextChannel, ThreadChannel, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getConfig, type AiModerationConfig } from '../config';
import { GeminiLiveModerator, AiVerdict } from './gemini-live';

/** Permissions that identify a member of the moderation team. */
const MODERATION_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
] as const;

let geminiModerator: GeminiLiveModerator | null = null;
let geminiModeratorKey = '';

/**
 * Reuse one Live session across messages, but rebuild it when the moderation
 * settings change (model, prompt, categories, API key, ...).
 */
function getGeminiModerator(apiKey: string, ai: AiModerationConfig): GeminiLiveModerator {
  const key = [apiKey, ai.model, ai.systemPrompt, ai.categories.join(','), ai.thinkingLevel ?? ''].join('|');
  if (geminiModerator && geminiModeratorKey === key) return geminiModerator;

  geminiModerator?.close();
  geminiModerator = new GeminiLiveModerator({
    apiKey,
    model: ai.model,
    systemPrompt: ai.systemPrompt,
    categories: ai.categories,
    thinkingLevel: ai.thinkingLevel,
  });
  geminiModeratorKey = key;
  return geminiModerator;
}

/** Regex to match URLs */
const URL_REGEX = /https?:\/\/[^\s]+/gi;

/** Regex to match GIF URLs (common GIF hosting domains) */
const GIF_URL_REGEX = /https?:\/\/(?:[^\s]*\.)?(?:giphy|tenor|imgur|media\.giphy|media\.tenor|i\.giphy|i\.imgur)\.(?:com|media|gif|gifv|webp)(?:\/[^\s]*)?/gi;

/**
 * `RegExp.prototype.test` on a global regex advances `lastIndex`, so calling it
 * repeatedly on different messages would skip matches (every other message
 * would slip through automod). Always reset the cursor before and after.
 */
function regexTest(regex: RegExp, value: string): boolean {
  regex.lastIndex = 0;
  const matched = regex.test(value);
  regex.lastIndex = 0;
  return matched;
}

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
  return regexTest(GIF_URL_REGEX, content);
}

/** Check if message content contains any URL */
function hasUrl(content: string): boolean {
  return regexTest(URL_REGEX, content);
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

/** Check if the author has any of the given role ids. */
function hasAnyRole(message: Message, roleIds: string[]): boolean {
  if (!message.member || !message.guild) return false;
  return message.member.roles.cache.some((role) => roleIds.includes(role.id));
}

/** Check if member has any of the bypass roles */
function hasBypassRoleFn(message: Message, bypassRoles: string[]): boolean {
  return hasAnyRole(message, bypassRoles);
}

/**
 * Members with moderation permissions (and the server owner) are exempt from
 * every automod check, including AI moderation, so staff cannot be warned or
 * have their own messages deleted by the bot.
 */
function hasModerationPermissions(message: Message): boolean {
  const member = message.member;
  if (!member) return false;
  return MODERATION_PERMISSIONS.some((permission) => member.permissions.has(permission));
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
async function logToModChannel(
  message: Message,
  category: string,
  reason: string,
  options: { pingStaff?: boolean; confidence?: number } = {},
): Promise<void> {
  const cfg = getConfig();
  const channelId = cfg.automod.modLogsChannelId;
  if (!channelId || !message.guild) return;
  const channel = message.guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return;

  // Prefer the dedicated automod alert roles; fall back to ticket staff so a
  // server with staff roles configured gets notified out of the box.
  const alertRoleIds = cfg.automod.alertRoleIds?.length
    ? cfg.automod.alertRoleIds
    : cfg.tickets.defaultStaffRoles ?? [];

  const embed = new EmbedBuilder()
    .setColor(options.pingStaff ? 0xed4245 : 0xff9900)
    .setTitle(options.pingStaff ? '🚨 AI moderation flagged a message' : '🚨 Automod action')
    .addFields(
      { name: 'User', value: `<@${message.author.id}> (${message.author.id})`, inline: true },
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Category', value: category, inline: true },
      { name: 'Reason', value: reason },
    );

  if (typeof options.confidence === 'number') {
    embed.addFields({ name: 'AI confidence', value: `${(options.confidence * 100).toFixed(0)}%`, inline: true });
  }

  embed.addFields(
    { name: 'Message', value: message.content ? truncate(message.content, 1000) : '*no text*' },
    { name: 'Jump', value: message.url },
  );

  embed.setTimestamp();

  const mentions = alertRoleIds.map((id) => `<@&${id}>`).join(' ');
  const content = options.pingStaff
    ? `${mentions}${mentions ? ' — ' : ''}flagged message needs staff review. Delete or ban manually if needed.`
    : undefined;

  try {
    await channel.send({
      ...(content ? { content } : {}),
      embeds: [embed],
      // Only allow the configured roles to be pinged.
      allowedMentions: options.pingStaff ? { roles: alertRoleIds } : { parse: [] },
    });
  } catch {
    // Ignore mod-log send errors (missing permissions, etc.)
  }
}

/**
 * Run the LLM-based moderation check on a message using Gemini Live.
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
    content: truncate(message.content ?? '', 500),
    contentLength: message.content?.length ?? 0,
    enabled: ai.enabled,
    minLength: ai.minLength,
  });

  if (!ai.enabled) {
    console.debug('[Automod:AI] Skipped — AI moderation is disabled.');
    return false;
  }
  // Roles in aiModeration.bypassRoleIds skip the model entirely (they are still
  // subject to the regex filters, unlike automod.bypassRoles which is the
  // inverse). No delete, no DM, no staff alert for these members.
  if (ai.bypassRoleIds?.length && hasAnyRole(message, ai.bypassRoleIds)) {
    console.debug('[Automod:AI] Skipped — member has an AI moderation bypass role.', {
      messageId: message.id,
      authorId: message.author.id,
      bypassRoleIds: ai.bypassRoleIds.length,
    });
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

  const moderator = getGeminiModerator(apiKey, ai);

  let verdict: AiVerdict | null;
  try {
    verdict = await moderator.moderate(message.content);
  } catch (err) {
    console.error('[Automod:AI] Moderation threw:', err);
    return false;
  }

  console.debug('[Automod:AI] Verdict received', {
    messageId: message.id,
    content: truncate(message.content ?? '', 500),
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
  console.debug('[Automod:AI] Message deleted — warning author + alerting staff.', {
    messageId: message.id,
    category: verdict.category,
    confidence: verdict.confidence,
  });
  await sendDmWarning(
    message,
    `❌ Your message was removed by automated moderation (**${verdict.category}**): ${verdict.reason}`,
  );
  // Alert staff with the evidence so they can ban manually if needed.
  await logToModChannel(message, verdict.category, verdict.reason, {
    pingStaff: true,
    confidence: verdict.confidence,
  });
  return true;
}

/**
 * Run automod checks on a message.
 * Returns true if the message was deleted (blocked), false otherwise.
 */
export async function runAutomod(message: Message): Promise<boolean> {
  if (message.author.bot) return false;
  if (!message.guild) return false;

  // Never moderate (or DM-warn) the server owner.
  if (message.guild.ownerId === message.author.id) return false;

  // Roles with moderation permissions are fully bypassed — no regex checks,
  // no AI moderation, no DM warnings.
  if (hasModerationPermissions(message)) {
    console.debug('[Automod] Skipped — member has moderation permissions.', {
      messageId: message.id,
      authorId: message.author.id,
    });
    return false;
  }

  const cfg = getConfig();
  const automod = cfg.automod;

  // Check if channel is ignored (ignored channels skip everything, including AI mod)
  if (automod.ignoredChannels?.includes(message.channelId)) return false;

  // Check if user has bypass role — bypass roles skip regex checks (URL/GIF/caps)
  // but are still subject to AI moderation.
  const hasBypassRole = automod.bypassRoles?.length && hasBypassRoleFn(message, automod.bypassRoles);
  console.debug('[Automod] Bypass role check', {
    messageId: message.id,
    bypassRoles: automod.bypassRoles?.length ?? 0,
    hasBypassRole: Boolean(hasBypassRole),
    note: hasBypassRole ? 'skipping regex checks, AI mod still runs' : 'all checks run',
  });

  // Check for attachment-only channels (bypass roles skip this)
  if (!hasBypassRole && automod.attachmentOnlyChannels?.includes(message.channelId)) {
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

  // Check for URLs (bypass roles skip this)
  if (!hasBypassRole && automod.blockUrls && hasUrl(message.content)) {
    try {
      await message.delete();
    } catch {
      // Ignore delete errors (missing permissions, already deleted, etc.)
    }
    await sendDmWarning(message, `❌ URLs are not allowed in this server.`);
    await logToModChannel(message, 'urls', 'Message contained a URL.');
    return true;
  }

  // Check for GIF attachments (bypass roles skip this)
  if (!hasBypassRole && automod.blockGifs && isGifAttachment(message)) {
    try {
      await message.delete();
    } catch {
      // Ignore delete errors
    }
    await sendDmWarning(message, `❌ GIFs are not allowed in this server.`);
    await logToModChannel(message, 'gif', 'Message contained a GIF attachment.');
    return true;
  }

  // Check for GIF URLs (bypass roles skip this)
  if (!hasBypassRole && automod.blockGifs && hasGifUrl(message.content)) {
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

  // Check for excessive caps (bypass roles skip this)
  if (!hasBypassRole && automod.blockCaps && hasExcessiveCaps(message.content, automod.capsMinLength, automod.capsMaxPercent)) {
    try {
      await message.delete();
    } catch {
      // Ignore delete errors
    }
    await sendDmWarning(message, `❌ Please avoid excessive capitalization.`);
    await logToModChannel(message, 'caps', 'Message had excessive capitalization.');
    return true;
  }

  // LLM-based moderation (runs for everyone, including bypass roles)
  if (await runAiModeration(message)) return true;

  return false;
}