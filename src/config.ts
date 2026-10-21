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
        },
        channels: { ...DEFAULT_CONFIG.channels, ...(parsed.channels || {}) },
        verification: { ...DEFAULT_CONFIG.verification, ...(parsed.verification || {}) },
        automod: { ...DEFAULT_CONFIG.automod, ...(parsed.automod || {}) },
        autoReactions: Array.isArray(parsed.autoReactions) ? parsed.autoReactions : [],
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
