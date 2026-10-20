import {
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
  GuildMember,
} from 'discord.js';
import { getConfig } from '../config';
import { roleIdForReactionEmoji } from '../utils/discord';

type Reaction = MessageReaction | PartialMessageReaction;
type Reactor = User | PartialUser;

function isTargetReaction(reaction: Reaction): boolean {
  const { messageId, channelId } = getConfig().reactionRoles;
  if (!messageId || !channelId) return false;
  return reaction.message.id === messageId && reaction.message.channel.id === channelId;
}

export async function handleReactionAdd(reaction: Reaction, user: Reactor): Promise<void> {
  if (user.bot) return;
  if (!isTargetReaction(reaction)) return;

  const roleId = roleIdForReactionEmoji(reaction.emoji, getConfig().reactionRoles.mappings);
  if (!roleId) return;

  const member = await resolveMember(reaction, user);
  if (!member) return;

  try {
    await member.roles.add(roleId);
  } catch (err) {
    console.error(`Failed to add role ${roleId} to ${user.id}:`, err);
  }
}

export async function handleReactionRemove(reaction: Reaction, user: Reactor): Promise<void> {
  if (user.bot) return;
  if (!isTargetReaction(reaction)) return;

  const roleId = roleIdForReactionEmoji(reaction.emoji, getConfig().reactionRoles.mappings);
  if (!roleId) return;

  const member = await resolveMember(reaction, user);
  if (!member) return;

  try {
    await member.roles.remove(roleId);
  } catch (err) {
    console.error(`Failed to remove role ${roleId} from ${user.id}:`, err);
  }
}

async function resolveMember(reaction: Reaction, user: Reactor): Promise<GuildMember | null> {
  try {
    if (reaction.message.guild) {
      return await reaction.message.guild.members.fetch(user.id);
    }
    const msg = await reaction.message.channel.messages.fetch(reaction.message.id);
    if (msg.guild) {
      return await msg.guild.members.fetch(user.id);
    }
  } catch (err) {
    console.error('Failed to resolve member for reaction:', err);
  }
  return null;
}
