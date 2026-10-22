/**
 * Local web dashboard for editing `config.json`.
 *
 * The dashboard runs inside the bot process, so a save is applied to the live
 * in-memory config immediately — no restart and no second source of truth.
 * It binds to loopback by default and refuses to listen on a public interface
 * without a password.
 */
import http, { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type TextChannel,
  type User,
} from 'discord.js';
import {
  getConfig,
  getConfigPath,
  loadConfig,
  replaceConfig,
  REDACTED_VALUE,
  type BotConfig,
  type RolePanel,
  type TicketPanel,
} from '../config';
import {
  countRanked,
  getAllTickets,
  getLeaderboard,
  getOpenTickets,
  getTicketCount,
  getTotalMemberCount,
} from '../db';
import { buildPanelRows } from '../handlers/buttons';
import { TICKET_OPEN_PREFIX } from '../handlers/tickets';
import { GeminiLiveModerator } from '../utils/gemini-live';
import { welcomeCard } from '../utils/welcomecard';

const SESSION_COOKIE = 'talaba_dashboard';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface DashboardDeps {
  client: Client;
  password: string;
  publicDir: string;
}

interface Session {
  expiresAt: number;
}

interface LoginAttempt {
  count: number;
  resetAt: number;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function startDashboard(client: Client): http.Server | null {
  const enabled = (process.env.DASHBOARD_ENABLED ?? 'true').toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(enabled)) {
    console.log('[Dashboard] Disabled via DASHBOARD_ENABLED.');
    return null;
  }

  const host = process.env.DASHBOARD_HOST || '127.0.0.1';
  const port = Number.parseInt(process.env.DASHBOARD_PORT || '3000', 10);
  const password = process.env.DASHBOARD_PASSWORD || '';
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`[Dashboard] Invalid DASHBOARD_PORT "${process.env.DASHBOARD_PORT}". Dashboard not started.`);
    return null;
  }

  if (!loopback && !password) {
    console.error('[Dashboard] Refusing to listen on a non-loopback host without DASHBOARD_PASSWORD.');
    console.error('[Dashboard] Set DASHBOARD_PASSWORD or bind DASHBOARD_HOST=127.0.0.1.');
    return null;
  }

  // Works from both src/dashboard (tsx) and dist/dashboard (compiled).
  const publicDir = path.join(__dirname, '..', '..', 'dashboard');
  if (!fs.existsSync(path.join(publicDir, 'index.html'))) {
    console.error(`[Dashboard] Missing dashboard assets at ${publicDir}. Dashboard not started.`);
    return null;
  }

  const deps: DashboardDeps = { client, password, publicDir };
  const sessions = new Map<string, Session>();
  const loginAttempts = new Map<string, LoginAttempt>();

  const server = http.createServer((req, res) => {
    handleRequest(req, res, deps, sessions, loginAttempts).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) {
        console.error('[Dashboard] Unhandled request error:', err);
      }
      if (!res.headersSent) {
        sendJson(res, status, { error: err instanceof Error ? err.message : 'Internal error' });
      } else {
        res.end();
      }
    });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Dashboard] Port ${port} is already in use. Dashboard not started.`);
    } else {
      console.error('[Dashboard] Server error:', err);
    }
  });

  server.listen(port, host, () => {
    const urls = listenUrls(host, port);
    console.log(`[Dashboard] Listening on ${urls.join(' · ')}${password ? ' (password required)' : ''}`);
    if (host === '0.0.0.0' || host === '::' || host === '[::]') {
      console.log(`[Dashboard] Bound to all interfaces (${host}). Use one of the addresses above or a reverse proxy.`);
    }
    if (!password) {
      console.warn('[Dashboard] No DASHBOARD_PASSWORD set — access is limited to this machine.');
      console.warn('[Dashboard] Set DASHBOARD_PASSWORD in .env to require a login.');
    }
  });

  return server;
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Addresses a human can actually open. When bound to `0.0.0.0`/`::`, list the
 * loopback URL plus every non-internal IPv4 address of this machine.
 */
function listenUrls(host: string, port: number): string[] {
  if (host === '0.0.0.0' || host === '::' || host === '[::]') {
    const urls = [`http://127.0.0.1:${port} (local)`];
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === 'IPv4' && !address.internal) {
          urls.push(`http://${address.address}:${port} (LAN)`);
        }
      }
    }
    return urls;
  }
  if (host === '::1' || host === '[::1]') return [`http://[::1]:${port}`];
  return [`http://${host}:${port}`];
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DashboardDeps,
  sessions: Map<string, Session>,
  loginAttempts: Map<string, LoginAttempt>,
): Promise<void> {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  setSecurityHeaders(res);

  if (!pathname.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    serveStatic(res, pathname, deps.publicDir, method === 'HEAD');
    return;
  }

  // Unauthenticated endpoints.
  if (pathname === '/api/session' && method === 'GET') {
    sendJson(res, 200, {
      passwordRequired: Boolean(deps.password),
      authenticated: isAuthenticated(req, deps, sessions),
    });
    return;
  }

  if (pathname === '/api/login' && method === 'POST') {
    assertSameOriginJson(req);
    const ip = req.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(ip);
    const now = Date.now();
    if (attempt && attempt.resetAt > now && attempt.count >= LOGIN_MAX_ATTEMPTS) {
      throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    }

    if (!deps.password) {
      sendJson(res, 200, { ok: true, passwordRequired: false });
      return;
    }

    const body = await readJson(req);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || !safeEqual(password, deps.password)) {
      if (!attempt || attempt.resetAt <= now) {
        loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
      } else {
        attempt.count += 1;
      }
      throw new HttpError(401, 'Incorrect password.');
    }

    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { expiresAt: now + SESSION_TTL_MS });
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    );
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!isAuthenticated(req, deps, sessions)) {
    throw new HttpError(401, 'Not signed in.');
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method !== 'GET') assertSameOriginJson(req);

  const cfg = getConfig();
  const guild = resolveGuild(deps.client, cfg);

  switch (`${method} ${pathname}`) {
    case 'GET /api/health': {
      sendJson(res, 200, healthSnapshot(deps.client, guild, Boolean(deps.password)));
      return;
    }

    case 'GET /api/guild': {
      sendJson(res, 200, guildSnapshot(guild));
      return;
    }

    case 'GET /api/stats': {
      sendJson(res, 200, await statsSnapshot(deps.client, guild));
      return;
    }

    case 'GET /api/config': {
      sendJson(res, 200, {
        config: redactConfig(cfg),
        revision: configRevision(),
        meta: configMeta(cfg),
      });
      return;
    }

    case 'PUT /api/config': {
      const body = await readJson(req);
      const incomingRevision = typeof body.revision === 'string' ? body.revision : '';
      if (incomingRevision && incomingRevision !== configRevision()) {
        sendJson(res, 409, {
          error: 'The configuration changed elsewhere (for example a slash command). Reload and try again.',
          config: redactConfig(getConfig()),
          revision: configRevision(),
          meta: configMeta(getConfig()),
        });
        return;
      }
      if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
        throw new HttpError(400, 'Expected a config object.');
      }

      const updated = replaceConfig(body.config, { preserveSecrets: true });
      console.log('[Dashboard] Configuration saved from the web dashboard.');
      sendJson(res, 200, {
        config: redactConfig(updated),
        revision: configRevision(),
        meta: configMeta(updated),
      });
      return;
    }

    case 'POST /api/secrets': {
      const body = await readJson(req);
      const next = JSON.parse(JSON.stringify(cfg)) as BotConfig;

      if (typeof body.token === 'string' && body.token.trim() !== '') {
        next.token = body.token.trim();
      }
      if (typeof body.geminiApiKey === 'string' && body.geminiApiKey.trim() !== '') {
        next.automod.aiModeration.apiKey = body.geminiApiKey.trim();
      }

      const updated = replaceConfig(next, { preserveSecrets: false });
      console.log('[Dashboard] Secrets updated from the web dashboard.');
      sendJson(res, 200, {
        ok: true,
        revision: configRevision(),
        meta: configMeta(updated),
        note: 'BOT_TOKEN in .env overrides the saved token. Restart the bot after changing the token.',
      });
      return;
    }

    case 'POST /api/actions/reload-config': {
      loadConfig();
      console.log('[Dashboard] Config reloaded from disk.');
      sendJson(res, 200, {
        config: redactConfig(getConfig()),
        revision: configRevision(),
        meta: configMeta(getConfig()),
      });
      return;
    }

    case 'POST /api/actions/test-welcome': {
      const result = await testWelcome(deps.client, guild);
      sendJson(res, 200, result);
      return;
    }

    case 'POST /api/actions/test-goodbye': {
      const result = await testGoodbye(deps.client, guild);
      sendJson(res, 200, result);
      return;
    }

    case 'POST /api/actions/publish-role-panel': {
      const body = await readJson(req);
      const panelId = typeof body.panelId === 'string' ? body.panelId : '';
      const result = await publishRolePanel(guild, panelId);
      sendJson(res, 200, result);
      return;
    }

    case 'POST /api/actions/publish-ticket-panel': {
      const body = await readJson(req);
      const panelId = typeof body.panelId === 'string' ? body.panelId : '';
      const result = await publishTicketPanel(guild, panelId);
      sendJson(res, 200, result);
      return;
    }

    case 'POST /api/ai/test': {
      const body = await readJson(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) throw new HttpError(400, 'Provide some text to classify.');
      const result = await testAiModeration(text);
      sendJson(res, 200, result);
      return;
    }

    default:
      throw new HttpError(404, 'Not found.');
  }
}

/* ------------------------------------------------------------------ */
/* Config helpers                                                      */
/* ------------------------------------------------------------------ */

function redactConfig(cfg: BotConfig): BotConfig {
  const clone = JSON.parse(JSON.stringify(cfg)) as BotConfig;
  delete (clone as { token?: string }).token;
  if (clone.automod?.aiModeration) {
    clone.automod.aiModeration.apiKey = clone.automod.aiModeration.apiKey ? REDACTED_VALUE : '';
  }
  return clone;
}

function configRevision(): string {
  return crypto.createHash('sha256').update(JSON.stringify(getConfig())).digest('hex').slice(0, 16);
}

function configMeta(cfg: BotConfig): Record<string, unknown> {
  const tokenFromEnv = Boolean(process.env.BOT_TOKEN);
  const keyFromEnv = Boolean(process.env.GEMINI_API_KEY);
  return {
    configPath: path.relative(process.cwd(), getConfigPath()) || 'config.json',
    tokenConfigured: Boolean(process.env.BOT_TOKEN || cfg.token),
    tokenSource: tokenFromEnv ? 'env' : cfg.token ? 'config' : 'missing',
    geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY || cfg.automod.aiModeration.apiKey),
    geminiKeySource: keyFromEnv ? 'env' : cfg.automod.aiModeration.apiKey ? 'config' : 'missing',
  };
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

function resolveGuild(client: Client, cfg: BotConfig): Guild | null {
  const cached = client.guilds.cache.get(cfg.guildId);
  if (cached) return cached;
  if (cfg.guildId) return null;
  for (const guild of client.guilds.cache.values()) return guild;
  return null;
}

function healthSnapshot(client: Client, guild: Guild | null, passwordRequired: boolean) {
  const cfg = getConfig();
  return {
    ok: true,
    bot: {
      ready: client.isReady(),
      tag: client.user?.tag ?? null,
      id: client.user?.id ?? null,
      avatar: client.user?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null,
      uptimeSeconds: Math.floor((client.uptime ?? 0) / 1000),
      ping: client.ws.ping,
    },
    guild: {
      available: Boolean(guild),
      id: guild?.id ?? cfg.guildId,
      name: guild?.name ?? '',
      icon: guild?.iconURL({ extension: 'png', size: 128 }) ?? null,
      memberCount: guild?.memberCount ?? 0,
    },
    dashboard: {
      passwordRequired,
      host: process.env.DASHBOARD_HOST || '127.0.0.1',
      port: Number.parseInt(process.env.DASHBOARD_PORT || '3000', 10),
      version: '1.0.0',
    },
  };
}

function guildSnapshot(guild: Guild | null) {
  if (!guild) {
    return {
      available: false,
      id: '',
      name: '',
      channels: [],
      categories: [],
      roles: [],
    };
  }

  const channels = [...guild.channels.cache.values()]
    .filter((channel): channel is GuildBasedChannel => !channel.isDMBased() && channel.isTextBased())
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId ?? '',
      parentName: channel.parent?.name ?? '',
      position: 'position' in channel ? channel.position : 0,
    }))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  const categories = [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .map((channel) => ({ id: channel.id, name: channel.name, position: channel.position ?? 0 }))
    .sort((a, b) => a.position - b.position);

  const botHighest = guild.members.me?.roles.highest.position ?? 0;
  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      managed: role.managed,
      assignable: !role.managed && role.position < botHighest,
    }))
    .sort((a, b) => b.position - a.position);

  return {
    available: true,
    id: guild.id,
    name: guild.name,
    channels,
    categories,
    roles,
  };
}

interface ResolvedUser {
  username: string;
  displayName: string;
  avatarUrl: string;
}

/**
 * The JSON DB only stores user IDs, and Discord's cache starts empty after a
 * restart, so resolve names on demand (same fallback as `/leaderboard`).
 */
async function resolveUsers(
  client: Client,
  guild: Guild | null,
  userIds: string[],
): Promise<Map<string, ResolvedUser>> {
  const resolved = new Map<string, ResolvedUser>();
  const missing: string[] = [];

  const remember = (id: string, user: User): void => {
    const member = guild?.members.cache.get(id);
    resolved.set(id, {
      username: user.username,
      displayName: member?.displayName ?? user.globalName ?? user.username,
      avatarUrl: user.displayAvatarURL({ extension: 'png', size: 64 }),
    });
  };

  for (const id of userIds) {
    const cached = guild?.members.cache.get(id)?.user ?? client.users.cache.get(id);
    if (cached) remember(id, cached);
    else missing.push(id);
  }

  if (missing.length > 0 && client.isReady()) {
    const fetched = await Promise.allSettled(missing.map((id) => client.users.fetch(id)));
    fetched.forEach((result, index) => {
      if (result.status === 'fulfilled') remember(missing[index], result.value);
    });
  }

  return resolved;
}

async function statsSnapshot(client: Client, guild: Guild | null) {
  const leaderboardRows = getLeaderboard(10);
  const tickets = getAllTickets();
  const recentTickets = tickets.slice(0, 15);

  const userIds = [
    ...new Set([
      ...leaderboardRows.map((row) => row.user_id),
      ...recentTickets.map((ticket) => ticket.creatorId),
    ]),
  ];
  const users = await resolveUsers(client, guild, userIds);

  const openTickets = getOpenTickets();

  return {
    xp: {
      ranked: countRanked(),
      totalMembers: getTotalMemberCount(),
      leaderboard: leaderboardRows.map((row) => {
        const user = users.get(row.user_id);
        return {
          ...row,
          username: user?.username ?? null,
          displayName: user?.displayName ?? null,
          avatarUrl: user?.avatarUrl ?? null,
        };
      }),
    },
    tickets: {
      total: getTicketCount(),
      open: openTickets.length,
      recent: recentTickets.map((ticket) => ({
        id: ticket.id,
        panelId: ticket.panelId,
        status: ticket.status,
        creatorId: ticket.creatorId,
        creatorName: users.get(ticket.creatorId)?.displayName ?? null,
        channelId: ticket.channelId,
        createdAt: ticket.createdAt,
        closedAt: ticket.closedAt ?? null,
      })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard actions                                                   */
/* ------------------------------------------------------------------ */

function renderTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

async function testWelcome(client: Client, guild: Guild | null) {
  const cfg = getConfig();
  if (!cfg.welcome.enabled || !cfg.welcome.channelId) {
    throw new HttpError(400, 'Enable welcome messages and pick a channel first.');
  }
  const channel = await fetchTextChannel(client, cfg.welcome.channelId);
  const memberCount = getTotalMemberCount();
  const displayName = client.user?.displayName ?? 'Test User';
  const guildName = guild?.name ?? 'this server';

  let card: Buffer | null = null;
  try {
    card = await welcomeCard.generate({
      avatarUrl: client.user?.displayAvatarURL({ extension: 'png', size: 512 }) ?? '',
      displayName,
      guildName,
      memberCount,
      welcomeMessage: cfg.welcome.welcomeImageMessage || cfg.welcome.message,
    });
  } catch (err) {
    console.error('[Dashboard] Welcome card render failed, sending text only:', err);
  }

  const content = renderTemplate(cfg.welcome.message, {
    user: `<@${client.user?.id ?? '0'}>`,
    username: displayName,
    server: guildName,
    memberCount,
  });

  await channel.send(
    card
      ? { content: `**Test Welcome:**\n${content}`, files: [new AttachmentBuilder(card, { name: 'welcome.png' })] }
      : { content: `**Test Welcome:**\n${content}` },
  );

  return { ok: true, channelId: channel.id };
}

async function testGoodbye(client: Client, guild: Guild | null) {
  const cfg = getConfig();
  if (!cfg.goodbye.enabled || !cfg.goodbye.channelId) {
    throw new HttpError(400, 'Enable goodbye messages and pick a channel first.');
  }
  const channel = await fetchTextChannel(client, cfg.goodbye.channelId);
  const displayName = client.user?.displayName ?? 'Test User';
  const guildName = guild?.name ?? 'this server';

  const content = renderTemplate(cfg.goodbye.message, {
    user: `<@${client.user?.id ?? '0'}>`,
    username: displayName,
    server: guildName,
    memberCount: getTotalMemberCount(),
  });

  await channel.send({ content: `**Test Goodbye:**\n${content}` });
  return { ok: true, channelId: channel.id };
}

async function publishRolePanel(guild: Guild | null, panelId: string) {
  if (!guild) throw new HttpError(400, 'The bot is not connected to a server yet.');
  const panel = getConfig().roles.panels.find((p) => p.id === panelId);
  if (!panel) throw new HttpError(404, `No role panel with id "${panelId}".`);
  if (!panel.channelId) throw new HttpError(400, 'Pick a channel for this panel first.');

  const channel = await fetchTextChannel(guild.client, panel.channelId);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(panel.title || panel.name)
    .setDescription(panel.description || '');

  const components = buildPanelRows(panel.buttons);
  let message = panel.messageId
    ? await channel.messages.fetch(panel.messageId).catch(() => null)
    : null;
  const created = !message;

  if (message) {
    message = await message.edit({ embeds: [embed], components });
  } else {
    message = await channel.send({ embeds: [embed], components });
  }

  replaceConfig(
    {
      ...getConfig(),
      roles: {
        panels: getConfig().roles.panels.map((entry: RolePanel) =>
          entry.id === panelId ? { ...entry, channelId: channel.id, messageId: message!.id } : entry,
        ),
      },
    },
    { preserveSecrets: true },
  );

  return { ok: true, created, channelId: channel.id, messageId: message.id };
}

async function publishTicketPanel(guild: Guild | null, panelId: string) {
  if (!guild) throw new HttpError(400, 'The bot is not connected to a server yet.');
  const panel = getConfig().tickets.panels.find((p) => p.id === panelId);
  if (!panel) throw new HttpError(404, `No ticket panel with id "${panelId}".`);
  if (!panel.channelId) throw new HttpError(400, 'Pick a channel for this panel first.');
  if (!panel.categoryId) throw new HttpError(400, 'Pick a ticket category first.');

  const channel = await fetchTextChannel(guild.client, panel.channelId);
  const style = [ButtonStyle.Primary, ButtonStyle.Secondary, ButtonStyle.Success, ButtonStyle.Danger].includes(
    panel.buttonStyle as ButtonStyle,
  )
    ? (panel.buttonStyle as ButtonStyle)
    : ButtonStyle.Primary;

  const button = new ButtonBuilder()
    .setCustomId(`${TICKET_OPEN_PREFIX}${panel.id}`)
    .setLabel((panel.buttonLabel || 'Open Ticket').slice(0, 80))
    .setStyle(style);
  if (panel.buttonEmoji) button.setEmoji(panel.buttonEmoji);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(panel.title || panel.name)
    .setDescription(panel.description || '')
    .setFooter({ text: 'Click the button below to open a ticket.' })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
  let message = panel.messageId
    ? await channel.messages.fetch(panel.messageId).catch(() => null)
    : null;
  const created = !message;

  if (message) {
    message = await message.edit({ embeds: [embed], components: [row] });
  } else {
    message = await channel.send({ embeds: [embed], components: [row] });
  }

  replaceConfig(
    {
      ...getConfig(),
      tickets: {
        ...getConfig().tickets,
        panels: getConfig().tickets.panels.map((entry: TicketPanel) =>
          entry.id === panelId ? { ...entry, channelId: channel.id, messageId: message!.id } : entry,
        ),
      },
    },
    { preserveSecrets: true },
  );

  return { ok: true, created, channelId: channel.id, messageId: message.id };
}

async function testAiModeration(text: string) {
  const cfg = getConfig();
  const ai = cfg.automod.aiModeration;
  const apiKey = process.env.GEMINI_API_KEY || ai.apiKey;

  if (!ai.enabled) throw new HttpError(400, 'AI moderation is disabled. Enable it and save first.');
  if (!apiKey) throw new HttpError(400, 'No Gemini API key configured (GEMINI_API_KEY or the dashboard secret).');

  const moderator = new GeminiLiveModerator({
    apiKey,
    model: ai.model,
    systemPrompt: ai.systemPrompt,
    categories: ai.categories,
    thinkingLevel: ai.thinkingLevel,
  });

  try {
    const verdict = await moderator.moderate(text, 20_000);
    return { ok: true, verdict };
  } finally {
    moderator.close();
  }
}

async function fetchTextChannel(client: Client, channelId: string): Promise<TextChannel> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new HttpError(400, `Channel ${channelId} is not a text channel the bot can post in.`);
  }
  return channel as TextChannel;
}

/* ------------------------------------------------------------------ */
/* Request / response plumbing                                         */
/* ------------------------------------------------------------------ */

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON body.'));
      }
    });
  });
}

function assertSameOriginJson(req: IncomingMessage): void {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'Expected application/json.');
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        throw new HttpError(403, 'Cross-origin request rejected.');
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(403, 'Invalid Origin header.');
    }
  }
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function isAuthenticated(
  req: IncomingMessage,
  deps: DashboardDeps,
  sessions: Map<string, Session>,
): boolean {
  if (!deps.password) return true;

  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(res: ServerResponse, pathname: string, publicDir: string, headOnly: boolean): void {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, relative);
  const relativeToRoot = path.relative(publicDir, filePath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    sendJson(res, 403, { error: 'Forbidden.' });
    return;
  }

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }

    const mime = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    if (headOnly) {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}
