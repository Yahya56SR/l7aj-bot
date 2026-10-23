import fs from 'fs';
import path from 'path';

export interface PanelButton {
  roleId: string;
  label: string;
  emoji: string;
  /** discord.js ButtonStyle numeric value */
  style: number;
}

export interface RolePanel {
  /** Unique internal id (p1, p2, ...) */
  id: string;
  /** Human readable name used to pick the panel */
  name: string;
  messageId: string;
  channelId: string;
  title: string;
  description: string;
  buttons: PanelButton[];
  /** When true, clicking a button in this panel removes all other roles from this panel (for color roles) */
  overrideRoles?: boolean;
}

export interface AiModerationConfig {
  /** Whether LLM-based moderation is enabled */
  enabled: boolean;
  /** Gemini Live model id (e.g. gemini-3.8-live) */
  model: string;
  /** Gemini API key (prefer GEMINI_API_KEY env var; this is a fallback) */
  apiKey: string;
  /** Custom system prompt that fine-tunes the model for Arabizi & Darija */
  systemPrompt: string;
  /** Categories the model may flag */
  categories: string[];
  /**
   * Thinking level for `gemini-3.8-live-extended-thinking` (low/medium/high).
   * Ignored for `gemini-3.8-live`, which must not receive a thinking config.
   */
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high' | (string & {});
  /** Minimum message length before calling the model */
  minLength: number;
  /** Minimum confidence (0-1) required to block a message */
  confidenceThreshold: number;
}

export interface AutomodConfig {
  /** Block all URLs for everyone */
  blockUrls: boolean;
  /** Block GIFs (uploads and URLs) for everyone */
  blockGifs: boolean;
  /** Role IDs allowed to send GIF URLs (bypasses blockGifs for URLs) */
  gifWhitelistRoles: string[];
  /** Block messages with excessive capitalization */
  blockCaps: boolean;
  /** Minimum message length to check for caps */
  capsMinLength: number;
  /** Maximum percentage of capital letters allowed (0-100) */
  capsMaxPercent: number;
  /** Channels where automod is disabled */
  ignoredChannels: string[];
  /** Roles that bypass all automod checks */
  bypassRoles: string[];
  /** Roles pinged in mod-logs when AI moderation flags a message (empty = ticket staff roles) */
  alertRoleIds: string[];
  /** Channels where messages must have attachments */
  attachmentOnlyChannels: string[];
  /** Channel where automod actions are logged (empty = no mod logs) */
  modLogsChannelId: string;
  /** LLM-based moderation (Gemini Live) */
  aiModeration: AiModerationConfig;
}

export interface AutoReactionChannel {
  /** Channel ID to react in */
  channelId: string;
  /** List of emojis to react with (can be unicode or custom emoji IDs like <:name:id> or <a:name:id>) */
  emojis: string[];
}

/** How a trigger phrase is compared against the message content. */
export type AutoReplyMatchType = 'exact' | 'contains' | 'startsWith' | 'regex';

export interface AutoReplyRule {
  /** Stable internal id (r1, r2, ...) */
  id: string;
  /** Human readable label shown in the dashboard */
  name: string;
  /** When false the rule is skipped */
  enabled: boolean;
  /** Channels the rule listens in (empty = every channel) */
  channelIds: string[];
  /** Roles that never trigger this rule */
  bypassRoleIds: string[];
  /** How trigger phrases are matched */
  matchType: AutoReplyMatchType;
  /** Trigger phrases; any one of them fires the reply */
  triggers: string[];
  /** Reply template. Placeholders: {user} {username} {server} {channel} {message} {trigger} */
  reply: string;
  /** Reply in the originating channel or in the author's DMs */
  respondIn: 'channel' | 'dm';
  /** When true the reply may ping the author */
  pingAuthor: boolean;
  /** Delete the triggering message after replying (needs Manage Messages) */
  deleteTrigger: boolean;
  /** When true triggers match case exactly */
  caseSensitive: boolean;
  /** Seconds before the same member can trigger this rule again (0 = no cooldown) */
  cooldownSeconds: number;
}

export interface AutoRepliesConfig {
  /** Master switch for the whole auto-reply engine */
  enabled: boolean;
  /** Rules are checked in order; the first match replies once */
  rules: AutoReplyRule[];
}

export interface WelcomeConfig {
  /** Channel to send welcome messages */
  channelId: string;
  /** Custom welcome message template for Discord message. Placeholders: {user} {username} {server} {memberCount} */
  message: string;
  /** Custom welcome message template for the welcome card image. Placeholders: {user} {username} {server} {memberCount} */
  welcomeImageMessage: string;
  /** Background image path (relative to project root) */
  backgroundImage: string;
  /** Whether to send welcome card as image */
  enabled: boolean;
}

export interface GoodbyeConfig {
  /** Channel to send goodbye messages */
  channelId: string;
  /** Custom goodbye message template. Placeholders: {user} {username} {server} {memberCount} */
  message: string;
  /** Whether goodbye messages are enabled */
  enabled: boolean;
}

export interface TicketFormField {
  /** Unique identifier for this field */
  id: string;
  /** Label shown to the user */
  label: string;
  /** Placeholder text */
  placeholder?: string;
  /** Field type */
  type: 'short' | 'paragraph';
  /** Whether this field is required */
  required: boolean;
  /** Maximum length (for short fields) */
  maxLength?: number;
  /** Minimum length */
  minLength?: number;
}

export interface TicketPanel {
  /** Unique internal id */
  id: string;
  /** Human readable name */
  name: string;
  /** Channel where the panel message is posted */
  channelId: string;
  /** Message ID of the panel */
  messageId: string;
  /** Embed title */
  title: string;
  /** Embed description */
  description: string;
  /** Button label */
  buttonLabel: string;
  /** Button emoji (unicode or custom) */
  buttonEmoji?: string;
  /** Button style */
  buttonStyle: number;
  /** Category where ticket channels are created */
  categoryId: string;
  /** Role(s) that can see and manage tickets (staff roles) */
  staffRoles: string[];
  /** Role(s) that are pinged when a ticket is created */
  pingRoles: string[];
  /** Custom form fields for this panel */
  formFields: TicketFormField[];
  /** Welcome message sent in the ticket channel (placeholders: {user}, {panel}) */
  welcomeMessage: string;
  /** Whether to ping staff roles in the welcome message */
  pingOnCreate: boolean;
  /** Auto-close after this many hours of inactivity (0 = disabled) */
  autoCloseHours: number;
  /** Whether transcripts are enabled for this panel */
  transcriptsEnabled: boolean;
  /** Channel to send transcripts to (if different from logs channel) */
  transcriptChannelId?: string;
}

export interface TicketConfig {
  /** Category where all ticket channels are created */
  categoryId: string;
  /** Default staff roles (used when panel doesn't specify) */
  defaultStaffRoles: string[];
  /** Default ping roles */
  defaultPingRoles: string[];
  /** Panels */
  panels: TicketPanel[];
  /** Log channel for ticket events (open, close, claim, etc.) */
  logChannelId: string;
}

export interface LoggingCategoryConfig {
  roles: boolean;
  members: boolean;
  channels: boolean;
  messages: boolean;
  voice: boolean;
  threads: boolean;
  stage: boolean;
  emojis: boolean;
  webhooks: boolean;
  moderation: boolean;
  guild: boolean;
  commands: boolean;
  config: boolean;
}

export interface LiveLeaderboardConfig {
  /** When false the timer is skipped and the message is left untouched */
  enabled: boolean;
  /** Channel that holds the persistent leaderboard message */
  channelId: string;
  /** Message id of the persistent leaderboard (managed by the bot) */
  messageId: string;
  /** How often the message is refreshed, in minutes (1-1440) */
  intervalMinutes: number;
  /** How many ranked members appear in the embed (3-25) */
  rows: number;
  /** Optional title override; empty uses the guild name */
  title: string;
}

export interface LoggingConfig {
  /** Whether server event logging is enabled at all */
  enabled: boolean;
  /** Log channel id. Falls back to channels.logs when empty. */
  channelId: string;
  /** Per-category toggles so the log channel isn't spammed */
  categories: LoggingCategoryConfig;
}

export interface BotConfig {
  token: string;
  clientId: string;
  guildId: string;
  reactionRoles: {
    messageId: string;
    channelId: string;
    mappings: Record<string, string>;
  };
  /** Button-based self-assign role panels */
  roles: {
    panels: RolePanel[];
  };
  levelRoles: Record<string, string>;
  xp: {
    /** Minimum XP per message (MEE6 default 15) */
    perMessageMin: number;
    /** Maximum XP per message (MEE6 default 25) */
    perMessageMax: number;
    /** Seconds between XP-earning messages per user (MEE6 default 60) */
    cooldownSeconds: number;
    /** Minimum XP per voice minute (MEE6 premium default 5) */
    perVoiceMinuteMin: number;
    /** Maximum XP per voice minute (MEE6 premium default 8) */
    perVoiceMinuteMax: number;
    /** Channels where members earn no XP (MEE6 `!nocxp`) */
    noXpChannels: string[];
    /** When set, XP is only earned in this channel (MEE6 `!xpchannel`) */
    xpChannel: string;
    /** When true, bots earn no XP in text or voice channels */
    ignoreBots: boolean;
  };
  channels: {
    levelUp: string;
    logs: string;
    /** Template for level-up announcements. Placeholders: {user} {username} {level} {server} {role} */
    levelUpMessage: string;
  };
  /**
   * One persistent leaderboard message that the bot re-renders on a timer.
   * Separate from `/leaderboard`, which still renders on demand.
   */
  liveLeaderboard: LiveLeaderboardConfig;
  /** Server event logging configuration */
  logging: LoggingConfig;
  verification: {
    /** Message containing the verify button */
    messageId: string;
    /** Channel that message lives in */
    channelId: string;
    /** Role granted when the button is clicked */
    roleId: string;
    title: string;
    description: string;
    /** Also show a button to remove the role */
    showUnverify: boolean;
  };
  automod: AutomodConfig;
  /** Auto-reaction configuration: react to every message in specific channels with configured emojis */
  autoReactions: AutoReactionChannel[];
  /** Keyword-triggered automatic replies */
  autoReplies: AutoRepliesConfig;
  /** Welcome message configuration */
  welcome: WelcomeConfig;
  /** Goodbye message configuration */
  goodbye: GoodbyeConfig;
  /** Ticket system configuration */
  tickets: TicketConfig;
}

const DEFAULT_CONFIG: BotConfig = {
  token: '',
  clientId: '',
  guildId: '',
  reactionRoles: { messageId: '', channelId: '', mappings: {} },
  roles: {
    panels: [],
  },
  levelRoles: {},
  xp: {
    perMessageMin: 15,
    perMessageMax: 25,
    cooldownSeconds: 60,
    perVoiceMinuteMin: 5,
    perVoiceMinuteMax: 8,
    noXpChannels: [],
    xpChannel: '',
    ignoreBots: true,
  },
  channels: {
    levelUp: '',
    logs: '',
    levelUpMessage: '🎉 Congratulations {user}, you have reached **level {level}**!',
  },
  liveLeaderboard: {
    enabled: false,
    channelId: '',
    messageId: '',
    intervalMinutes: 10,
    rows: 25,
    title: '',
  },
  logging: {
    enabled: true,
    channelId: '',
    categories: {
      roles: true,
      members: true,
      channels: true,
      messages: true,
      voice: true,
      threads: true,
      stage: true,
      emojis: true,
      webhooks: true,
      moderation: true,
      guild: true,
      commands: true,
      config: true,
    },
  },
  verification: {
    messageId: '',
    channelId: '',
    roleId: '',
    title: '✅ Verification',
    description: 'Click the button below to verify yourself and unlock the server.',
    showUnverify: true,
  },
  automod: {
    blockUrls: true,
    blockGifs: true,
    gifWhitelistRoles: [],
    blockCaps: true,
    capsMinLength: 10,
    capsMaxPercent: 70,
    ignoredChannels: [],
    bypassRoles: [],
    alertRoleIds: [],
    attachmentOnlyChannels: [],
    modLogsChannelId: '',
    aiModeration: {
      enabled: false,
      // gemini-3.8-live is the low-latency Live model; extended-thinking needs
      // a thinkingLevel and is considerably slower for classification.
      model: 'gemini-3.8-live',
      apiKey: '',
      thinkingLevel: 'low',
      systemPrompt:
        'You are a Discord content moderator for a Moroccan community. You read messages in Arabic script, ' +
        'Arabizi (Latin-script Arabic using digits 3=ع, 7=ح, 5=خ), French, and Moroccan Darija ' +
        '(Arabic–French code-switching). Darija is a real dialect — not broken Arabic — and French code-switching is normal.\n\n' +
        'POLICY — Flag ONLY genuine violations:\n' +
        '- Direct targeted harassment/insults AT a person (e.g. "nta 7mar", "weld l97ba", "zbel", "sir t9awed" said TO someone)\n' +
        '- Credible threats of violence ("ghadi n9tlek", "n9tlek daba", "ndrbek", "n7re9 lik dar")\n' +
        '- Hate or identity-based exclusion (race, ethnicity, gender, religion, region)\n' +
        '- Calls to remove, kick, or purge an ethnic/racial group from a server or place\n' +
        '- Doxxing / doxxing threats, coordinated harassment, encouragement of self-harm\n\n' +
        'DO NOT FLAG:\n' +
        '- Positive gaming slang: "m9awed" can mean awesome/insane-good ("Nta m9awed f PvP", "Dak l-clutch m9awed")\n' +
        '- Frustration aimed at objects/lag/apps, not people ("Zbel had lag", an app crashing)\n' +
        '- Sports banter / criticism of team performance\n' +
        '- Greetings, help requests, criticism of products/government/ideas\n' +
        '- Quoted abuse in a report context, consensual banter among friends, fictional/game dialogue\n' +
        '- Single ambiguous words without a target ("7mar.", "Sir t9awed." alone)\n\n' +
        'SELF-HARM: language like "n2di rassi", "kayji f bali n2di", suicidal ideation → flag (support workflow).\n\n' +
        'Reply with JSON only: {"flagged": boolean, "category": string, "reason": string, "confidence": number 0-1}. ' +
        'category must be one of: insult, hate, harassment, threat, spam, sexual, or "none". reason in English. ' +
        'Be decisive: when confident a rule is violated set flagged=true; when benign or ambiguous-without-target, set flagged=false.',
      categories: ['insult', 'hate', 'harassment', 'threat', 'spam', 'sexual'],
      minLength: 8,
      confidenceThreshold: 0.7,
    },
  },
  autoReactions: [],
  autoReplies: {
    enabled: false,
    rules: [],
  },
  welcome: {
    channelId: '',
    message: 'Welcome {user} to {server}! 🎉',
    welcomeImageMessage: 'Welcome to {server}, {username}! 🎉',
    backgroundImage: 'assets/bg.jpg',
    enabled: false,
  },
  goodbye: {
    channelId: '',
    message: 'Goodbye {username}, we\'ll miss you! 👋',
    enabled: false,
  },
  tickets: {
    categoryId: '',
    defaultStaffRoles: [],
    defaultPingRoles: [],
    panels: [],
    logChannelId: '',
  },
};

const configPath = path.join(__dirname, '..', 'config.json');

/**
 * Normalise the roles config into a list of panels.
 * Supports the older single-panel shape so nothing is lost on upgrade.
 */
function migratePanels(raw: any): { panels: RolePanel[] } {
  if (!raw) return { panels: [] };

  if (Array.isArray(raw.panels)) {
    return {
      panels: raw.panels.map((panel: any, index: number) => ({
        id: panel.id || `p${index + 1}`,
        name: panel.name || `Panel ${index + 1}`,
        messageId: panel.messageId || '',
        channelId: panel.channelId || '',
        title: panel.title || '🎭 Self-Assign Roles',
        description: panel.description || 'Click a button to get the role.',
        buttons: Array.isArray(panel.buttons) ? panel.buttons : [],
        overrideRoles: panel.overrideRoles || false,
      })),
    };
  }

  // Legacy single-panel shape
  if (raw.messageId || raw.channelId || (raw.buttons?.length ?? 0) > 0) {
    return {
      panels: [
        {
          id: 'p1',
          name: 'Roles',
          messageId: raw.messageId || '',
          channelId: raw.channelId || '',
          title: raw.title || '🎭 Self-Assign Roles',
          description: raw.description || 'Click a button to get the role.',
          buttons: Array.isArray(raw.buttons) ? raw.buttons : [],
          overrideRoles: raw.overrideRoles || false,
        },
      ],
    };
  }

  return { panels: [] };
}

let config: BotConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

/** Marker used by the dashboard instead of real secrets in API responses. */
export const REDACTED_VALUE = '__REDACTED__';

/**
 * Merge a raw config object with the defaults and normalise every section.
 * Shared by the startup loader and the dashboard so a config saved from the
 * browser is byte-for-byte equivalent to one written by the bot itself.
 */
function normalizeConfig(parsed: any): BotConfig {
  const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const legacyPerMessage = source.xp?.perMessage;
  const legacyPerVoice = source.xp?.perVoiceMinute;

  return {
    ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    ...source,
    reactionRoles: {
      ...DEFAULT_CONFIG.reactionRoles,
      ...(source.reactionRoles || {}),
      mappings: { ...(source.reactionRoles?.mappings || {}) },
    },
    roles: migratePanels(source.roles),
    levelRoles: { ...(source.levelRoles || {}) },
    xp: {
      perMessageMin: source.xp?.perMessageMin ?? legacyPerMessage ?? DEFAULT_CONFIG.xp.perMessageMin,
      perMessageMax: source.xp?.perMessageMax ?? legacyPerMessage ?? DEFAULT_CONFIG.xp.perMessageMax,
      cooldownSeconds: source.xp?.cooldownSeconds ?? DEFAULT_CONFIG.xp.cooldownSeconds,
      perVoiceMinuteMin:
        source.xp?.perVoiceMinuteMin ?? legacyPerVoice ?? DEFAULT_CONFIG.xp.perVoiceMinuteMin,
      perVoiceMinuteMax:
        source.xp?.perVoiceMinuteMax ?? legacyPerVoice ?? DEFAULT_CONFIG.xp.perVoiceMinuteMax,
      noXpChannels: [...(source.xp?.noXpChannels || [])],
      xpChannel: source.xp?.xpChannel || '',
      ignoreBots: source.xp?.ignoreBots ?? DEFAULT_CONFIG.xp.ignoreBots,
    },
    channels: { ...DEFAULT_CONFIG.channels, ...(source.channels || {}) },
    liveLeaderboard: {
      ...DEFAULT_CONFIG.liveLeaderboard,
      ...(source.liveLeaderboard || {}),
    },
    logging: {
      ...DEFAULT_CONFIG.logging,
      ...(source.logging || {}),
      categories: {
        ...DEFAULT_CONFIG.logging.categories,
        ...(source.logging?.categories || {}),
      },
    },
    verification: { ...DEFAULT_CONFIG.verification, ...(source.verification || {}) },
    automod: {
      ...DEFAULT_CONFIG.automod,
      ...(source.automod || {}),
      aiModeration: {
        ...DEFAULT_CONFIG.automod.aiModeration,
        ...(source.automod?.aiModeration || {}),
      },
    },
    autoReactions: Array.isArray(source.autoReactions) ? source.autoReactions : [],
    autoReplies: {
      ...DEFAULT_CONFIG.autoReplies,
      ...(source.autoReplies && typeof source.autoReplies === 'object' && !Array.isArray(source.autoReplies)
        ? source.autoReplies
        : {}),
      rules: Array.isArray(source.autoReplies?.rules) ? source.autoReplies.rules : [],
    },
    welcome: { ...DEFAULT_CONFIG.welcome, ...(source.welcome || {}) },
    goodbye: { ...DEFAULT_CONFIG.goodbye, ...(source.goodbye || {}) },
    tickets: {
      ...DEFAULT_CONFIG.tickets,
      ...(source.tickets || {}),
      panels: Array.isArray(source.tickets?.panels) ? source.tickets.panels : [],
    },
  };
}

export function loadConfig(): BotConfig {
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = normalizeConfig(parsed);
    }
  } catch (err) {
    console.error('Failed to load config.json:', err);
    console.warn('Using default configuration.');
  }
  return config;
}

export function getConfig(): BotConfig {
  return config;
}

/** Absolute path of the JSON file the bot reads and writes. */
export function getConfigPath(): string {
  return configPath;
}

/* ------------------------------------------------------------------ */
/* Dashboard save sanitising                                           */
/* ------------------------------------------------------------------ */

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(asNumber(value, fallback, min, max));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return [...new Set(cleaned)];
}

/**
 * Coerce values written by the dashboard into the shapes the bot expects.
 * The UI already produces correct types; this protects the raw JSON editor
 * (and hand-edited files saved through it) from breaking the running bot.
 */
function sanitizeConfig(cfg: BotConfig): void {
  cfg.guildId = asString(cfg.guildId);
  cfg.clientId = asString(cfg.clientId);
  cfg.token = asString(cfg.token);

  cfg.xp.perMessageMin = asInt(cfg.xp.perMessageMin, 15, 0, 10_000);
  cfg.xp.perMessageMax = asInt(cfg.xp.perMessageMax, 25, cfg.xp.perMessageMin, 10_000);
  cfg.xp.cooldownSeconds = asInt(cfg.xp.cooldownSeconds, 60, 0, 86_400);
  cfg.xp.perVoiceMinuteMin = asInt(cfg.xp.perVoiceMinuteMin, 5, 0, 10_000);
  cfg.xp.perVoiceMinuteMax = asInt(cfg.xp.perVoiceMinuteMax, 8, cfg.xp.perVoiceMinuteMin, 10_000);
  cfg.xp.noXpChannels = asStringArray(cfg.xp.noXpChannels);
  cfg.xp.xpChannel = asString(cfg.xp.xpChannel);
  cfg.xp.ignoreBots = asBool(cfg.xp.ignoreBots, true);

  cfg.levelRoles = Object.fromEntries(
    Object.entries(cfg.levelRoles || {})
      .filter(([level, roleId]) => /^\d+$/.test(level) && typeof roleId === 'string' && roleId !== '')
      .map(([level, roleId]) => [String(parseInt(level, 10)), roleId]),
  );

  cfg.channels.levelUp = asString(cfg.channels.levelUp);
  cfg.channels.logs = asString(cfg.channels.logs);
  cfg.channels.levelUpMessage = asString(
    cfg.channels.levelUpMessage,
    '🎉 Congratulations {user}, you have reached **level {level}**!',
  );

  cfg.liveLeaderboard.enabled = asBool(cfg.liveLeaderboard.enabled, false);
  cfg.liveLeaderboard.channelId = asString(cfg.liveLeaderboard.channelId);
  cfg.liveLeaderboard.messageId = asString(cfg.liveLeaderboard.messageId);
  cfg.liveLeaderboard.intervalMinutes = asInt(cfg.liveLeaderboard.intervalMinutes, 10, 1, 1440);
  cfg.liveLeaderboard.rows = asInt(cfg.liveLeaderboard.rows, 25, 3, 25);
  cfg.liveLeaderboard.title = asString(cfg.liveLeaderboard.title).slice(0, 200);

  cfg.logging.enabled = asBool(cfg.logging.enabled, true);
  cfg.logging.channelId = asString(cfg.logging.channelId);
  for (const key of Object.keys(cfg.logging.categories) as (keyof LoggingCategoryConfig)[]) {
    cfg.logging.categories[key] = asBool(cfg.logging.categories[key], true);
  }

  cfg.verification.messageId = asString(cfg.verification.messageId);
  cfg.verification.channelId = asString(cfg.verification.channelId);
  cfg.verification.roleId = asString(cfg.verification.roleId);
  cfg.verification.title = asString(cfg.verification.title, '✅ Verification');
  cfg.verification.description = asString(cfg.verification.description);
  cfg.verification.showUnverify = asBool(cfg.verification.showUnverify, true);

  cfg.automod.blockUrls = asBool(cfg.automod.blockUrls, true);
  cfg.automod.blockGifs = asBool(cfg.automod.blockGifs, true);
  cfg.automod.blockCaps = asBool(cfg.automod.blockCaps, true);
  cfg.automod.gifWhitelistRoles = asStringArray(cfg.automod.gifWhitelistRoles);
  cfg.automod.bypassRoles = asStringArray(cfg.automod.bypassRoles);
  cfg.automod.ignoredChannels = asStringArray(cfg.automod.ignoredChannels);
  cfg.automod.alertRoleIds = asStringArray(cfg.automod.alertRoleIds);
  cfg.automod.attachmentOnlyChannels = asStringArray(cfg.automod.attachmentOnlyChannels);
  cfg.automod.modLogsChannelId = asString(cfg.automod.modLogsChannelId);
  cfg.automod.capsMinLength = asInt(cfg.automod.capsMinLength, 10, 1, 500);
  cfg.automod.capsMaxPercent = asInt(cfg.automod.capsMaxPercent, 70, 1, 100);

  const ai = cfg.automod.aiModeration;
  ai.enabled = asBool(ai.enabled, false);
  ai.model = asString(ai.model, 'gemini-3.8-live');
  ai.apiKey = asString(ai.apiKey);
  ai.systemPrompt = asString(ai.systemPrompt);
  ai.categories = asStringArray(ai.categories);
  ai.thinkingLevel = asString(ai.thinkingLevel, 'low');
  ai.minLength = asInt(ai.minLength, 8, 0, 2_000);
  ai.confidenceThreshold = asNumber(ai.confidenceThreshold, 0.7, 0, 1);

  cfg.autoReactions = (Array.isArray(cfg.autoReactions) ? cfg.autoReactions : [])
    .map((entry) => ({
      channelId: asString(entry?.channelId),
      emojis: asStringArray(entry?.emojis),
    }))
    .filter((entry) => entry.channelId !== '');

  const autoReplies = cfg.autoReplies;
  autoReplies.enabled = asBool(autoReplies.enabled, false);
  const matchTypes = ['exact', 'contains', 'startsWith', 'regex'];
  autoReplies.rules = (Array.isArray(autoReplies.rules) ? autoReplies.rules : [])
    .slice(0, 100)
    .map((rule, index) => {
      const matchType = asString(rule?.matchType, 'contains');
      return {
        id: asString(rule?.id) || `r${index + 1}`,
        name: asString(rule?.name, `Rule ${index + 1}`).trim().slice(0, 100) || `Rule ${index + 1}`,
        enabled: asBool(rule?.enabled, true),
        channelIds: asStringArray(rule?.channelIds),
        bypassRoleIds: asStringArray(rule?.bypassRoleIds),
        matchType: (matchTypes.includes(matchType) ? matchType : 'contains') as AutoReplyMatchType,
        triggers: asStringArray(rule?.triggers)
          .slice(0, 25)
          .map((trigger) => trigger.slice(0, 200)),
        reply: asString(rule?.reply).slice(0, 2000),
        respondIn: rule?.respondIn === 'dm' ? ('dm' as const) : ('channel' as const),
        pingAuthor: asBool(rule?.pingAuthor, false),
        deleteTrigger: asBool(rule?.deleteTrigger, false),
        caseSensitive: asBool(rule?.caseSensitive, false),
        cooldownSeconds: asInt(rule?.cooldownSeconds, 30, 0, 86_400),
      };
    });

  cfg.welcome.channelId = asString(cfg.welcome.channelId);
  cfg.welcome.message = asString(cfg.welcome.message);
  cfg.welcome.welcomeImageMessage = asString(cfg.welcome.welcomeImageMessage);
  cfg.welcome.backgroundImage = asString(cfg.welcome.backgroundImage, 'assets/bg.jpg');
  cfg.welcome.enabled = asBool(cfg.welcome.enabled, false);

  cfg.goodbye.channelId = asString(cfg.goodbye.channelId);
  cfg.goodbye.message = asString(cfg.goodbye.message);
  cfg.goodbye.enabled = asBool(cfg.goodbye.enabled, false);

  cfg.roles.panels = (Array.isArray(cfg.roles.panels) ? cfg.roles.panels : []).map((panel, index) => ({
    ...panel,
    id: asString(panel.id) || `p${index + 1}`,
    name: asString(panel.name) || `Panel ${index + 1}`,
    messageId: asString(panel.messageId),
    channelId: asString(panel.channelId),
    title: asString(panel.title, '🎭 Self-Assign Roles'),
    description: asString(panel.description),
    overrideRoles: asBool(panel.overrideRoles, false),
    buttons: (Array.isArray(panel.buttons) ? panel.buttons : [])
      .slice(0, 25)
      .map((button) => ({
        roleId: asString(button?.roleId),
        label: asString(button?.label).slice(0, 80),
        emoji: asString(button?.emoji),
        style: asInt(button?.style, 2, 1, 4),
      }))
      .filter((button) => button.roleId !== ''),
  }));

  cfg.tickets.categoryId = asString(cfg.tickets.categoryId);
  cfg.tickets.logChannelId = asString(cfg.tickets.logChannelId);
  cfg.tickets.defaultStaffRoles = asStringArray(cfg.tickets.defaultStaffRoles);
  cfg.tickets.defaultPingRoles = asStringArray(cfg.tickets.defaultPingRoles);
  cfg.tickets.panels = (Array.isArray(cfg.tickets.panels) ? cfg.tickets.panels : []).map((panel, index) => ({
    ...panel,
    id: asString(panel.id) || `t${index + 1}`,
    name: asString(panel.name) || `Ticket panel ${index + 1}`,
    channelId: asString(panel.channelId),
    messageId: asString(panel.messageId),
    title: asString(panel.title, '🎫 Support'),
    description: asString(panel.description),
    buttonLabel: asString(panel.buttonLabel, 'Open Ticket').slice(0, 80),
    buttonEmoji: asString(panel.buttonEmoji),
    buttonStyle: asInt(panel.buttonStyle, 1, 1, 4),
    categoryId: asString(panel.categoryId) || cfg.tickets.categoryId,
    staffRoles: asStringArray(panel.staffRoles),
    pingRoles: asStringArray(panel.pingRoles),
    welcomeMessage: asString(panel.welcomeMessage),
    pingOnCreate: asBool(panel.pingOnCreate, true),
    autoCloseHours: asInt(panel.autoCloseHours, 0, 0, 8760),
    transcriptsEnabled: asBool(panel.transcriptsEnabled, true),
    transcriptChannelId: asString(panel.transcriptChannelId),
    formFields: (Array.isArray(panel.formFields) ? panel.formFields : []).map((field, fieldIndex) => {
      const minLength =
        typeof field?.minLength === 'number' ? asInt(field.minLength, 0, 0, 4000) : undefined;
      const maxLength =
        typeof field?.maxLength === 'number' ? asInt(field.maxLength, 1, 1, 4000) : undefined;
      return {
        ...field,
        id: asString(field?.id) || `field_${fieldIndex + 1}`,
        label: asString(field?.label, `Field ${fieldIndex + 1}`).slice(0, 45),
        placeholder: asString(field?.placeholder),
        type: field?.type === 'paragraph' ? ('paragraph' as const) : ('short' as const),
        required: asBool(field?.required, true),
        maxLength:
          maxLength !== undefined && minLength !== undefined ? Math.max(maxLength, minLength) : maxLength,
        minLength,
      };
    }),
  }));
}

/**
 * Replace the in-memory config and persist it.
 *
 * The dashboard sends the config without secrets (`token`, Gemini API key).
 * When `preserveSecrets` is true (the default), missing/blank/redacted secret
 * values keep their current on-disk value instead of being wiped.
 *
 * Returns the normalised config that is now live. Changes made this way take
 * effect immediately — the bot reads `getConfig()` on every event.
 */
export function replaceConfig(raw: unknown, options: { preserveSecrets?: boolean } = {}): BotConfig {
  const source: any = raw && typeof raw === 'object' && !Array.isArray(raw) ? JSON.parse(JSON.stringify(raw)) : {};

  if (options.preserveSecrets !== false) {
    if (typeof source.token !== 'string' || source.token.trim() === '' || source.token === REDACTED_VALUE) {
      source.token = config.token;
    }
    if (!source.automod || typeof source.automod !== 'object' || Array.isArray(source.automod)) {
      source.automod = {};
    }
    const ai = source.automod.aiModeration;
    if (!ai || typeof ai !== 'object' || Array.isArray(ai)) {
      source.automod.aiModeration = {};
    }
    const apiKey = source.automod.aiModeration.apiKey;
    if (typeof apiKey !== 'string' || apiKey.trim() === '' || apiKey === REDACTED_VALUE) {
      source.automod.aiModeration.apiKey = config.automod.aiModeration.apiKey;
    }
  }

  config = normalizeConfig(source);
  sanitizeConfig(config);
  saveConfig();
  return config;
}

export function saveConfig(): void {
  try {
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('Failed to save config.json:', err);
    throw err;
  }
}

export function updateConfig(mutator: (cfg: BotConfig) => void): BotConfig {
  mutator(config);
  try {
    saveConfig();
  } catch (err) {
    console.error('Failed to persist config changes:', err);
    throw err;
  }
  return config;
}
