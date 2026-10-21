import { Client, GuildMember, PartialGuildMember, TextChannel, AttachmentBuilder } from 'discord.js';
import { getConfig } from '../config';
import { welcomeCard } from '../utils/welcomecard';
import { getTotalMemberCount, incrementTotalMembers } from '../db';

/**
 * Handle new member joining - send welcome card
 */
export async function handleGuildMemberAdd(member: GuildMember | PartialGuildMember): Promise<void> {
  try {
    const config = getConfig();
    const welcomeConfig = config.welcome;

    if (!welcomeConfig.enabled || !welcomeConfig.channelId) return;

    const channel = member.guild.channels.cache.get(welcomeConfig.channelId);
    if (!channel || !channel.isTextBased()) return;

    // Increment and get total member count (includes those who left/kicked/banned)
    const totalMemberCount = incrementTotalMembers();
    
    // Get user's avatar URL (high res)
    const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 512 });

    // Generate welcome card
    const cardBuffer = await welcomeCard.generate({
      avatarUrl,
      username: member.user.username,
      guildName: member.guild.name,
      memberCount: totalMemberCount,
      welcomeMessage: welcomeConfig.message,
    });

    // Prepare message content with user mention
    const messageContent = welcomeConfig.message
      .replace(/{user}/g, `<@${member.id}>`)
      .replace(/{username}/g, member.user.username)
      .replace(/{server}/g, member.guild.name)
      .replace(/{memberCount}/g, totalMemberCount.toString());

    const attachment = new AttachmentBuilder(cardBuffer, { name: 'welcome.png' });

    await (channel as TextChannel).send({
      content: messageContent,
      files: [attachment],
    });
  } catch (error) {
    console.error('[Welcome] Failed to send welcome message:', error);
  }
}

/**
 * Handle member leaving - send goodbye message
 */
export async function handleGuildMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  try {
    const config = getConfig();
    const goodbyeConfig = config.goodbye;

    if (!goodbyeConfig.enabled || !goodbyeConfig.channelId) return;

    const channel = member.guild.channels.cache.get(goodbyeConfig.channelId);
    if (!channel || !channel.isTextBased()) return;

    // Get current total member count (includes this member who just left)
    const totalMemberCount = getTotalMemberCount();

    // Prepare goodbye message
    const messageContent = goodbyeConfig.message
      .replace(/{user}/g, `<@${member.id}>`)
      .replace(/{username}/g, member.user.username)
      .replace(/{server}/g, member.guild.name)
      .replace(/{memberCount}/g, totalMemberCount.toString());

    await (channel as TextChannel).send({
      content: messageContent,
    });
  } catch (error) {
    console.error('[Goodbye] Failed to send goodbye message:', error);
  }
}