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
  /** Channels where messages must have attachments */
  attachmentOnlyChannels: string[];
}

export interface AutoReactionChannel {
  /** Channel ID to react in */
  channelId: string;
  /** List of emojis to react with (can be unicode or custom emoji IDs like <:name:id> or <a:name:id>) */
  emojis: string[];
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
    attachmentOnlyChannels: [],
  },
  autoReactions: [],
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

export function loadConfig(): BotConfig {
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const legacyPerMessage = parsed.xp?.perMessage;
      const legacyPerVoice = parsed.xp?.perVoiceMinute;

      config = {
        ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
        ...parsed,
        reactionRoles: {
          ...DEFAULT_CONFIG.reactionRoles,
          ...(parsed.reactionRoles || {}),
          mappings: { ...(parsed.reactionRoles?.mappings || {}) },
        },
        roles: migratePanels(parsed.roles),
        levelRoles: { ...(parsed.levelRoles || {}) },
        xp: {
          perMessageMin: parsed.xp?.perMessageMin ?? legacyPerMessage ?? DEFAULT_CONFIG.xp.perMessageMin,
          perMessageMax: parsed.xp?.perMessageMax ?? legacyPerMessage ?? DEFAULT_CONFIG.xp.perMessageMax,
          cooldownSeconds: parsed.xp?.cooldownSeconds ?? DEFAULT_CONFIG.xp.cooldownSeconds,
          perVoiceMinuteMin:
            parsed.xp?.perVoiceMinuteMin ?? legacyPerVoice ?? DEFAULT_CONFIG.xp.perVoiceMinuteMin,
          perVoiceMinuteMax:
            parsed.xp?.perVoiceMinuteMax ?? legacyPerVoice ?? DEFAULT_CONFIG.xp.perVoiceMinuteMax,
          noXpChannels: [...(parsed.xp?.noXpChannels || [])],
          xpChannel: parsed.xp?.xpChannel || '',
          ignoreBots: parsed.xp?.ignoreBots ?? DEFAULT_CONFIG.xp.ignoreBots,
        },
        channels: { ...DEFAULT_CONFIG.channels, ...(parsed.channels || {}) },
        verification: { ...DEFAULT_CONFIG.verification, ...(parsed.verification || {}) },
        automod: { ...DEFAULT_CONFIG.automod, ...(parsed.automod || {}) },
        autoReactions: Array.isArray(parsed.autoReactions) ? parsed.autoReactions : [],
        welcome: { ...DEFAULT_CONFIG.welcome, ...(parsed.welcome || {}) },
        goodbye: { ...DEFAULT_CONFIG.goodbye, ...(parsed.goodbye || {}) },
        tickets: {
          ...DEFAULT_CONFIG.tickets,
          ...(parsed.tickets || {}),
          panels: Array.isArray(parsed.tickets?.panels) ? parsed.tickets.panels : [],
        },
      };
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
