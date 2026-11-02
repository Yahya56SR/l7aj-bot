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

interface WarnData {
  id: string;
  userId: string;
  moderatorId: string;
  reason: string;
  createdAt: number;
}

interface DbMeta {
  totalMembers: number;
  ticketCounter: number;         // Auto-incrementing ticket number
  warnCounter: number;           // Auto-incrementing warning number
  taskCounter: number;           // Auto-incrementing task number
}

interface DbData {
  users: { [userId: string]: UserData };
  tickets: { [ticketId: string]: TicketData };
  warns: { [warnId: string]: WarnData };
  meta: DbMeta;
}

let cache: ExtendedDbData = emptyExtendedDb();

function emptyDb(): DbData {
  return { users: {}, tickets: {}, warns: {}, meta: { totalMembers: 0, ticketCounter: 0, warnCounter: 0, taskCounter: 0 } };
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
 * Highest warning number referenced by an existing `W-<n>` id.
 */
function highestWarnNumber(warns: { [warnId: string]: WarnData }): number {
  let highest = 0;
  for (const id of Object.keys(warns)) {
    const match = /^W-(\d+)$/.exec(id);
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
function normaliseDb(raw: any): ExtendedDbData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyExtendedDb();

  // Current / intermediate shape: a `users` object.
  if (raw.users && typeof raw.users === 'object' && !Array.isArray(raw.users)) {
    const users = raw.users as { [userId: string]: UserData };
    const tickets =
      raw.tickets && typeof raw.tickets === 'object' && !Array.isArray(raw.tickets)
        ? (raw.tickets as { [ticketId: string]: TicketData })
        : {};
    const warns =
      raw.warns && typeof raw.warns === 'object' && !Array.isArray(raw.warns)
        ? (raw.warns as { [warnId: string]: WarnData })
        : {};
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};

    return {
      ...emptyExtendedDb(),
      users,
      tickets,
      warns,
      meta: {
        totalMembers: numericOr(meta.totalMembers, Object.keys(users).length),
        ticketCounter: numericOr(meta.ticketCounter, highestTicketNumber(tickets)),
        warnCounter: numericOr(meta.warnCounter, highestWarnNumber(warns)),
        economyCounter: numericOr(meta.economyCounter, 0),
        giveawayCounter: numericOr(meta.giveawayCounter, 0),
        reminderCounter: numericOr(meta.reminderCounter, 0),
        taskCounter: numericOr(meta.taskCounter, 0),
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
    const warns =
      raw.warns && typeof raw.warns === 'object' && !Array.isArray(raw.warns)
        ? (raw.warns as { [warnId: string]: WarnData })
        : {};
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
    return {
      ...emptyExtendedDb(),
      users: {},
      tickets,
      warns,
      meta: {
        totalMembers: numericOr(meta.totalMembers, 0),
        ticketCounter: numericOr(meta.ticketCounter, highestTicketNumber(tickets)),
        warnCounter: numericOr(meta.warnCounter, highestWarnNumber(warns)),
        economyCounter: numericOr(meta.economyCounter, 0),
        giveawayCounter: numericOr(meta.giveawayCounter, 0),
        reminderCounter: numericOr(meta.reminderCounter, 0),
        taskCounter: numericOr(meta.taskCounter, 0),
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
    return emptyExtendedDb();
  }

  return {
    ...emptyExtendedDb(),
    users: raw as { [userId: string]: UserData },
    tickets: {},
    warns: {},
    meta: { totalMembers: Object.keys(raw).length, ticketCounter: 0, warnCounter: 0, economyCounter: 0, giveawayCounter: 0, reminderCounter: 0, taskCounter: 0 },
  };
}

function load(): ExtendedDbData {
  try {
    if (fs.existsSync(dbPath)) {
      return normaliseDb(JSON.parse(fs.readFileSync(dbPath, 'utf8')));
    }
  } catch (err) {
    console.error('Failed to load database:', err);
  }
  return emptyExtendedDb();
}

function save(data: ExtendedDbData): void {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save database:', err);
    throw err;
  }
}

export function initDb(): void {
  cache = load();
  console.log(`Database loaded: ${Object.keys(cache.users).length} users, ${Object.keys(cache.tickets).length} tickets, ${Object.keys(cache.economy).length} economy records, total members tracked: ${cache.meta.totalMembers}`);
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

/* ------------------------------------------------------------------ */
/* Warning functions                                                  */
/* ------------------------------------------------------------------ */

export interface WarnRow {
  id: string;
  userId: string;
  moderatorId: string;
  reason: string;
  createdAt: number;
}

export function addWarning(userId: string, moderatorId: string, reason: string): WarnRow {
  const id = `W-${++cache.meta.warnCounter}`;
  const warn: WarnData = {
    id,
    userId,
    moderatorId,
    reason,
    createdAt: Date.now(),
  };
  cache.warns[id] = warn;
  save(cache);
  return { id, userId, moderatorId, reason, createdAt: warn.createdAt };
}

export function getWarnings(userId: string): WarnRow[] {
  return Object.values(cache.warns)
    .filter((w) => w.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((w) => ({ id: w.id, userId: w.userId, moderatorId: w.moderatorId, reason: w.reason, createdAt: w.createdAt }));
}

export function getWarning(warnId: string): WarnRow | undefined {
  const w = cache.warns[warnId];
  if (!w) return undefined;
  return { id: w.id, userId: w.userId, moderatorId: w.moderatorId, reason: w.reason, createdAt: w.createdAt };
}

export function removeWarning(warnId: string): boolean {
  if (!cache.warns[warnId]) return false;
  delete cache.warns[warnId];
  save(cache);
  return true;
}

export function clearWarnings(userId: string): number {
  let removed = 0;
  for (const [id, w] of Object.entries(cache.warns)) {
    if (w.userId === userId) {
      delete cache.warns[id];
      removed++;
    }
  }
  if (removed > 0) save(cache);
  return removed;
}

export function getWarningCount(): number {
  return Object.keys(cache.warns).length;
}

/* ========================================================================== */
/* Extended schemas (economy, giveaways, reminders, suggestions, AFK, invites,
   temp voice, starboard, anti-nuke)                                         */
/* ========================================================================== */

interface EconomyData {
  balance: number;
  bank: number;
  bankLimit: number;
  dailyStreak: number;
  lastDaily?: number;
  lastWork?: number;
  totalEarned: number;
  inventory: { [itemId: string]: number };
}

interface ShopItemData {
  id: string;
  name: string;
  price: number;
  description: string;
  roleId?: string;
  stock?: number; // undefined = unlimited
}

interface GiveawayData {
  id: string;
  channelId: string;
  messageId: string;
  prize: string;
  winnerCount: number;
  endsAt: number;
  ended: boolean;
  createdAt: number;
  entries: string[]; // user ids who entered
}

interface ReminderData {
  id: string;
  userId: string;
  channelId: string;
  message: string;
  scheduledAt: number;
  sent: boolean;
  createdAt: number;
}

interface SuggestionData {
  messageId: string;
  channelId: string;
  staffChannelId?: string;
  authorId: string;
  content: string;
  status: 'open' | 'approved' | 'denied' | 'noted';
  upvotes: string[];
  downvotes: string[];
  tagApplied?: string;
  notedAt?: number;
  deniedAt?: number;
  staffMessageId?: string;
}

/** Staff TODO task */
interface TaskData {
  id: string;
  title: string;
  description: string;
  status: 'NONE' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
  sourceType: 'suggestion' | 'manual';
  sourceId?: string;
  createdBy: string;
  assignedTo?: string;
  createdAt: number;
  updatedAt: number;
}

interface AfkData {
  userId: string;
  message: string;
  since: number;
}

interface InviteData {
  code: string;
  inviterId: string;
  uses: number;
  reset: boolean;
}

interface TempVCData {
  channelId: string;
  ownerId: string;
  categoryId: string;
  createdAt: number;
}

interface StarboardData {
  channelId: string;
  emoji: string;
  threshold: number;
}

interface AntiNukeData {
  enabled: boolean;
  whitelist: string[]; // user ids exempt
  actions: { role: boolean; channel: boolean; ban: boolean; kick: boolean };
  punishment: 'none' | 'kick' | 'ban' | 'timeout';
}

interface ExtendedMeta {
  totalMembers: number;
  ticketCounter: number;
  warnCounter: number;
  economyCounter: number;
  giveawayCounter: number;
  reminderCounter: number;
  taskCounter: number;
}

interface ExtendedDbData {
  users: { [userId: string]: UserData };
  tickets: { [ticketId: string]: TicketData };
  warns: { [warnId: string]: WarnData };
  economy: { [userId: string]: EconomyData };
  shop: { [itemId: string]: ShopItemData };
  giveaways: { [giveawayId: string]: GiveawayData };
  reminders: { [reminderId: string]: ReminderData };
  suggestions: { [messageId: string]: SuggestionData };
  tasks: { [taskId: string]: TaskData };
  afk: { [userId: string]: AfkData };
  invites: { [code: string]: InviteData };
  tempVC: { [channelId: string]: TempVCData };
  starboard: StarboardData;
  antiNuke: AntiNukeData;
  meta: ExtendedMeta;
}

function emptyExtendedDb(): ExtendedDbData {
  return {
    users: {},
    tickets: {},
    warns: {},
    economy: {},
    shop: {},
    giveaways: {},
    reminders: {},
    suggestions: {},
    tasks: {},
    afk: {},
    invites: {},
    tempVC: {},
    starboard: { channelId: '', emoji: '⭐', threshold: 3 },
    antiNuke: {
      enabled: false,
      whitelist: [],
      actions: { role: true, channel: true, ban: true, kick: true },
      punishment: 'none',
    },
    meta: {
      totalMembers: 0,
      ticketCounter: 0,
      warnCounter: 0,
      economyCounter: 0,
      giveawayCounter: 0,
      reminderCounter: 0,
      taskCounter: 0,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Economy                                                            */
/* ------------------------------------------------------------------ */

export function getEconomy(userId: string): EconomyData {
  let data = cache.economy[userId];
  if (!data) {
    data = {
      balance: 0,
      bank: 0,
      bankLimit: 1000,
      dailyStreak: 0,
      totalEarned: 0,
      inventory: {},
    };
    cache.economy[userId] = data;
    save(cache);
  }
  return data;
}

export function setEconomy(userId: string, data: EconomyData): void {
  cache.economy[userId] = data;
  save(cache);
}

export function addBalance(userId: string, amount: number): { balance: number } {
  const data = getEconomy(userId);
  data.balance = Math.max(0, Math.floor(data.balance + amount));
  data.totalEarned = Math.max(0, Math.floor(data.totalEarned + Math.max(0, amount)));
  cache.economy[userId] = data;
  save(cache);
  return { balance: data.balance };
}

export function removeBalance(userId: string, amount: number): { success: boolean; balance: number } {
  const data = getEconomy(userId);
  if (data.balance < amount) return { success: false, balance: data.balance };
  data.balance = Math.floor(data.balance - amount);
  cache.economy[userId] = data;
  save(cache);
  return { success: true, balance: data.balance };
}

export function addBank(userId: string, amount: number): { bank: number; bankLimit: number } {
  const data = getEconomy(userId);
  data.bank = Math.max(0, Math.floor(data.bank + amount));
  cache.economy[userId] = data;
  save(cache);
  return { bank: data.bank, bankLimit: data.bankLimit };
}

export function addInventoryItem(userId: string, itemId: string, count = 1): void {
  const data = getEconomy(userId);
  data.inventory[itemId] = (data.inventory[itemId] || 0) + count;
  cache.economy[userId] = data;
  save(cache);
}

export function removeInventoryItem(userId: string, itemId: string, count = 1): boolean {
  const data = getEconomy(userId);
  const current = data.inventory[itemId] || 0;
  if (current < count) return false;
  if (current === count) delete data.inventory[itemId];
  else data.inventory[itemId] = current - count;
  cache.economy[userId] = data;
  save(cache);
  return true;
}

export function getShopItem(itemId: string): ShopItemData | undefined {
  return cache.shop[itemId];
}

export function listShopItems(): ShopItemData[] {
  return Object.values(cache.shop);
}

export function addShopItem(item: ShopItemData): void {
  cache.shop[item.id] = item;
  save(cache);
}

export function removeShopItem(itemId: string): boolean {
  if (!cache.shop[itemId]) return false;
  delete cache.shop[itemId];
  save(cache);
  return true;
}

/* ------------------------------------------------------------------ */
/* Giveaways                                                          */
/* ------------------------------------------------------------------ */

export function createGiveaway(giveaway: Omit<GiveawayData, 'id'>): GiveawayData {
  const id = `G-${++cache.meta.giveawayCounter}`;
  const data: GiveawayData = { id, ...giveaway, ended: false, entries: [] };
  cache.giveaways[id] = data;
  save(cache);
  return data;
}

export function getGiveaway(giveawayId: string): GiveawayData | undefined {
  return cache.giveaways[giveawayId];
}

export function listGiveaways(onlyOpen = false): GiveawayData[] {
  return Object.values(cache.giveaways)
    .filter((g) => !onlyOpen || !g.ended)
    .sort((a, b) => a.endsAt - b.endsAt);
}

export function enterGiveaway(giveawayId: string, userId: string): boolean {
  const g = cache.giveaways[giveawayId];
  if (!g || g.ended) return false;
  if (g.entries.includes(userId)) return false;
  g.entries.push(userId);
  cache.giveaways[giveawayId] = g;
  save(cache);
  return true;
}

export function endGiveaway(giveawayId: string): string[] | null {
  const g = cache.giveaways[giveawayId];
  if (!g || g.ended) return null;
  g.ended = true;
  const winners: string[] = [];
  const pool = [...g.entries];
  for (let i = 0; i < g.winnerCount && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }
  cache.giveaways[giveawayId] = g;
  save(cache);
  return winners;
}

export function deleteGiveaway(giveawayId: string): boolean {
  if (!cache.giveaways[giveawayId]) return false;
  delete cache.giveaways[giveawayId];
  save(cache);
  return true;
}

export function updateGiveaway(giveawayId: string, updates: Partial<GiveawayData>): boolean {
  const g = cache.giveaways[giveawayId];
  if (!g) return false;
  cache.giveaways[giveawayId] = { ...g, ...updates };
  save(cache);
  return true;
}

export function getGiveawayByMessageId(messageId: string): GiveawayData | undefined {
  return Object.values(cache.giveaways).find((g) => g.messageId === messageId);
}

/* ------------------------------------------------------------------ */
/* Reminders                                                          */
/* ------------------------------------------------------------------ */

export function createReminder(reminder: Omit<ReminderData, 'id'>): ReminderData {
  const id = `R-${++cache.meta.reminderCounter}`;
  const data: ReminderData = { id, ...reminder, sent: false, createdAt: Date.now() };
  cache.reminders[id] = data;
  save(cache);
  return data;
}

export function getReminder(reminderId: string): ReminderData | undefined {
  return cache.reminders[reminderId];
}

export function listReminders(userId: string, onlyUnsent = false): ReminderData[] {
  return Object.values(cache.reminders)
    .filter((r) => r.userId === userId && (!onlyUnsent || !r.sent))
    .sort((a, b) => a.scheduledAt - b.scheduledAt);
}

export function markReminderSent(reminderId: string): boolean {
  const r = cache.reminders[reminderId];
  if (!r) return false;
  r.sent = true;
  cache.reminders[reminderId] = r;
  save(cache);
  return true;
}

export function deleteReminder(reminderId: string): boolean {
  if (!cache.reminders[reminderId]) return false;
  delete cache.reminders[reminderId];
  save(cache);
  return true;
}

export function getDueReminders(now = Date.now()): ReminderData[] {
  return Object.values(cache.reminders).filter((r) => !r.sent && r.scheduledAt <= now);
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                        */
/* ------------------------------------------------------------------ */

export function setSuggestion(data: SuggestionData): void {
  cache.suggestions[data.messageId] = { ...data };
  save(cache);
}

export function getSuggestion(messageId: string): SuggestionData | undefined {
  return cache.suggestions[messageId];
}

export function listSuggestions(status?: string): SuggestionData[] {
  return Object.values(cache.suggestions)
    .filter((s) => !status || s.status === status)
    .sort((a, b) => b.upvotes.length - a.upvotes.length);
}

export function listSuggestionsByVotes(
  status?: string,
  sortBy: 'up' | 'down' | 'net' = 'net',
): SuggestionData[] {
  return Object.values(cache.suggestions)
    .filter((s) => !status || s.status === status)
    .sort((a, b) => {
      const aUp = a.upvotes.length;
      const aDown = a.downvotes.length;
      const bUp = b.upvotes.length;
      const bDown = b.downvotes.length;
      if (sortBy === 'up') return bUp - aUp;
      if (sortBy === 'down') return bDown - aDown;
      return (bUp - bDown) - (aUp - aDown);
    });
}

export function updateSuggestionStatus(messageId: string, status: string): boolean {
  const s = cache.suggestions[messageId];
  if (!s) return false;
  s.status = status as SuggestionData['status'];
  cache.suggestions[messageId] = s;
  save(cache);
  return true;
}

export function setSuggestionTag(
  messageId: string,
  tag: string,
  staffChannelId?: string,
  staffMessageId?: string,
): boolean {
  const s = cache.suggestions[messageId];
  if (!s) return false;
  s.tagApplied = tag;
  if (tag === 'NOTED') {
    s.status = 'noted';
    s.notedAt = Date.now();
  } else if (tag === 'DENIED') {
    s.status = 'denied';
    s.deniedAt = Date.now();
  } else if (tag === 'APPROVED') {
    s.status = 'approved';
  }
  if (staffChannelId) s.staffChannelId = staffChannelId;
  if (staffMessageId) s.staffMessageId = staffMessageId;
  cache.suggestions[messageId] = s;
  save(cache);
  return true;
}

export function updateSuggestionVotes(
  messageId: string,
  userId: string,
  vote: 'up' | 'down',
): { up: number; down: number } | null {
  const s = cache.suggestions[messageId];
  if (!s) return null;
  s.upvotes = s.upvotes.filter((id) => id !== userId);
  s.downvotes = s.downvotes.filter((id) => id !== userId);
  if (vote === 'up') s.upvotes.push(userId);
  else s.downvotes.push(userId);
  cache.suggestions[messageId] = s;
  save(cache);
  return { up: s.upvotes.length, down: s.downvotes.length };
}

export function removeSuggestionVote(messageId: string, userId: string): boolean {
  const s = cache.suggestions[messageId];
  if (!s) return false;
  s.upvotes = s.upvotes.filter((id) => id !== userId);
  s.downvotes = s.downvotes.filter((id) => id !== userId);
  cache.suggestions[messageId] = s;
  save(cache);
  return true;
}

export function deleteSuggestion(messageId: string): boolean {
  if (!cache.suggestions[messageId]) return false;
  delete cache.suggestions[messageId];
  save(cache);
  return true;
}

/* ------------------------------------------------------------------ */
/* Staff TODO tasks                                                   */
/* ------------------------------------------------------------------ */

export function addTask(data: Omit<TaskData, 'id' | 'createdAt' | 'updatedAt'>): TaskData {
  const id = `T-${++cache.meta.taskCounter}`;
  const task: TaskData = {
    id,
    ...data,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  cache.tasks[id] = task;
  save(cache);
  return task;
}

export function getTask(taskId: string): TaskData | undefined {
  return cache.tasks[taskId];
}

export function listTasks(status?: TaskData['status']): TaskData[] {
  return Object.values(cache.tasks)
    .filter((t) => !status || t.status === status)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function updateTaskStatus(taskId: string, status: TaskData['status']): boolean {
  const t = cache.tasks[taskId];
  if (!t) return false;
  t.status = status;
  t.updatedAt = Date.now();
  cache.tasks[taskId] = t;
  save(cache);
  return true;
}

export function updateTask(taskId: string, updates: Partial<TaskData>): boolean {
  const t = cache.tasks[taskId];
  if (!t) return false;
  cache.tasks[taskId] = { ...t, ...updates, updatedAt: Date.now() };
  save(cache);
  return true;
}

export function deleteTask(taskId: string): boolean {
  if (!cache.tasks[taskId]) return false;
  delete cache.tasks[taskId];
  save(cache);
  return true;
}

/* ------------------------------------------------------------------ */
/* AFK                                                                */
/* ------------------------------------------------------------------ */

export function setAfk(userId: string, message: string): void {
  cache.afk[userId] = { userId, message, since: Date.now() };
  save(cache);
}

export function getAfk(userId: string): AfkData | undefined {
  return cache.afk[userId];
}

export function removeAfk(userId: string): boolean {
  if (!cache.afk[userId]) return false;
  delete cache.afk[userId];
  save(cache);
  return true;
}

/* ------------------------------------------------------------------ */
/* Invites                                                            */
/* ------------------------------------------------------------------ */

export function setInvite(data: InviteData): void {
  cache.invites[data.code] = data;
  save(cache);
}

export function getInvite(code: string): InviteData | undefined {
  return cache.invites[code];
}

export function listInvites(): InviteData[] {
  return Object.values(cache.invites);
}

export function deleteInvite(code: string): boolean {
  if (!cache.invites[code]) return false;
  delete cache.invites[code];
  save(cache);
  return true;
}

/* ------------------------------------------------------------------ */
/* Temporary voice channels                                           */
/* ------------------------------------------------------------------ */

export function setTempVC(data: TempVCData): void {
  cache.tempVC[data.channelId] = data;
  save(cache);
}

export function getTempVC(channelId: string): TempVCData | undefined {
  return cache.tempVC[channelId];
}

export function listTempVC(): TempVCData[] {
  return Object.values(cache.tempVC);
}

export function deleteTempVC(channelId: string): boolean {
  if (!cache.tempVC[channelId]) return false;
  delete cache.tempVC[channelId];
  save(cache);
  return true;
}

/* ------------------------------------------------------------------ */
/* Starboard                                                          */
/* ------------------------------------------------------------------ */

export function getStarboard(): StarboardData {
  return cache.starboard;
}

export function setStarboard(data: Partial<StarboardData>): void {
  cache.starboard = { ...cache.starboard, ...data };
  save(cache);
}

/* ------------------------------------------------------------------ */
/* Anti-nuke                                                          */
/* ------------------------------------------------------------------ */

export function getAntiNuke(): AntiNukeData {
  return cache.antiNuke;
}

export function setAntiNuke(data: Partial<AntiNukeData>): void {
  cache.antiNuke = { ...cache.antiNuke, ...data };
  save(cache);
}

/* ------------------------------------------------------------------ */
/* Legacy migration handled inline by normaliseDb                     */
/* ------------------------------------------------------------------ */
