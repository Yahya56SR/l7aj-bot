/**
 * Keyword-triggered auto-replies.
 *
 * Rules live in `config.autoReplies` and are edited from the dashboard. The
 * first matching rule replies once per message, and bots are always ignored so
 * a reply can never cascade into another reply. Every failure is swallowed:
 * a broken regex, missing permissions or closed DMs must never affect the rest
 * of message handling.
 */
import type { GuildMember, Message } from 'discord.js';
import { getConfig, type AutoReplyRule } from '../config';

/** Cooldown key (`ruleId:userId`) -> expiry timestamp. */
const cooldowns = new Map<string, number>();

export async function handleAutoReplies(message: Message): Promise<void> {
  if (!message.guild || message.author.bot) return;

  const autoReplies = getConfig().autoReplies;
  if (!autoReplies?.enabled || !Array.isArray(autoReplies.rules) || autoReplies.rules.length === 0) return;

  const content = (message.content || '').trim();
  if (!content) return;

  // Members are only fetched when a matching rule actually needs role checks.
  let memberPromise: Promise<GuildMember | null> | null = null;
  const getMember = (): Promise<GuildMember | null> => {
    if (!memberPromise) memberPromise = resolveMember(message);
    return memberPromise;
  };

  for (const rule of autoReplies.rules) {
    if (!rule || !rule.enabled) continue;
    if (typeof rule.reply !== 'string' || !rule.reply.trim()) continue;
    if (!Array.isArray(rule.triggers) || rule.triggers.length === 0) continue;

    const channelIds = Array.isArray(rule.channelIds) ? rule.channelIds : [];
    if (channelIds.length > 0 && !channelIds.includes(message.channelId)) continue;

    const bypassRoleIds = Array.isArray(rule.bypassRoleIds) ? rule.bypassRoleIds : [];
    if (bypassRoleIds.length > 0) {
      const member = await getMember();
      if (!member) continue; // Roles unknown: stay quiet rather than bypass the exemption.
      if (member.roles.cache.some((role) => bypassRoleIds.includes(role.id))) continue;
    }

    const trigger = findTrigger(rule, content);
    if (trigger === null) continue;
    if (isOnCooldown(rule, message.author.id)) continue;

    markCooldown(rule, message.author.id);
    await sendReply(message, rule, trigger, message.member);
    return; // One reply per message: the first matching rule wins.
  }
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

function findTrigger(rule: AutoReplyRule, content: string): string | null {
  for (const trigger of rule.triggers) {
    if (typeof trigger !== 'string' || trigger === '') continue;
    if (matches(rule, content, trigger)) return trigger;
  }
  return null;
}

function matches(rule: AutoReplyRule, content: string, trigger: string): boolean {
  if (rule.matchType === 'regex') {
    try {
      return new RegExp(trigger, rule.caseSensitive ? '' : 'i').test(content);
    } catch {
      // An invalid pattern must not break message handling.
      return false;
    }
  }

  const haystack = rule.caseSensitive ? content : content.toLowerCase();
  const needle = rule.caseSensitive ? trigger : trigger.toLowerCase();

  if (rule.matchType === 'exact') return haystack === needle;
  if (rule.matchType === 'startsWith') return haystack.startsWith(needle);
  return haystack.includes(needle);
}

/* ------------------------------------------------------------------ */
/* Replying                                                            */
/* ------------------------------------------------------------------ */

async function sendReply(
  message: Message,
  rule: AutoReplyRule,
  trigger: string,
  member: GuildMember | null,
): Promise<void> {
  const author = message.author;
  const content = renderTemplate(rule.reply, {
    user: `<@${author.id}>`,
    username: member?.displayName ?? author.displayName ?? author.username,
    server: message.guild?.name ?? 'this server',
    channel: `<#${message.channelId}>`,
    message: (message.content || '').trim().slice(0, 500),
    trigger,
  }).slice(0, 2000);

  if (!content.trim()) return;

  try {
    if (rule.respondIn === 'dm') {
      await author.send({ content });
    } else if (message.channel.isSendable()) {
      await message.channel.send({
        content,
        // Keep the reply quiet unless the rule opted into pinging its author.
        allowedMentions: rule.pingAuthor
          ? { parse: ['users'], users: [author.id] }
          : { parse: [] },
      });
    }
  } catch (err) {
    console.error('[Auto-reply] Failed to send reply:', err);
  }

  if (rule.deleteTrigger) {
    try {
      await message.delete();
    } catch (err) {
      console.error('[Auto-reply] Failed to delete the triggering message:', err);
    }
  }
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}

/* ------------------------------------------------------------------ */
/* Cooldowns                                                           */
/* ------------------------------------------------------------------ */

function cooldownKey(rule: AutoReplyRule, userId: string): string {
  return `${rule.id}:${userId}`;
}

function isOnCooldown(rule: AutoReplyRule, userId: string): boolean {
  const seconds = Number(rule.cooldownSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  const expiry = cooldowns.get(cooldownKey(rule, userId));
  return Boolean(expiry && expiry > Date.now());
}

function markCooldown(rule: AutoReplyRule, userId: string): void {
  const seconds = Number(rule.cooldownSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return;

  const now = Date.now();
  cooldowns.set(cooldownKey(rule, userId), now + seconds * 1000);

  // Keep the map bounded on busy servers.
  if (cooldowns.size > 5000) {
    for (const [key, expiry] of cooldowns.entries()) {
      if (expiry <= now) cooldowns.delete(key);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Member resolution                                                   */
/* ------------------------------------------------------------------ */

async function resolveMember(message: Message): Promise<GuildMember | null> {
  if (message.member) return message.member;
  if (!message.guild) return null;
  return message.guild.members.fetch(message.author.id).catch(() => null);
}
