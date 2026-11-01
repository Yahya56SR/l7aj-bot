/**
 * Persistent storage for L7aj's autonomous capabilities:
 *  - Scheduled messages (survive restarts)
 *  - Community knowledge (server rules, FAQ, announcements, events)
 *
 * Stored next to the existing XP database in `data/l7aj-tools.json`.
 * Writes are synchronous and best-effort: a broken file must never stop the
 * bot from operating.
 */
import fs from 'fs';
import path from 'path';

const storagePath = path.join(__dirname, '..', '..', 'data', 'l7aj-tools.json');
const MAX_SCHEDULED = 200;
const MAX_FAQ = 200;
const MAX_ANNOUNCEMENTS = 100;
const MAX_EVENTS = 100;

interface ScheduledMessage {
  id: string;
  guildId: string;
  channelId: string;
  content: string;
  scheduledAt: number;
  status: 'pending' | 'sent' | 'cancelled';
  createdBy: string;
  createdAt: number;
  sentAt?: number;
}

interface FaqEntry {
  id: string;
  guildId: string;
  question: string;
  answer: string;
  category?: string;
  createdAt: number;
  updatedAt?: number;
}

interface Announcement {
  id: string;
  guildId: string;
  channelId: string;
  title: string;
  content: string;
  postedAt?: number;
  createdAt: number;
  createdBy: string;
}

interface ServerEvent {
  id: string;
  guildId: string;
  title: string;
  description: string;
  startsAt: number;
  endsAt?: number;
  channelId?: string;
  createdAt: number;
  createdBy: string;
}

interface ServerRules {
  guildId: string;
  rules: Array<{ id: string; title: string; content: string }>;
  updatedAt: number;
}

interface ToolsDb {
  version: number;
  scheduled: Record<string, ScheduledMessage[]>;
  faq: Record<string, FaqEntry[]>;
  announcements: Record<string, Announcement[]>;
  events: Record<string, ServerEvent[]>;
  rules: Record<string, ServerRules>;
}

let cache: ToolsDb | null = null;
let seq = 0;

function load(): ToolsDb {
  if (cache) return cache;

  try {
    if (fs.existsSync(storagePath)) {
      const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf8')) as Partial<ToolsDb>;
      cache = {
        version: 1,
        scheduled: parsed.scheduled ?? {},
        faq: parsed.faq ?? {},
        announcements: parsed.announcements ?? {},
        events: parsed.events ?? {},
        rules: parsed.rules ?? {},
      };
    } else {
      cache = { version: 1, scheduled: {}, faq: {}, announcements: {}, events: {}, rules: {} };
    }
  } catch (err) {
    console.error('[L7aj tools] Failed to load storage, starting empty:', err);
    cache = { version: 1, scheduled: {}, faq: {}, announcements: {}, events: {}, rules: {} };
  }

  return cache;
}

function save(db: ToolsDb): void {
  try {
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    fs.writeFileSync(storagePath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[L7aj tools] Failed to save storage:', err);
  }
}

function nextId(): string {
  seq = (seq + 1) % 10000;
  return `t${Date.now().toString(36)}${seq.toString(36).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Scheduled messages                                                 */
/* ------------------------------------------------------------------ */

export interface CreateScheduledMessageInput {
  guildId: string;
  channelId: string;
  content: string;
  scheduledAt: number;
  createdBy: string;
}

/** Create a scheduled message. Returns the new record or null on failure. */
export function createScheduledMessage(input: CreateScheduledMessageInput): ScheduledMessage | null {
  if (!input.content || !input.content.trim()) return null;
  if (input.scheduledAt <= Date.now()) return null;

  const db = load();
  const list = (db.scheduled[input.guildId] ??= []);
  if (list.length >= MAX_SCHEDULED) return null;

  const record: ScheduledMessage = {
    id: nextId(),
    guildId: input.guildId,
    channelId: input.channelId,
    content: input.content.trim().slice(0, 1900),
    scheduledAt: input.scheduledAt,
    status: 'pending',
    createdBy: input.createdBy,
    createdAt: Date.now(),
  };

  list.push(record);
  save(db);
  return record;
}

/** Cancel a pending scheduled message by id. Returns true if cancelled. */
export function cancelScheduledMessage(guildId: string, id: string): boolean {
  const db = load();
  const list = db.scheduled[guildId];
  if (!list) return false;

  const record = list.find((r) => r.id === id);
  if (!record || record.status !== 'pending') return false;

  record.status = 'cancelled';
  save(db);
  return true;
}

/** List pending scheduled messages for a guild, oldest first. */
export function listScheduledMessages(guildId: string): ScheduledMessage[] {
  const db = load();
  const list = db.scheduled[guildId] ?? [];
  return [...list]
    .filter((r) => r.status === 'pending')
    .sort((a, b) => a.scheduledAt - b.scheduledAt);
}

/** Find pending scheduled messages due to be sent (now or earlier). */
export function dueScheduledMessages(now: number = Date.now()): ScheduledMessage[] {
  const db = load();
  const due: ScheduledMessage[] = [];
  for (const list of Object.values(db.scheduled)) {
    for (const record of list) {
      if (record.status === 'pending' && record.scheduledAt <= now) {
        due.push(record);
      }
    }
  }
  return due.sort((a, b) => a.scheduledAt - b.scheduledAt);
}

/** Mark a scheduled message as sent. */
export function markScheduledMessageSent(guildId: string, id: string): boolean {
  const db = load();
  const list = db.scheduled[guildId];
  if (!list) return false;

  const record = list.find((r) => r.id === id);
  if (!record || record.status !== 'pending') return false;

  record.status = 'sent';
  record.sentAt = Date.now();
  save(db);
  return true;
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                */
/* ------------------------------------------------------------------ */

export interface CreateFaqInput {
  guildId: string;
  question: string;
  answer: string;
  category?: string;
}

export function createFaqEntry(input: CreateFaqInput): FaqEntry | null {
  if (!input.question || !input.question.trim() || !input.answer || !input.answer.trim()) {
    return null;
  }

  const db = load();
  const list = (db.faq[input.guildId] ??= []);
  if (list.length >= MAX_FAQ) return null;

  const entry: FaqEntry = {
    id: nextId(),
    guildId: input.guildId,
    question: input.question.trim().slice(0, 300),
    answer: input.answer.trim().slice(0, 2000),
    category: input.category?.trim().slice(0, 80) || undefined,
    createdAt: Date.now(),
  };

  list.push(entry);
  save(db);
  return entry;
}

export function updateFaqEntry(guildId: string, id: string, updates: Partial<Pick<FaqEntry, 'question' | 'answer' | 'category'>>): FaqEntry | null {
  const db = load();
  const list = db.faq[guildId];
  if (!list) return null;

  const entry = list.find((e) => e.id === id);
  if (!entry) return null;

  if (updates.question !== undefined) entry.question = updates.question.trim().slice(0, 300);
  if (updates.answer !== undefined) entry.answer = updates.answer.trim().slice(0, 2000);
  if (updates.category !== undefined) entry.category = updates.category?.trim().slice(0, 80) || undefined;
  entry.updatedAt = Date.now();

  save(db);
  return entry;
}

export function deleteFaqEntry(guildId: string, id: string): boolean {
  const db = load();
  const list = db.faq[guildId];
  if (!list) return false;

  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return false;

  list.splice(idx, 1);
  save(db);
  return true;
}

export function searchFaq(guildId: string, query: string, limit = 10): FaqEntry[] {
  const db = load();
  const list = db.faq[guildId] ?? [];
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, limit);

  const matches = list.filter(
    (e) =>
      e.question.toLowerCase().includes(q) ||
      e.answer.toLowerCase().includes(q) ||
      (e.category && e.category.toLowerCase().includes(q)),
  );
  return matches.slice(0, limit);
}

export function listFaq(guildId: string): FaqEntry[] {
  const db = load();
  return [...(db.faq[guildId] ?? [])].sort((a, b) => b.createdAt - a.createdAt);
}

/* ------------------------------------------------------------------ */
/* Announcements                                                      */
/* ------------------------------------------------------------------ */

export interface CreateAnnouncementInput {
  guildId: string;
  channelId: string;
  title: string;
  content: string;
  createdBy: string;
}

export function createAnnouncement(input: CreateAnnouncementInput): Announcement | null {
  if (!input.title || !input.title.trim() || !input.content || !input.content.trim()) {
    return null;
  }

  const db = load();
  const list = (db.announcements[input.guildId] ??= []);
  if (list.length >= MAX_ANNOUNCEMENTS) return null;

  const record: Announcement = {
    id: nextId(),
    guildId: input.guildId,
    channelId: input.channelId,
    title: input.title.trim().slice(0, 200),
    content: input.content.trim().slice(0, 4000),
    createdAt: Date.now(),
    createdBy: input.createdBy,
  };

  list.push(record);
  save(db);
  return record;
}

export function listAnnouncements(guildId: string): Announcement[] {
  const db = load();
  return [...(db.announcements[guildId] ?? [])].sort((a, b) => b.createdAt - a.createdAt);
}

/* ------------------------------------------------------------------ */
/* Server events                                                      */
/* ------------------------------------------------------------------ */

export interface CreateEventInput {
  guildId: string;
  title: string;
  description: string;
  startsAt: number;
  endsAt?: number;
  channelId?: string;
  createdBy: string;
}

export function createServerEvent(input: CreateEventInput): ServerEvent | null {
  if (!input.title || !input.title.trim() || !input.startsAt) return null;

  const db = load();
  const list = (db.events[input.guildId] ??= []);
  if (list.length >= MAX_EVENTS) return null;

  const record: ServerEvent = {
    id: nextId(),
    guildId: input.guildId,
    title: input.title.trim().slice(0, 200),
    description: input.description.trim().slice(0, 2000),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    channelId: input.channelId,
    createdAt: Date.now(),
    createdBy: input.createdBy,
  };

  list.push(record);
  save(db);
  return record;
}

export function listServerEvents(guildId: string): ServerEvent[] {
  const db = load();
  return [...(db.events[guildId] ?? [])].sort((a, b) => a.startsAt - b.startsAt);
}

/* ------------------------------------------------------------------ */
/* Server rules                                                       */
/* ------------------------------------------------------------------ */

export interface UpsertRulesInput {
  guildId: string;
  rules: Array<{ id: string; title: string; content: string }>;
}

export function upsertServerRules(input: UpsertRulesInput): ServerRules | null {
  if (!input.rules || input.rules.length === 0) return null;

  const db = load();
  const existing = db.rules[input.guildId];
  const record: ServerRules = {
    guildId: input.guildId,
    rules: input.rules.map((r) => ({
      id: r.id || nextId(),
      title: r.title.trim().slice(0, 100),
      content: r.content.trim().slice(0, 2000),
    })),
    updatedAt: Date.now(),
  };

  if (existing) {
    record.rules = [...existing.rules, ...record.rules];
  }

  db.rules[input.guildId] = record;
  save(db);
  return record;
}

export function getServerRules(guildId: string): ServerRules | null {
  const db = load();
  return db.rules[guildId] ?? null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

export function countScheduled(guildId: string): number {
  const db = load();
  return (db.scheduled[guildId] ?? []).filter((r) => r.status === 'pending').length;
}
