/**
 * Persistent, self-updating leaderboard message.
 *
 * Unlike `/leaderboard` (which renders a fresh image per invocation), this
 * module keeps ONE message in one channel and re-renders it on a timer:
 *   - a podium PNG of the top 3 members,
 *   - an embed with Top 3, rank zones, progress bars and a footer timestamp.
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

/** Last payload signature, so an unchanged board is not edited every tick. */
let lastSignature = '';
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let lastAttempt = 0;

function formatXp(value: number): string {
  return Math.floor(value).toLocaleString('en-US');
}

function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
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
): EmbedBuilder {
  const title = titleOverride.trim() || `🏆 ${guild.name} leaderboard`;
  const top = entries.slice(0, 3);

  const topLines = top.map((entry, index) => {
    const medal = ['🥇', '🥈', '🥉'][index];
    return `${index + 1}. ${medal} **${escapeMarkdown(clampText(entry.username, 24))}** — Lv ${entry.level} · ${formatXp(entry.totalXp)} XP`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x2b2d63)
    .setTitle(clampText(title, 256))
    .setDescription(
      `*${guild.memberCount.toLocaleString('en-US')} members* ✨ *Ranked by experience*`,
    )
    .addFields({
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
    const target = from === 4 ? 'Top 3' : (ZONES.find((z) => z.to === from - 1)?.name ?? 'the next zone');
    const header =
      gap > 0
        ? `Ranks ${from}-${to} — \`${formatXp(gap)} XP\` to pass #${from - 1} and enter ${target}`
        : `Ranks ${from}-${to}`;

    const lines = zoneEntries.map((entry) => {
      const rankLabel = String(entry.rank).padStart(2, '0');
      const bar = progressBar(entry.percent, 16);
      return (
        `\`${rankLabel}\` **${escapeMarkdown(clampText(entry.username, 20))}** — Lv ${entry.level} · ${formatXp(entry.totalXp)} XP\n` +
        `${bar} ${entry.percent}%`
      );
    });

    embed.addFields({
      name: `${zone.emoji} ${zone.name}`,
      value: clampText(`${header}\n${lines.join('\n')}`, 1024),
    });
  }

  return embed
    .setFooter({ text: 'Updates automatically' })
    .setTimestamp(new Date());
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
): Promise<{ embeds: EmbedBuilder[]; files: AttachmentBuilder[] }> {
  const content = buildContentEmbed(entries, guild, rows, title);

  try {
    const buffer = await leaderboardPodium.generate(
      entries.slice(0, 3).map((entry) => ({
        username: entry.username,
        avatarUrl: entry.avatarUrl,
        level: entry.level,
        totalXp: entry.totalXp,
      })),
    );
    const file = new AttachmentBuilder(buffer, { name: 'top-3.png' });
    const podium = new EmbedBuilder()
      .setColor(0x2b2d63)
      .setImage('attachment://top-3.png');
    return { embeds: [podium, content], files: [file] };
  } catch (err) {
    console.error('[LiveLeaderboard] Podium render failed, sending text only:', err);
    return { embeds: [content], files: [] };
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

  const signature = signatureOf(entries, guild, rows, settings.title);
  if (!options.force && settings.messageId && signature === lastSignature) {
    return { status: 'unchanged', messageId: settings.messageId, channelId: settings.channelId };
  }

  const channel = await fetchTextChannel(client, settings.channelId);
  if (!channel) {
    console.error(`[LiveLeaderboard] Channel ${settings.channelId} is missing or not writable.`);
    return { status: 'no-channel' };
  }

  const payload = await buildMessagePayload(entries, guild, rows, settings.title);

  let message: Message | null = null;
  if (settings.messageId) {
    message = await channel.messages.fetch(settings.messageId).catch(() => null);
    // The saved id may point at another channel after a channel change.
    if (message && message.channelId !== channel.id) message = null;
  }

  try {
    if (message) {
      const edited = await message.edit(payload);
      lastSignature = signature;
      return {
        status: 'updated',
        messageId: edited.id,
        channelId: channel.id,
        entries: entries.length,
      };
    }

    const sent = await channel.send(payload);
    updateConfig((config) => {
      config.liveLeaderboard.channelId = channel.id;
      config.liveLeaderboard.messageId = sent.id;
    });
    lastSignature = signature;
    return {
      status: 'created',
      messageId: sent.id,
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
  lastSignature = '';
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
