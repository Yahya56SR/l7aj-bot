/**
 * L7aj — the community persona that lives in one or more Discord channels.
 *
 * `GeminiLivePersona` owns the Live session; this module owns everything
 * Discord: batching, channel history, tool execution, rate limiting and
 * sending the reply. It is intentionally fail-silent: every error path just
 * means L7aj says nothing.
 */
import type { Channel, Client, Guild, Message } from 'discord.js';
import { Type, type FunctionDeclaration } from '@google/genai';
import { getConfig, type L7ajConfig } from '../config';
import { countRanked, getLeaderboard, getRankPosition, getUser } from '../db';
import { levelFromXp, progressPercent } from './level';
import { buildL7ajRuntimePrompt, L7AJ_DEFAULT_PROMPT } from '../prompts/l7aj';
import {
  GeminiLivePersona,
  type PersonaDecision,
  type PersonaToolCall,
  type PersonaToolExecutor,
} from './gemini-persona';
import { addMemory, countMemories, recallMemories } from './l7aj-memory';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

interface HistoryEntry {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  bot: boolean;
}

interface PendingBatch {
  messages: Message[];
  timer: ReturnType<typeof setTimeout>;
}

const MAX_HISTORY_ENTRIES = 200;
const MAX_MESSAGE_CHARS = 500;
const MAX_BATCH_MESSAGES = 12;
const MAX_REPLY_LENGTH = 2_000;
const MAX_TOOL_LIMIT = 25;
const MAX_REPLY_AGE_MS = 60_000;

const history = new Map<string, HistoryEntry[]>();
const historyIds = new Map<string, Set<string>>();
const primingChannels = new Set<string>();
const batches = new Map<string, PendingBatch>();
const replyTimestamps: number[] = [];

let persona: GeminiLivePersona | null = null;
let personaKey = '';
let lastReplyAt = 0;
let lastDecisionAt = 0;

/* ------------------------------------------------------------------ */
/* Public entry points                                                 */
/* ------------------------------------------------------------------ */

/**
 * Feed one Discord message to L7aj.
 *
 * Safe to call for every message: it returns immediately and does its work in
 * the background. The caller (messageCreate) must not await the persona.
 */
export function handleL7ajMessage(message: Message): void {
  if (!message.guild || message.system) return;

  const cfg = getConfig().l7aj;
  if (!cfg.enabled) return;
  if (!cfg.channelIds.includes(message.channelId)) return;

  // Bots are context, never triggers (this also stops the persona reacting to
  // its own replies or to auto-reply rules).
  if (message.author.bot) {
    if (!history.has(message.channelId)) schedulePrimeHistory(message.channel, cfg);
    addHistory(message);
    return;
  }

  if (!message.content.trim() && message.attachments.size === 0) return;

  // Enabling L7aj while the bot is already running skips the startup prime, so
  // the first message a channel sees pulls recent context in the background.
  // The batch window usually gives it time to land.
  if (!history.has(message.channelId)) schedulePrimeHistory(message.channel, cfg);

  addHistory(message);

  const existing = batches.get(message.channelId);
  if (existing) {
    existing.messages.push(message);
    // The window is anchored to the first message so a busy channel still gets
    // a reply promptly instead of postponing it forever.
    if (existing.messages.length >= MAX_BATCH_MESSAGES) {
      clearTimeout(existing.timer);
      batches.delete(message.channelId);
      void flushBatch(message.channelId, existing.messages);
    }
    return;
  }

  const batch: PendingBatch = {
    messages: [message],
    timer: setTimeout(() => {
      batches.delete(message.channelId);
      void flushBatch(message.channelId, batch.messages);
    }, Math.max(cfg.batchWindowMs, 250)),
  };
  batches.set(message.channelId, batch);
}

/** Close the Live session and drop pending batches (shutdown only). */
export function closeL7aj(): void {
  persona?.close();
  persona = null;
  personaKey = '';

  for (const batch of batches.values()) clearTimeout(batch.timer);
  batches.clear();
  history.clear();
  historyIds.clear();
  primingChannels.clear();
  replyTimestamps.length = 0;
  lastReplyAt = 0;
  lastDecisionAt = 0;
}

/** Whether a Live session is currently being reused. */
export function isL7ajActive(): boolean {
  return persona !== null;
}

/**
 * Pre-load recent messages for every configured channel so L7aj has context
 * after a restart even before a new message arrives.
 */
export async function primeL7ajHistory(client: Client): Promise<void> {
  const cfg = getConfig().l7aj;
  if (!cfg.enabled || cfg.channelIds.length === 0) return;

  for (const channelId of cfg.channelIds) {
    const channel = client.channels.cache.get(channelId);
    if (!channel?.isTextBased()) continue;

    const entries = await fetchHistory(channel, cfg);
    for (const entry of entries) addHistoryEntry(channelId, entry);
  }
}

export interface L7ajTestResult {
  action: 'reply' | 'silent';
  message: string;
  toolCalls: string[];
  model: string;
}

/**
 * Dashboard test: run one synthetic message through the persona without
 * touching the live history or sending anything to Discord.
 */
export async function testL7ajPersona(client: Client, text: string): Promise<L7ajTestResult> {
  const cfg = getConfig().l7aj;
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error('No Gemini API key configured (GEMINI_API_KEY or the dashboard secret).');
  }

  const guild = client.guilds.cache.get(getConfig().guildId) ?? client.guilds.cache.first();
  if (!guild) throw new Error('The bot is not connected to any server yet.');

  const channel = findTestChannel(guild, cfg);
  if (!channel) {
    throw new Error('Configure at least one L7aj channel (or any text channel the bot can read).');
  }

  // Snapshot of the channel exactly like a live flush would see it, plus the
  // synthetic message from the dashboard.
  const localHistory = await fetchHistory(channel, cfg);

  const snapshot = buildEventPayload({
    guild,
    channel,
    previous: localHistory,
    batch: [],
    synthetic: {
      authorName: 'dashboard test',
      content: text.trim(),
      timestamp: Date.now(),
    },
  });

  const testPersona = buildPersona(cfg, apiKey, buildToolDeclarations(cfg));
  const executor = createToolExecutor({
    guild,
    channel,
    trigger: null,
    history: () => localHistory,
  });

  try {
    const decision = await testPersona.ask(snapshot, executor, cfg.requestTimeoutMs);
    return {
      action: decision?.action ?? 'silent',
      message: decision?.message ?? '',
      toolCalls: decision?.toolCalls ?? [],
      model: cfg.model,
    };
  } finally {
    testPersona.close();
  }
}

/* ------------------------------------------------------------------ */
/* Batch evaluation                                                    */
/* ------------------------------------------------------------------ */

async function flushBatch(channelId: string, messages: Message[]): Promise<void> {
  const cfg = getConfig().l7aj;
  if (!cfg.enabled || !cfg.channelIds.includes(channelId)) return;

  const trigger = messages[messages.length - 1];
  if (!trigger || !trigger.guild) return;

  if (isRateLimited(cfg)) {
    console.debug('[L7aj] Rate limited — staying silent', {
      channelId,
      cooldownSeconds: cfg.replyCooldownSeconds,
      maxRepliesPerHour: cfg.maxRepliesPerHour,
    });
    return;
  }

  // A busy channel would otherwise open a Live session every few seconds even
  // when L7aj keeps deciding to stay quiet. Skipping an evaluation is safe:
  // the messages stay in history and the next decision sees them.
  if (
    cfg.decisionCooldownSeconds > 0 &&
    Date.now() - lastDecisionAt < cfg.decisionCooldownSeconds * 1_000
  ) {
    console.debug('[L7aj] Decision cooldown — staying silent', {
      channelId,
      cooldownSeconds: cfg.decisionCooldownSeconds,
    });
    return;
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.warn('[L7aj] Enabled but no Gemini API key is configured.');
    return;
  }

  const entries = history.get(channelId) ?? [];
  const batchIds = new Set(messages.map((message) => message.id));
  const previous = entries.filter((entry) => !batchIds.has(entry.id));

  const payload = buildEventPayload({
    guild: trigger.guild,
    channel: trigger.channel,
    previous,
    batch: messages,
  });

  const channel = trigger.channel;
  const typingChannel = channel as Channel & { sendTyping?: () => Promise<void> };
  if (cfg.showTyping && typeof typingChannel.sendTyping === 'function') {
    try {
      await typingChannel.sendTyping();
    } catch {
      /* typing is cosmetic */
    }
  }

  let decision: PersonaDecision | null;
  try {
    const client = createPersona(cfg, apiKey, buildToolDeclarations(cfg));
    const executor = createToolExecutor({
      guild: trigger.guild,
      channel,
      trigger,
      history: () => history.get(channelId) ?? [],
    });
    decision = await client.ask(payload, executor, cfg.requestTimeoutMs);
  } catch (err) {
    console.error('[L7aj] Failed to evaluate batch:', err);
    return;
  } finally {
    lastDecisionAt = Date.now();
  }

  console.debug('[L7aj] Decision', {
    channelId,
    action: decision?.action ?? 'none (fail silent)',
    toolCalls: decision?.toolCalls ?? [],
    messageLength: decision?.message.length ?? 0,
  });

  if (!decision || decision.action !== 'reply' || !decision.message.trim()) return;

  // Another batch may have replied while this one was thinking.
  if (isRateLimited(cfg)) {
    console.debug('[L7aj] Reply dropped — rate limited after generation', { channelId });
    return;
  }

  // A queue backlog can make an answer arrive too late to make sense.
  if (Date.now() - trigger.createdTimestamp > MAX_REPLY_AGE_MS) {
    console.debug('[L7aj] Reply dropped — trigger is stale', {
      channelId,
      ageMs: Date.now() - trigger.createdTimestamp,
    });
    return;
  }

  await sendReply(trigger, decision.message, cfg);
}

async function sendReply(trigger: Message, rawMessage: string, cfg: L7ajConfig): Promise<void> {
  const channel = trigger.channel;
  if (!trigger.guild || !channel.isTextBased() || channel.isDMBased()) return;

  const limit = Math.min(Math.max(cfg.maxMessageLength, 1), MAX_REPLY_LENGTH);
  const content = sanitizeOutgoing(rawMessage).slice(0, limit).trim();
  if (!content) return;

  const payload = {
    content,
    allowedMentions: { parse: [] as const, repliedUser: false },
  };

  let sent: Message;
  try {
    sent = cfg.useReplyReference
      ? await trigger.reply({ ...payload, failIfNotExists: false })
      : await channel.send(payload);
  } catch (err) {
    console.error('[L7aj] Failed to send reply:', err);
    return;
  }

  const now = Date.now();
  lastReplyAt = now;
  replyTimestamps.push(now);
  pruneReplyTimestamps(now);

  // Register the sent message immediately so the next batch sees it even
  // before the gateway echo arrives; the echo then dedupes on the message id.
  addHistoryEntry(trigger.channelId, {
    id: sent.id,
    authorId: sent.author.id,
    authorName: cfg.displayName,
    content,
    timestamp: sent.createdTimestamp,
    bot: true,
  });

  console.debug('[L7aj] Reply sent', { channelId: trigger.channelId, length: content.length });
}

function isRateLimited(cfg: L7ajConfig): boolean {
  const now = Date.now();
  if (cfg.replyCooldownSeconds > 0 && now - lastReplyAt < cfg.replyCooldownSeconds * 1_000) {
    return true;
  }

  pruneReplyTimestamps(now);
  return cfg.maxRepliesPerHour > 0 && replyTimestamps.length >= cfg.maxRepliesPerHour;
}

function pruneReplyTimestamps(now: number): void {
  const cutoff = now - 60 * 60 * 1_000;
  while (replyTimestamps.length > 0 && replyTimestamps[0] < cutoff) replyTimestamps.shift();
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function addHistory(message: Message): void {
  const content = describeMessage(message);
  if (!content) return;

  addHistoryEntry(message.channelId, {
    id: message.id,
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.username,
    content,
    timestamp: message.createdTimestamp,
    bot: message.author.bot,
  });
}

function addHistoryEntry(channelId: string, entry: HistoryEntry): void {
  let ids = historyIds.get(channelId);
  if (!ids) {
    ids = new Set();
    historyIds.set(channelId, ids);
  }
  if (ids.has(entry.id)) return;
  ids.add(entry.id);

  const entries = history.get(channelId) ?? [];
  entries.push(entry);
  if (entries.length > MAX_HISTORY_ENTRIES) {
    const removed = entries.splice(0, entries.length - MAX_HISTORY_ENTRIES);
    for (const old of removed) ids.delete(old.id);
  }
  history.set(channelId, entries);
}

/** Pull recent channel context in the background, at most once per channel. */
function schedulePrimeHistory(channel: Channel, cfg: L7ajConfig): void {
  if (primingChannels.has(channel.id)) return;
  primingChannels.add(channel.id);

  void fetchHistory(channel, cfg)
    .then((entries) => {
      for (const entry of entries) addHistoryEntry(channel.id, entry);
    })
    .catch(() => {
      /* Context is a nice-to-have; the live batch still works without it. */
    })
    .finally(() => primingChannels.delete(channel.id));
}

function describeMessage(message: Message): string {
  const content = (message.cleanContent || message.content || '').replace(/\s+/g, ' ').trim();
  const attachments = message.attachments.size
    ? ` [${message.attachments.size} attachment${message.attachments.size === 1 ? '' : 's'}]`
    : '';
  if (!content && !attachments) return '';
  const trimmed = content.length > MAX_MESSAGE_CHARS ? `${content.slice(0, MAX_MESSAGE_CHARS)}…` : content;
  return `${trimmed}${attachments}`.trim();
}

/* ------------------------------------------------------------------ */
/* Prompt payload                                                      */
/* ------------------------------------------------------------------ */

interface PayloadInput {
  guild: Guild;
  channel: Channel;
  previous: HistoryEntry[];
  batch: Message[];
  synthetic?: { authorName: string; content: string; timestamp: number };
}

function buildEventPayload(input: PayloadInput): string {
  const { guild, channel, previous, batch, synthetic } = input;
  const cfg = getConfig().l7aj;

  const recent = previous
    .slice(-Math.max(cfg.historySize, 1))
    .map((entry) => formatEntry(entry.authorName, entry.content, entry.timestamp, entry.bot));

  const incoming = batch
    .map((message) =>
      formatEntry(
        message.member?.displayName ?? message.author.username,
        describeMessage(message),
        message.createdTimestamp,
        message.author.bot,
      ),
    );

  if (synthetic) {
    incoming.push(formatEntry(synthetic.authorName, synthetic.content, synthetic.timestamp, false));
  }

  const latest = incoming.length ? incoming[incoming.length - 1] : '(none)';
  const named = channel as Channel & { name?: string };
  const channelName = named.name ? `#${named.name}` : 'this channel';

  return [
    `<current_time>${new Date().toISOString()} (Morocco: ${moroccoTime()})</current_time>`,
    `<server>${guild.name} — ${guild.memberCount} members</server>`,
    `<channel>${channelName}</channel>`,
    '<recent_messages>',
    recent.length ? recent.join('\n') : '(no earlier messages)',
    '</recent_messages>',
    '<new_messages>',
    incoming.length ? incoming.join('\n') : '(no new messages)',
    '</new_messages>',
    '<latest_message>',
    latest,
    '</latest_message>',
    '',
    'Decide whether L7aj should speak now. Silence is the default.',
  ].join('\n');
}

function formatEntry(author: string, content: string, timestamp: number, bot: boolean): string {
  const time = moroccoClock(timestamp);
  const safeContent = content.replace(
    /<\/?(?:recent_messages|new_messages|latest_message|current_time|server|channel)>/gi,
    ' ',
  );
  return `[${time}] ${bot ? '🤖 ' : ''}${author}: ${safeContent || '(empty)'}`;
}

/** HH:MM in the persona's timezone, so message times match `get_current_time`. */
function moroccoClock(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Africa/Casablanca',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().slice(11, 16);
  }
}

/* ------------------------------------------------------------------ */
/* Persona lifecycle                                                   */
/* ------------------------------------------------------------------ */

function resolveApiKey(): string {
  return process.env.GEMINI_API_KEY || getConfig().automod.aiModeration.apiKey || '';
}

function buildSystemPrompt(cfg: L7ajConfig): string {
  const runtime = buildL7ajRuntimePrompt({
    displayName: cfg.displayName || 'L7aj',
    toolsEnabled: cfg.toolsEnabled,
    memoryEnabled: cfg.memoryEnabled,
    minecraftEnabled: Boolean(cfg.minecraftServerAddress.trim()),
    maxMessageLength: Math.min(Math.max(cfg.maxMessageLength, 1), MAX_REPLY_LENGTH),
  });

  const character = cfg.systemPrompt.trim() || L7AJ_DEFAULT_PROMPT;
  return `${character}\n\n${runtime}`;
}

function createPersona(cfg: L7ajConfig, apiKey: string, tools: FunctionDeclaration[]): GeminiLivePersona {
  const key = [
    apiKey,
    cfg.model,
    cfg.systemPrompt,
    cfg.displayName,
    cfg.toolsEnabled,
    cfg.memoryEnabled,
    cfg.minecraftServerAddress,
    cfg.maxMessageLength,
    cfg.temperature,
    cfg.requestTimeoutMs,
  ].join('|');

  if (persona && personaKey === key) return persona;

  persona?.close();
  persona = buildPersona(cfg, apiKey, tools);
  personaKey = key;
  return persona;
}

function buildPersona(cfg: L7ajConfig, apiKey: string, tools: FunctionDeclaration[]): GeminiLivePersona {
  return new GeminiLivePersona({
    apiKey,
    model: cfg.model,
    systemPrompt: buildSystemPrompt(cfg),
    tools,
    thinkingLevel: cfg.thinkingLevel,
    temperature: cfg.temperature,
    requestTimeoutMs: cfg.requestTimeoutMs,
  });
}

/* ------------------------------------------------------------------ */
/* Tool declarations                                                   */
/* ------------------------------------------------------------------ */

function buildToolDeclarations(cfg: L7ajConfig): FunctionDeclaration[] {
  const tools: FunctionDeclaration[] = [];

  if (cfg.toolsEnabled) {
    tools.push(
      {
        name: 'get_recent_messages',
        description: 'Read more of the current channel history than the snapshot you were given.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            limit: { type: Type.INTEGER, description: `How many messages (1-${MAX_TOOL_LIMIT}).` },
          },
        },
      },
      {
        name: 'search_history',
        description: 'Search the recent channel history for a word, topic or member name.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: { type: Type.STRING, description: 'Text or member name to look for.' },
            limit: { type: Type.INTEGER, description: `How many matches (1-${MAX_TOOL_LIMIT}).` },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_member_info',
        description: 'Roles, join date, account age and nickname for one server member.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            member: { type: Type.STRING, description: 'Member id, @mention, username or display name.' },
          },
          required: ['member'],
        },
      },
      {
        name: 'get_user_stats',
        description: 'XP, level, leaderboard rank and voice minutes for one member.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            member: { type: Type.STRING, description: 'Member id, @mention, username or display name.' },
          },
          required: ['member'],
        },
      },
      {
        name: 'get_leaderboard',
        description: 'The server XP leaderboard, highest first.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            limit: { type: Type.INTEGER, description: `How many rows (1-${MAX_TOOL_LIMIT}).` },
          },
        },
      },
      {
        name: 'get_server_info',
        description: 'Server name, member count, creation date and description.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'get_voice_members',
        description: 'Members currently connected to voice channels.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'get_channel_info',
        description: 'Current channel name, topic, type and category.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'get_current_time',
        description: 'The real current date and time in Morocco and UTC.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: 'react_to_message',
        description:
          'React to the latest message with one emoji. This is not a spoken message; ' +
          'you may react and then stay silent.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            emoji: { type: Type.STRING, description: 'One Unicode emoji or a custom emoji like <:name:id>.' },
          },
          required: ['emoji'],
        },
      },
    );
  }

  if (cfg.memoryEnabled) {
    tools.push(
      {
        name: 'recall_facts',
        description: 'Read durable notes you saved earlier about this server or one member.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            about: { type: Type.STRING, description: 'Optional member id, @mention, username or name.' },
            limit: { type: Type.INTEGER, description: 'How many notes (1-50).' },
          },
        },
      },
      {
        name: 'remember_fact',
        description:
          'Save one durable fact about a member or the server so you can recall it in later conversations. ' +
          'Only save information the member shared publicly; never secrets or sensitive personal data.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            fact: { type: Type.STRING, description: 'One short, factual note.' },
            about: { type: Type.STRING, description: 'Optional member id, @mention, username or name.' },
          },
          required: ['fact'],
        },
      },
    );
  }

  if (cfg.toolsEnabled && cfg.minecraftServerAddress.trim()) {
    tools.push({
      name: 'get_minecraft_status',
      description: 'Live online status, player count and version of the configured Minecraft server.',
      parameters: { type: Type.OBJECT, properties: {} },
    });
  }

  return tools;
}

/* ------------------------------------------------------------------ */
/* Tool execution                                                      */
/* ------------------------------------------------------------------ */

interface ToolContext {
  guild: Guild;
  channel: Channel;
  trigger: Message | null;
  history: () => HistoryEntry[];
}

function createToolExecutor(context: ToolContext): PersonaToolExecutor {
  return async (call: PersonaToolCall): Promise<Record<string, unknown>> => {
    const name = call.name ?? '';
    const args = call.args ?? {};

    switch (name) {
      case 'get_recent_messages':
        return getRecentMessages(context, args.limit);
      case 'search_history':
        return searchHistory(context, args.query, args.limit);
      case 'get_member_info':
        return await getMemberInfo(context, args.member);
      case 'get_user_stats':
        return await getUserStats(context, args.member);
      case 'get_leaderboard':
        return getLeaderboardTool(context, args.limit);
      case 'get_server_info':
        return getServerInfo(context);
      case 'get_voice_members':
        return getVoiceMembers(context);
      case 'get_channel_info':
        return getChannelInfo(context);
      case 'get_current_time':
        return getCurrentTime();
      case 'react_to_message':
        return await reactToMessage(context, args.emoji);
      case 'recall_facts':
        return await recallFacts(context, args.about, args.limit);
      case 'remember_fact':
        return await rememberFact(context, args.fact, args.about);
      case 'get_minecraft_status':
        return await getMinecraftStatus();
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  };
}

function toLimit(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function getRecentMessages(context: ToolContext, rawLimit: unknown): Record<string, unknown> {
  const limit = toLimit(rawLimit, 20, MAX_TOOL_LIMIT);
  const entries = context.history()
    .slice(-limit)
    .map((entry) => ({
      time: moroccoClock(entry.timestamp),
      author: entry.authorName,
      content: entry.content,
      bot: entry.bot,
    }));
  return { ok: true, messages: entries };
}

function searchHistory(context: ToolContext, rawQuery: unknown, rawLimit: unknown): Record<string, unknown> {
  const query = typeof rawQuery === 'string' ? rawQuery.trim().toLowerCase() : '';
  if (!query) return { ok: false, error: 'A search term is required.' };

  const limit = toLimit(rawLimit, 10, MAX_TOOL_LIMIT);
  const matches = context
    .history()
    .filter(
      (entry) =>
        entry.content.toLowerCase().includes(query) ||
        entry.authorName.toLowerCase().includes(query),
    )
    .slice(-limit)
    .reverse()
    .map((entry) => ({
      time: moroccoClock(entry.timestamp),
      author: entry.authorName,
      content: entry.content,
      bot: entry.bot,
    }));

  return { ok: true, query, matches };
}

async function resolveMember(
  context: ToolContext,
  raw: unknown,
): Promise<{ id: string; displayName: string; username: string } | null> {
  if (typeof raw !== 'string') return null;
  const query = raw.replace(/^<@!?(\d+)>$/, '$1').trim();
  if (!query) return null;

  const cached = context.guild.members.cache.find(
    (member) =>
      member.id === query ||
      member.user.username.toLowerCase() === query.toLowerCase() ||
      member.displayName.toLowerCase() === query.toLowerCase(),
  );
  if (cached) {
    return {
      id: cached.id,
      displayName: cached.displayName,
      username: cached.user.username,
    };
  }

  if (/^\d{15,25}$/.test(query)) {
    const fetched = await context.guild.members.fetch(query).catch(() => null);
    if (fetched) {
      return {
        id: fetched.id,
        displayName: fetched.displayName,
        username: fetched.user.username,
      };
    }
  }

  try {
    const results = await context.guild.members.fetch({ query, limit: 1 });
    const member = results.first();
    if (member) {
      return {
        id: member.id,
        displayName: member.displayName,
        username: member.user.username,
      };
    }
  } catch {
    /* member search is best-effort */
  }

  return null;
}

async function getMemberInfo(context: ToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const resolved = await resolveMember(context, raw);
  if (!resolved) return { ok: false, error: 'Member not found.' };

  const member = context.guild.members.cache.get(resolved.id);
  if (!member) return { ok: false, error: 'Member not found.' };

  const roles = [...member.roles.cache.values()]
    .filter((role) => role.id !== context.guild.id)
    .sort((a, b) => b.position - a.position)
    .slice(0, 12)
    .map((role) => role.name);

  return {
    ok: true,
    id: member.id,
    displayName: member.displayName,
    username: member.user.username,
    bot: member.user.bot,
    joinedAt: member.joinedAt?.toISOString() ?? null,
    accountCreatedAt: member.user.createdAt.toISOString(),
    roles,
    highestRole: member.roles.highest.name,
    timedOutUntil: member.communicationDisabledUntil?.toISOString() ?? null,
  };
}

async function getUserStats(context: ToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const resolved = await resolveMember(context, raw);
  if (!resolved) return { ok: false, error: 'Member not found.' };

  const user = getUser(resolved.id);
  if (!user) {
    return {
      ok: true,
      member: resolved.displayName,
      level: 0,
      xp: 0,
      rank: 0,
      rankedMembers: countRanked(),
      voiceMinutes: 0,
      note: 'No XP recorded yet.',
    };
  }

  const info = levelFromXp(user.xp);
  return {
    ok: true,
    member: resolved.displayName,
    level: info.level,
    xp: info.totalXp,
    xpIntoLevel: info.xpInLevel,
    xpForNextLevel: info.xpForNext,
    progressPercent: progressPercent(info),
    rank: getRankPosition(resolved.id),
    rankedMembers: countRanked(),
    voiceMinutes: user.voice_minutes,
  };
}

function getLeaderboardTool(context: ToolContext, rawLimit: unknown): Record<string, unknown> {
  const limit = toLimit(rawLimit, 10, MAX_TOOL_LIMIT);
  const rows = getLeaderboard(limit).map((row, index) => {
    const member = context.guild.members.cache.get(row.user_id);
    return {
      position: index + 1,
      name: member?.displayName ?? member?.user.username ?? `user ${row.user_id}`,
      level: row.level,
      xp: row.xp,
      voiceMinutes: row.voice_minutes,
    };
  });
  return { ok: true, rows };
}

function getServerInfo(context: ToolContext): Record<string, unknown> {
  return {
    ok: true,
    name: context.guild.name,
    id: context.guild.id,
    memberCount: context.guild.memberCount,
    createdAt: context.guild.createdAt.toISOString(),
    description: context.guild.description,
    ownerId: context.guild.ownerId,
    preferredLocale: context.guild.preferredLocale,
  };
}

function getVoiceMembers(context: ToolContext): Record<string, unknown> {
  const channels: Array<{ channel: string; members: string[]; count: number }> = [];

  for (const channel of context.guild.channels.cache.values()) {
    if (!channel.isVoiceBased()) continue;
    const humans = [...channel.members.values()].filter((member) => !member.user.bot);
    if (humans.length === 0) continue;
    channels.push({
      channel: channel.name,
      members: humans.slice(0, 10).map((member) => member.displayName),
      count: humans.length,
    });
  }

  return {
    ok: true,
    channels: channels.slice(0, 15),
    totalConnected: channels.reduce((sum, entry) => sum + entry.count, 0),
  };
}

function getChannelInfo(context: ToolContext): Record<string, unknown> {
  const channel = context.channel as Channel & {
    name?: string;
    topic?: string | null;
    type?: number;
    parent?: { name?: string } | null;
  };

  return {
    ok: true,
    id: context.channel.id,
    name: channel.name ?? null,
    topic: channel.topic ?? null,
    type: channel.type ?? null,
    category: channel.parent?.name ?? null,
  };
}

function getCurrentTime(): Record<string, unknown> {
  return {
    ok: true,
    utc: new Date().toISOString(),
    morocco: moroccoTime(),
    timezone: 'Africa/Casablanca',
  };
}

function moroccoTime(): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'Africa/Casablanca',
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

async function reactToMessage(context: ToolContext, rawEmoji: unknown): Promise<Record<string, unknown>> {
  const trigger = context.trigger;
  if (!trigger) return { ok: false, error: 'No message is available to react to.' };
  if (typeof rawEmoji !== 'string') return { ok: false, error: 'An emoji is required.' };

  const emoji = rawEmoji.trim();
  if (!emoji || emoji.length > 64 || /[\r\n]/.test(emoji)) {
    return { ok: false, error: 'Invalid emoji.' };
  }

  try {
    await trigger.react(emoji);
    return { ok: true, emoji };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function recallFacts(
  context: ToolContext,
  rawAbout: unknown,
  rawLimit: unknown,
): Promise<Record<string, unknown>> {
  const limit = toLimit(rawLimit, 20, 50);
  const about = typeof rawAbout === 'string' ? rawAbout.trim() : '';

  let notes = about ? recallMemories(context.guild.id, { about, limit }) : recallMemories(context.guild.id, { limit });

  if (about && notes.length === 0) {
    const resolved = await resolveMember(context, about);
    if (resolved) notes = recallMemories(context.guild.id, { about: resolved.id, limit });
  }

  return {
    ok: true,
    notes: notes.map((note) => ({
      fact: note.fact,
      about: note.aboutName ?? null,
      createdAt: new Date(note.createdAt).toISOString(),
    })),
    totalNotes: countMemories(context.guild.id),
  };
}

async function rememberFact(
  context: ToolContext,
  rawFact: unknown,
  rawAbout: unknown,
): Promise<Record<string, unknown>> {
  if (typeof rawFact !== 'string' || !rawFact.trim()) {
    return { ok: false, error: 'A fact is required.' };
  }

  const about = typeof rawAbout === 'string' ? rawAbout.trim() : '';
  const resolved = about ? await resolveMember(context, about) : null;

  const note = addMemory(context.guild.id, {
    fact: rawFact,
    aboutUserId: resolved?.id,
    aboutName: resolved?.displayName ?? (about || undefined),
  });

  if (!note) return { ok: false, error: 'The fact was empty and was not saved.' };

  return {
    ok: true,
    id: note.id,
    fact: note.fact,
    about: note.aboutName ?? null,
    totalNotes: countMemories(context.guild.id),
  };
}

async function getMinecraftStatus(): Promise<Record<string, unknown>> {
  const address = getConfig().l7aj.minecraftServerAddress.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!address) return { ok: false, error: 'No Minecraft server is configured.' };

  try {
    const response = await fetch(`https://api.mcsrvstat.us/3/${encodeURI(address)}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { ok: false, error: `Status API returned HTTP ${response.status}.` };

    const data = (await response.json()) as {
      online?: boolean;
      hostname?: string;
      version?: string;
      players?: { online?: number; max?: number; list?: Array<{ name?: string }> };
      motd?: { clean?: string[] };
    };

    return {
      ok: true,
      address,
      online: Boolean(data.online),
      version: data.version ?? null,
      playersOnline: data.players?.online ?? null,
      playersMax: data.players?.max ?? null,
      playerNames: (data.players?.list ?? []).slice(0, 20).map((player) => player.name).filter(Boolean),
      motd: data.motd?.clean?.join(' ') ?? null,
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function fetchHistory(channel: Channel, cfg: L7ajConfig): Promise<HistoryEntry[]> {
  if (!channel.isTextBased()) return [];

  try {
    const fetched = await channel.messages.fetch({
      limit: Math.min(Math.max(cfg.historySize, 1), 50),
    });
    return [...fetched.values()]
      .reverse()
      .filter((message) => !message.system)
      .map((message) => ({
        id: message.id,
        authorId: message.author.id,
        authorName: message.member?.displayName ?? message.author.username,
        content: describeMessage(message),
        timestamp: message.createdTimestamp,
        bot: message.author.bot,
      }))
      .filter((entry) => entry.content !== '');
  } catch {
    return [];
  }
}

function findTestChannel(guild: Guild, cfg: L7ajConfig): Channel | null {
  for (const channelId of cfg.channelIds) {
    const channel = guild.channels.cache.get(channelId);
    if (channel?.isTextBased()) return channel;
  }

  const fallback = guild.channels.cache.find((channel) => channel.isTextBased());
  return fallback ?? null;
}

function sanitizeOutgoing(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/@everyone/g, '@\u200Beveryone')
    .replace(/@here/g, '@\u200Bhere')
    .trim();
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const record = err as { message?: string; reason?: string };
    return record.message || record.reason || JSON.stringify(record);
  }
  return String(err);
}
