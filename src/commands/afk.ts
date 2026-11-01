import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { setAfk, getAfk, removeAfk } from '../db';

export const data = new SlashCommandBuilder()
  .setName('afk')
  .setDescription('Set or clear your AFK status')
  .addStringOption((o) =>
    o.setName('message').setDescription('Optional AFK message').setRequired(false).setMaxLength(200),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const existing = getAfk(interaction.user.id);
  if (existing) {
    removeAfk(interaction.user.id);
    await interaction.reply({
      content: `✅ Welcome back! Your AFK status has been cleared (was set <t:${Math.floor(existing.since / 1000)}:R>).`,
      ephemeral: true,
    });
    return;
  }

  const message = interaction.options.getString('message') || 'No message provided.';
  setAfk(interaction.user.id, message);
  const embed = new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle('💤 AFK Set')
    .setDescription(`You are now AFK: ${message}`);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/** Returns the AFK record for a user, if any. */
export function getAfkStatus(userId: string): { message: string; since: number } | null {
  const afk = getAfk(userId);
  if (!afk) return null;
  return { message: afk.message, since: afk.since };
}

/** Clears a user's AFK status. Returns true if they were AFK. */
export function clearAfkStatus(userId: string): boolean {
  return removeAfk(userId);
}
