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

  const { leveledUp, newLevel, oldLevel } = addXp(userId, amount, 'voice');
  if (leveledUp && guild && user) {
    void handleLevelUp(guild, user, newLevel, oldLevel);
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

  for (const [userId, joinTs] of voiceSessions.entries()) {
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
      voiceSessions.set(userId, now - ((now - joinTs) % 60000));
    } else {
      voiceSessions.delete(userId);
    }
  }
}

export function getVoiceSessions(): Map<string, number> {
  return voiceSessions;
}
