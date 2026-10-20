/**
 * MEE6-compatible level math.
 *
 * XP required to advance from `level` to `level + 1`:
 *     5 * level^2 + 50 * level + 100
 *
 * MEE6 reference table:
 *   Level 0  -> 1  : 100 XP     (total 0)
 *   Level 1  -> 2  : 155 XP     (total 100)
 *   Level 2  -> 3  : 220 XP     (total 255)
 *   Level 5  -> 6  : 475 XP     (total 1,150)
 *   Level 10 -> 11 : 1,100 XP   (total 4,675)
 *   Level 20 -> 21 : 3,100 XP   (total 23,850)
 */

export interface LevelInfo {
  /** Current level */
  level: number;
  /** XP earned within the current level */
  xpInLevel: number;
  /** XP required to reach the next level */
  xpForNext: number;
  /** Total XP accumulated */
  totalXp: number;
}

/** XP needed to advance from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return Math.floor(5 * level * level + 50 * level + 100);
}

/** Total XP required to reach `level` from scratch. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 0; i < level; i++) {
    total += xpForLevel(i);
  }
  return total;
}

/** Break a total XP value into level + progress. */
export function levelFromXp(totalXp: number): LevelInfo {
  const total = Math.max(0, Math.floor(totalXp));
  let level = 0;
  let remaining = total;

  // Use a loop with a safety limit to prevent infinite loops
  // Max level with 32-bit safe integers is around level 30000
  let iterations = 0;
  const MAX_ITERATIONS = 100000;

  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
    iterations++;
    if (iterations > MAX_ITERATIONS) {
      console.error('levelFromXp: Max iterations exceeded, breaking loop');
      break;
    }
  }

  return {
    level,
    xpInLevel: remaining,
    xpForNext: xpForLevel(level),
    totalXp: total,
  };
}

/** XP still required to reach the next level. */
export function xpUntilNextLevel(info: LevelInfo): number {
  return Math.max(0, info.xpForNext - info.xpInLevel);
}

/** Percentage progress toward the next level (0-100). */
export function progressPercent(info: LevelInfo): number {
  if (info.xpForNext <= 0) return 100;
  return Math.min(100, Math.floor((info.xpInLevel / info.xpForNext) * 100));
}

/** MEE6-style text progress bar. */
export function progressBar(percent: number, size = 20): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * size);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, size - filled));
}

/**
 * Random XP amount, MEE6 style (15-25 per message by default).
 * Falls back to `fixed` when the range is missing or invalid.
 */
export function randomXp(min: number, max: number, fixed?: number): number {
  const lo = Number.isFinite(min) && min >= 0 ? Math.floor(min) : (fixed !== undefined && Number.isFinite(fixed) ? Math.floor(fixed) : 0);
  const hi = Number.isFinite(max) && max >= 0 ? Math.floor(max) : lo;
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
