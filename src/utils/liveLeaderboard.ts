/**
 * Persistent, self-updating leaderboard message.
 *
 * Unlike `/leaderboard` (which renders a fresh image per invocation), this
 * module keeps ONE message in one channel and re-renders it on a timer.
 * Everything lives in a single embed:
 *   - the top-3 podium PNG (Discord always renders an embed image last),
 *   - the Top 3 list and the rank zones, each member linked to their profile,
 *   - a text progress bar on the same line as the name,
 *   - dividers between every section.
 *
 * The message id is stored in config so a restart edits the same message
 * instead of posting a duplicate.
 */
import {
  AttachmentBuilder,
  EmbedBuilder,
  escapeMarkdown,
  type Client,
  type Guild,
  type Message,
  type TextChannel,
} from 'discord.js';
import { getConfig, updateConfig } from '../config';
import { getLeaderboard } from '../db';
import { levelFromXp, progressBar, progressPercent } from './level';
import { leaderboardPodium } from './rankcard';

export interface LiveLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string;
  level: number;
  totalXp: number;
  xpInLevel: number;
  xpForNext: number;
  percent: number;
}

export type LiveLeaderboardStatus =
  | 'disabled'
  | 'no-guild'
  | 'no-channel'
  | 'empty'
  | 'unchanged'
  | 'updated'
  | 'created'
  | 'error';

export interface LiveLeaderboardResult {
  status: LiveLeaderboardStatus;
  messageId?: string;
  channelId?: string;
  entries?: number;
}

interface Zone {
  emoji: string;
  name: string;
  from: number;
  to: number;
}

const ZONES: Zone[] = [
  { emoji: '💎', name: 'Diamond Zone', from: 4, to: 10 },
  { emoji: '🏅', name: 'Gold Zone', from: 11, to: 18 },
  { emoji: '⚪', name: 'Silver Zone', from: 19, to: 25 },
];

/** Thin full-width rule used between embed sections. */
const DIVIDER = '─'.repeat(46);
const MEDALS = ['🥇', '🥈', '🥉'];

/** Last payload signature, so an unchanged board is not rebuilt every tick. */
let lastDataSignature = '';
let lastFooterLabel = '';
let lastUpdatedAt = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let lastAttempt = 0;

function formatXp(value: number): string {
  return Math.floor(value).toLocaleString('en-US');
}

function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Make a username safe to use as masked-link text: markdown is escaped and
 * square brackets are swapped for look-alikes so the link cannot be broken.
 */
function linkText(text: string): string {
  return escapeMarkdown(clampText(text, 16))
    .replace(/\[/g, '［')
    .replace(/\]/g, '］');
}

/** `[name](https://discord.com/users/<id>)` — clickable, never pings. */
function userLink(entry: LiveLeaderboardEntry): string {
  return `[${linkText(entry.username)}](https://discord.com/users/${entry.userId})`;
}

/** Human age of the last content change, e.g. "27 minutes ago". */
function freshnessLabel(updatedAt: number, now: number = Date.now()): string {
  if (!updatedAt) return 'just now';
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

function resolveGuild(client: Client): Guild | null {
  const cfg = getConfig();
  return client.guilds.cache.get(cfg.guildId) ?? client.guilds.cache.first() ?? null;
}

async function collectEntries(
  client: Client,
  guild: Guild,
  limit: number,
): Promise<LiveLeaderboardEntry[]> {
  const rows = getLeaderboard(limit);

  return Promise.all(
    rows.map(async (row, index) => {
      const member = guild.members.cache.get(row.user_id);
      let user = member?.user ?? client.users.cache.get(row.user_id);
      if (!user) {
        try {
          user = await client.users.fetch(row.user_id);
        } catch {
          user = undefined;
        }
      }

      const info = levelFromXp(row.xp);
      const username =
        member?.displayName ?? user?.globalName ?? user?.username ?? 'Unknown user';
      const avatarUrl = member
        ? member.displayAvatarURL({ extension: 'png', size: 256 })
        : user?.displayAvatarURL({ extension: 'png', size: 256 }) ?? '';

      return {
        rank: index + 1,
        userId: row.user_id,
        username,
        avatarUrl,
        level: info.level,
        totalXp: row.xp,
        xpInLevel: info.xpInLevel,
        xpForNext: info.xpForNext,
        percent: progressPercent(info),
      };
    }),
  );
}

export function buildContentEmbed(
  entries: LiveLeaderboardEntry[],
  guild: Guild,
  rows: number,
  titleOverride: string,
  podiumUrl?: string,
  updatedAt: number = Date.now(),
): EmbedBuilder {
  const title = titleOverride.trim() || `🏆 ${guild.name} leaderboard`;
  const top = entries.slice(0, 3);

  const embed = new EmbedBuilder()
    .setColor(0x2b2d63)
    .setTitle(clampText(title, 256))
    .setDescription(
      `👥 **${guild.memberCount.toLocaleString('en-US')}** members ✨ *Ranked by experience*`,
    )
    .addFields({ name: '\u200B', value: DIVIDER });

  const topLines = top.map(
    (entry, index) =>
      `${MEDALS[index]} ${userLink(entry)} — Lv ${entry.level} · ${formatXp(entry.totalXp)} XP`,
  );
  embed.addFields({
    name: '👑 Top 3',
    value: topLines.length > 0 ? topLines.join('\n') : 'No ranked members yet.',
  });

  for (const zone of ZONES) {
    const from = zone.from;
    if (from > rows || from > entries.length + 1) continue;

    const to = Math.min(zone.to, rows);
    const zoneEntries = entries.filter((entry) => entry.rank >= from && entry.rank <= to);
    if (zoneEntries.length === 0) continue;

    const above = entries[from - 2];
    const first = entries[from - 1];
    const gap = above && first ? Math.max(0, above.totalXp - first.totalXp) : 0;
    const target =
      from === 4 ? 'Top 3' : (ZONES.find((z) => z.to === from - 1)?.name ?? 'the next zone');
    const header =
      gap > 0
        ? `Ranks ${from} – ${to} ⚡ \`${formatXp(gap)} XP\` to pass #${from - 1} and enter ${target}`
        : `Ranks ${from} – ${to}`;

    const lines = zoneEntries.map((entry) => {
      const rankLabel = String(entry.rank).padStart(2, '0');
      const bar = progressBar(entry.percent, 6);
      return (
        `\`${rankLabel}\` ${userLink(entry)} — Lv ${entry.level} · ${formatXp(entry.totalXp)} XP ` +
        `${bar} ${entry.percent}%`
      );
    });

    embed.addFields(
      { name: '\u200B', value: DIVIDER },
      {
        name: `${zone.emoji} ${zone.name}`,
        value: clampText(`${header}\n${lines.join('\n')}`, 1024),
      },
    );
  }

  const label = freshnessLabel(updatedAt);
  if (podiumUrl) embed.setImage(podiumUrl);

  return embed
    .setFooter({ text: `🔄 Updates automatically · last update ${label}` })
    .setTimestamp(new Date(updatedAt || Date.now()));
}

/** Stable signature of everything that affects the rendered board. */
function signatureOf(
  entries: LiveLeaderboardEntry[],
  guild: Guild,
  rows: number,
  title: string,
): string {
  const members = entries
    .map((entry) => `${entry.userId}:${entry.totalXp}:${entry.username}:${entry.avatarUrl}`)
    .join('|');
  return `${guild.id}:${guild.name}:${guild.memberCount}:${rows}:${title}:${members}`;
}

async function fetchTextChannel(client: Client, channelId: string): Promise<TextChannel | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) return null;
    return channel as TextChannel;
  } catch {
    return null;
  }
}

async function buildMessagePayload(
  entries: LiveLeaderboardEntry[],
  guild: Guild,
  rows: number,
  title: string,
  updatedAt: number,
): Promise<{ embeds: EmbedBuilder[]; files: AttachmentBuilder[] }> {
  try {
    const buffer = await leaderboardPodium.generate(
      entries.slice(0, 3).map((entry) => ({
        username: entry.username,
        avatarUrl: entry.avatarUrl,
        level: entry.level,
        totalXp: entry.totalXp,
        percent: entry.percent,
      })),
    );
    const file = new AttachmentBuilder(buffer, { name: 'top-3.png' });
    return {
      embeds: [
        buildContentEmbed(entries, guild, rows, title, 'attachment://top-3.png', updatedAt),
      ],
      files: [file],
    };
  } catch (err) {
    console.error('[LiveLeaderboard] Podium render failed, sending text only:', err);
    return { embeds: [buildContentEmbed(entries, guild, rows, title, undefined, updatedAt)], files: [] };
  }
}

/**
 * Render and publish/update the persistent message.
 *
 * `force` bypasses the "nothing changed" short-circuit (used by setup and the
 * dashboard button). Every Discord failure is reported, never thrown, so the
 * bot keeps running.
 */
export async function refreshLiveLeaderboard(
  client: Client,
  options: { force?: boolean } = {},
): Promise<LiveLeaderboardResult> {
  const cfg = getConfig();
  const settings = cfg.liveLeaderboard;

  if (!settings.enabled) return { status: 'disabled' };
  if (!settings.channelId) return { status: 'no-channel' };

  const guild = resolveGuild(client);
  if (!guild) return { status: 'no-guild' };

  const rows = Math.min(25, Math.max(3, settings.rows));
  const entries = await collectEntries(client, guild, rows);
  if (entries.length === 0) return { status: 'empty' };

  const dataSignature = signatureOf(entries, guild, rows, settings.title);
  const label = freshnessLabel(lastUpdatedAt);

  // Only skip when neither the board nor the "last update" wording would change.
  if (
    !options.force &&
    settings.messageId &&
    dataSignature === lastDataSignature &&
    label === lastFooterLabel
  ) {
    return { status: 'unchanged', messageId: settings.messageId, channelId: settings.channelId };
  }

  const channel = await fetchTextChannel(client, settings.channelId);
  if (!channel) {
    console.error(`[LiveLeaderboard] Channel ${settings.channelId} is missing or not writable.`);
    return { status: 'no-channel' };
  }

  let message: Message | null = null;
  if (settings.messageId) {
    message = await channel.messages.fetch(settings.messageId).catch(() => null);
    // The saved id may point at another channel after a channel change.
    if (message && message.channelId !== channel.id) message = null;
  }

  const contentChanged = !message || options.force === true || dataSignature !== lastDataSignature;
  const updatedAt = contentChanged ? Date.now() : lastUpdatedAt;
  const payload = await buildMessagePayload(entries, guild, rows, settings.title, updatedAt);

  try {
    let messageId: string;
    if (message) {
      messageId = (await message.edit(payload)).id;
    } else {
      const sent = await channel.send(payload);
      messageId = sent.id;
      updateConfig((config) => {
        config.liveLeaderboard.channelId = channel.id;
        config.liveLeaderboard.messageId = sent.id;
      });
    }

    lastDataSignature = dataSignature;
    lastFooterLabel = freshnessLabel(updatedAt);
    if (contentChanged) lastUpdatedAt = updatedAt;

    return {
      status: message ? 'updated' : 'created',
      messageId,
      channelId: channel.id,
      entries: entries.length,
    };
  } catch (err) {
    console.error('[LiveLeaderboard] Failed to publish/update the message:', err);
    return { status: 'error', channelId: channel.id, messageId: settings.messageId };
  }
}

/** Forget the cached signature so the next render always rebuilds the board. */
export function invalidateLiveLeaderboard(): void {
  lastDataSignature = '';
  lastFooterLabel = '';
  lastUpdatedAt = 0;
}

/**
 * Check every minute whether the configured interval has elapsed. Reading the
 * interval from config on each tick makes dashboard changes live: no restart
 * is needed after changing it.
 */
async function tick(client: Client): Promise<void> {
  const settings = getConfig().liveLeaderboard;
  if (!settings.enabled || !settings.channelId) return;

  const intervalMs = Math.max(1, settings.intervalMinutes) * 60_000;
  if (Date.now() - lastAttempt < intervalMs) return;
  lastAttempt = Date.now();

  try {
    await refreshLiveLeaderboard(client);
  } catch (err) {
    console.error('[LiveLeaderboard] Refresh error:', err);
  }
}

/** Start (or restart, after a reconnect) the one-minute scheduler. */
export function startLiveLeaderboard(client: Client): void {
  stopLiveLeaderboard();
  invalidateLiveLeaderboard();
  lastAttempt = 0;

  refreshTimer = setInterval(() => {
    void tick(client);
  }, 60_000);

  void tick(client);
}

export function stopLiveLeaderboard(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
