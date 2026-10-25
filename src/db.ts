import path from 'path';
import fs from 'fs';
import { levelFromXp } from './utils/level';

const dbPath = path.join(__dirname, '..', 'data', 'talaba.json');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

interface UserData {
  xp: number;
  level: number;
  last_msg_ts: number;
  voice_minutes: number;
}

interface TicketData {
  id: string;
  channelId: string;
  panelId: string;
  creatorId: string;
  claimedBy?: string;
  status: 'open' | 'closed' | 'claimed';
  createdAt: number;
  closedAt?: number;
  closedBy?: string;
  closeReason?: string;
  formResponses: TicketFormResponse[];
  lastActivity: number;
  transcriptUrl?: string;
}

interface DbMeta {
  totalMembers: number;
  ticketCounter: number;         // Auto-incrementing ticket number
}

interface DbData {
  users: { [userId: string]: UserData };
  tickets: { [ticketId: string]: TicketData };
  meta: DbMeta;
}

let cache: DbData = { users: {}, tickets: {}, meta: { totalMembers: 0, ticketCounter: 0 } };

function emptyDb(): DbData {
  return { users: {}, tickets: {}, meta: { totalMembers: 0, ticketCounter: 0 } };
}

function numericOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Highest ticket number referenced by an existing `T-<n>` id. */
function highestTicketNumber(tickets: { [ticketId: string]: TicketData }): number {
  let highest = 0;
  for (const id of Object.keys(tickets)) {
    const match = /^T-(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, parseInt(match[1], 10));
  }
  return highest;
}

/**
 * Normalise whatever is on disk into the current shape.
 *
 * Handles three historical formats:
 *   1. `{ users, tickets, meta }` (current)
 *   2. `{ users }` with no tickets/meta (intermediate)
 *   3. a bare `{ [userId]: UserData }` map (legacy)
 *
 * Everything missing is defaulted instead of discarding the file, so a
 * partially-written/older database is never replaced with an empty one.
 */
function normaliseDb(raw: any): DbData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyDb();

  // Current / intermediate shape: a `users` object.
  if (raw.users && typeof raw.users === 'object' && !Array.isArray(raw.users)) {
    const users = raw.users as { [userId: string]: UserData };
    const tickets =
      raw.tickets && typeof raw.tickets === 'object' && !Array.isArray(raw.tickets)
        ? (raw.tickets as { [ticketId: string]: TicketData })
        : {};
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};

    return {
      users,
      tickets,
      meta: {
        totalMembers: numericOr(meta.totalMembers, Object.keys(users).length),
        ticketCounter: numericOr(meta.ticketCounter, highestTicketNumber(tickets)),
      },
    };
  }

  // A current-shape file with a missing/empty `users` key: keep tickets/meta
  // instead of misreading them as user records.
  if ('tickets' in raw || 'meta' in raw) {
    const tickets =
      raw.tickets && typeof raw.tickets === 'object' && !Array.isArray(raw.tickets)
        ? (raw.tickets as { [ticketId: string]: TicketData })
        : {};
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
    return {
      users: {},
      tickets,
      meta: {
        totalMembers: numericOr(meta.totalMembers, 0),
        ticketCounter: numericOr(meta.ticketCounter, highestTicketNumber(tickets)),
      },
    };
  }

  // Legacy shape: the file itself is the user map. Only treat it as such when
  // every entry actually looks like a user record.
  const entries = Object.values(raw);
  const looksLikeUsers =
    entries.length === 0 ||
    entries.every(
      (value) => value && typeof value === 'object' && typeof (value as { xp?: unknown }).xp === 'number',
    );

  if (!looksLikeUsers) {
    console.error('Database file has an unrecognised shape; starting with an empty store.');
    return emptyDb();
  }

  return {
    users: raw as { [userId: string]: UserData },
    tickets: {},
    meta: { totalMembers: Object.keys(raw).length, ticketCounter: 0 },
  };
}

function load(): DbData {
  try {
    if (fs.existsSync(dbPath)) {
      return normaliseDb(JSON.parse(fs.readFileSync(dbPath, 'utf8')));
    }
  } catch (err) {
    console.error('Failed to load database:', err);
  }
  return emptyDb();
}

function save(data: DbData): void {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save database:', err);
    throw err;
  }
}

export function initDb(): void {
  cache = load();
  console.log(`Database loaded: ${Object.keys(cache.users).length} users, ${Object.keys(cache.tickets).length} tickets, total members tracked: ${cache.meta.totalMembers}`);
}

export interface UserRow {
  user_id: string;
  xp: number;
  level: number;
  last_msg_ts: number;
  voice_minutes: number;
}

export interface TicketRow {
  id: string;
  channelId: string;
  panelId: string;
  creatorId: string;
  claimedBy?: string;
  status: 'open' | 'closed' | 'claimed';
  createdAt: number;
  closedAt?: number;
  closedBy?: string;
  closeReason?: string;
  formResponses: TicketFormResponse[];
  lastActivity: number;
  transcriptUrl?: string;
}

export interface TicketFormResponse {
  fieldId: string;
  label: string;
  value: string;
}

export function getUser(userId: string): UserRow | undefined {
  const u = cache.users[userId];
  if (!u) return undefined;
  return { user_id: userId, ...u } as UserRow;
}

export function ensureUser(userId: string): UserRow {
  if (!cache.users[userId]) {
    cache.users[userId] = { xp: 0, level: 0, last_msg_ts: 0, voice_minutes: 0 };
    save(cache);
  }
  return getUser(userId)!;
}

export function addXp(userId: string, amount: number, source: string, voiceMinutes: number = 0): {
  leveledUp: boolean;
  newLevel: number;
  oldLevel: number;
} {
  const user = ensureUser(userId);
  // Derived from the XP total rather than trusted from the row: legacy/dashboard
  // edits can leave `level` out of sync with `xp`, and a stale (too high) level
  // would swallow every future level-up, so no reward role would ever be given.
  const baseXp = Number.isFinite(user.xp) ? Math.max(0, Math.floor(user.xp)) : 0;
  const oldLevel = levelFromXp(baseXp).level;
  const granted = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  const newXp = baseXp + granted;
  const newLevel = levelFromXp(newXp).level;
  const addedMinutes = Number.isFinite(voiceMinutes) ? Math.max(0, Math.floor(voiceMinutes)) : 0;
  const baseVoiceMinutes = Number.isFinite(user.voice_minutes)
    ? Math.max(0, user.voice_minutes)
    : 0;

  cache.users[userId] = {
    xp: newXp,
    level: newLevel,
    // Persisted so the message XP cooldown survives a restart.
    last_msg_ts: source === 'message' ? Date.now() : user.last_msg_ts,
    voice_minutes: baseVoiceMinutes + addedMinutes,
  };
  save(cache);

  return { leveledUp: newLevel > oldLevel, newLevel, oldLevel };
}

export function setVoiceMinutes(userId: string, minutes: number): void {
  ensureUser(userId);
  const u = cache.users[userId];
  cache.users[userId] = { ...u, voice_minutes: minutes };
  save(cache);
}

export function getLeaderboard(limit: number = 10): UserRow[] {
  return Object.entries(cache.users)
    .map(([user_id, u]) => ({ user_id, ...u }) as UserRow)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit);
}

/**
 * 1-based position of a user on the XP leaderboard.
 */
export function getRankPosition(userId: string): number {
  const user = getUser(userId);
  if (!user) return 0;

  let position = 1;
  for (const [id, u] of Object.entries(cache.users)) {
    if (id !== userId && u.xp > user.xp) position++;
  }
  return position;
}

/**
 * How many members have an XP record (i.e. are ranked).
 */
export function countRanked(): number {
  return Object.keys(cache.users).length;
}

/**
 * Get the total member count (includes members who left/kicked/banned).
 * This increments the counter and returns the new value.
 */
export function incrementTotalMembers(): number {
  cache.meta.totalMembers++;
  save(cache);
  return cache.meta.totalMembers;
}

/**
 * Get the current total member count without incrementing.
 */
export function getTotalMemberCount(): number {
  return cache.meta.totalMembers;
}

/**
 * Initialize total member count from current guild member count (for migration).
 */
export function initializeTotalMembers(count: number): void {
  if (cache.meta.totalMembers === 0) {
    cache.meta.totalMembers = count;
    save(cache);
  }
}

/* ------------------------------------------------------------------ */
/* Ticket functions                                                    */
/* ------------------------------------------------------------------ */

export function getNextTicketNumber(): number {
  cache.meta.ticketCounter++;
  save(cache);
  return cache.meta.ticketCounter;
}

export function createTicket(ticket: TicketRow): TicketRow {
  cache.tickets[ticket.id] = ticket;
  save(cache);
  return ticket;
}

export function getTicket(ticketId: string): TicketRow | undefined {
  return cache.tickets[ticketId];
}

export function getTicketByChannel(channelId: string): TicketRow | undefined {
  for (const ticket of Object.values(cache.tickets)) {
    if (ticket.channelId === channelId) return ticket;
  }
  return undefined;
}

export function getTicketsByCreator(creatorId: string): TicketRow[] {
  return Object.values(cache.tickets)
    .filter(t => t.creatorId === creatorId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getTicketsByPanel(panelId: string): TicketRow[] {
  return Object.values(cache.tickets)
    .filter(t => t.panelId === panelId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getOpenTickets(): TicketRow[] {
  return Object.values(cache.tickets)
    .filter(t => t.status === 'open' || t.status === 'claimed')
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function updateTicket(ticketId: string, updates: Partial<TicketRow>): TicketRow | undefined {
  const ticket = cache.tickets[ticketId];
  if (!ticket) return undefined;
  cache.tickets[ticketId] = { ...ticket, ...updates };
  save(cache);
  return cache.tickets[ticketId];
}

export function updateTicketActivity(ticketId: string): void {
  const ticket = cache.tickets[ticketId];
  if (ticket) {
    ticket.lastActivity = Date.now();
    save(cache);
  }
}

export function closeTicket(ticketId: string, closedBy: string, reason?: string, transcriptUrl?: string): TicketRow | undefined {
  const ticket = cache.tickets[ticketId];
  if (!ticket) return undefined;
  ticket.status = 'closed';
  ticket.closedAt = Date.now();
  ticket.closedBy = closedBy;
  ticket.closeReason = reason;
  if (transcriptUrl) ticket.transcriptUrl = transcriptUrl;
  save(cache);
  return ticket;
}

export function claimTicket(ticketId: string, claimedBy: string): TicketRow | undefined {
  const ticket = cache.tickets[ticketId];
  if (!ticket) return undefined;
  if (ticket.status === 'closed') return undefined;
  ticket.status = 'claimed';
  ticket.claimedBy = claimedBy;
  save(cache);
  return ticket;
}

export function unclaimTicket(ticketId: string): TicketRow | undefined {
  const ticket = cache.tickets[ticketId];
  if (!ticket) return undefined;
  ticket.status = 'open';
  ticket.claimedBy = undefined;
  save(cache);
  return ticket;
}

export function deleteTicket(ticketId: string): boolean {
  if (!cache.tickets[ticketId]) return false;
  delete cache.tickets[ticketId];
  save(cache);
  return true;
}

export function getAllTickets(): TicketRow[] {
  return Object.values(cache.tickets).sort((a, b) => b.createdAt - a.createdAt);
}

export function getTicketCount(): number {
  return Object.keys(cache.tickets).length;
}