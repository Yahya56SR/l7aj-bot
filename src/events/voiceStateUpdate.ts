import { VoiceState, Client } from 'discord.js';
import { addXp } from '../db';
import { getConfig } from '../config';
import { randomXp } from '../utils/level';
import { handleLevelUp } from '../handlers/levelUp';

const voiceSessions = new Map<string, number>(); // userId -> joinTimestamp

/**
 * Award random XP for a number of minutes spent in voice.
 */
function awardVoiceXp(userId: string, minutes: number, guild?: any, user?: any): void {
  if (minutes <= 0) return;

  const cfg = getConfig();
  const amount = randomXp(cfg.xp.perVoiceMinuteMin, cfg.xp.perVoiceMinuteMax) * minutes;
  if (amount <= 0) return;

  try {
    const { leveledUp, newLevel, oldLevel } = addXp(userId, amount, 'voice');
    if (leveledUp && guild && user) {
      // Use void to fire-and-forget, but catch errors
      handleLevelUp(guild, user, newLevel, oldLevel).catch((err) => {
        console.error(`Failed to handle level up for ${userId}:`, err);
      });
    }
  } catch (err) {
    console.error(`Failed to award voice XP to ${userId}:`, err);
  }
}

export function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
  const userId = newState.member?.user?.id || oldState.member?.user?.id;
  if (!userId) return;

  const now = Date.now();

  // Left a voice channel, or moved to a different one
  if (oldState.channelId && (!newState.channelId || oldState.channelId !== newState.channelId)) {
    const joinTs = voiceSessions.get(userId);
    if (joinTs) {
      const minutes = Math.floor((now - joinTs) / 60000);
      voiceSessions.delete(userId);
      awardVoiceXp(userId, minutes, newState.guild, newState.member?.user);
    }
  }

  // Joined a voice channel
  if (!oldState.channelId && newState.channelId && newState.member?.user) {
    voiceSessions.set(userId, now);
  }
}

/**
 * Call every minute from index.ts to award XP to users currently in voice.
 */
export async function handleVoiceTick(client: Client): Promise<void> {
  const now = Date.now();

  // Create a snapshot of entries to avoid modification during iteration
  const sessionEntries: Array<[string, number]> = [];
  for (const entry of voiceSessions.entries()) {
    sessionEntries.push(entry);
  }

  for (const [userId, joinTs] of sessionEntries) {
    const minutesElapsed = Math.floor((now - joinTs) / 60000);
    if (minutesElapsed < 1) continue;

    // Find which guild this user is still in voice inside
    let found = false;
    for (const guild of client.guilds.cache.values()) {
      const member = guild.members.cache.get(userId);
      if (member?.voice.channel) {
        awardVoiceXp(userId, minutesElapsed, guild, member.user);
        found = true;
        break;
      }
    }

    if (found) {
      // Advance the session timestamp so we award once per minute going forward
      // Align to minute boundary to prevent drift
      const alignedTs = now - ((now - joinTs) % 60000);
      voiceSessions.set(userId, alignedTs);
    } else {
      // User no longer in any voice channel in any guild we can see
      voiceSessions.delete(userId);
    }
  }
}

export function getVoiceSessions(): Map<string, number> {
  return voiceSessions;
}
