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

interface DbMeta {
  totalMembers: number;
}

interface DbData {
  users: { [userId: string]: UserData };
  meta: DbMeta;
}

let cache: DbData = { users: {}, meta: { totalMembers: 0 } };

function load(): DbData {
  try {
    if (fs.existsSync(dbPath)) {
      const loaded = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      // Handle legacy format (direct user object)
      if (loaded.users) {
        return loaded;
      }
      // Migrate legacy format
      return { users: loaded, meta: { totalMembers: Object.keys(loaded).length } };
    }
  } catch (err) {
    console.error('Failed to load database:', err);
  }
  return { users: {}, meta: { totalMembers: 0 } };
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
  console.log(`Database loaded: ${Object.keys(cache.users).length} users, total members tracked: ${cache.meta.totalMembers}`);
}

export interface UserRow {
  user_id: string;
  xp: number;
  level: number;
  last_msg_ts: number;
  voice_minutes: number;
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

export function addXp(userId: string, amount: number, source: string): {
  leveledUp: boolean;
  newLevel: number;
  oldLevel: number;
} {
  const user = ensureUser(userId);
  const oldLevel = user.level;
  const newXp = user.xp + amount;
  const newLevel = levelFromXp(newXp).level;

  cache.users[userId] = {
    xp: newXp,
    level: newLevel,
    last_msg_ts: user.last_msg_ts,
    voice_minutes: user.voice_minutes,
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