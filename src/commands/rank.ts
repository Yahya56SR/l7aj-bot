import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { getUser, getRankPosition, countRanked } from '../db';
import { levelFromXp } from '../utils/level';
import { buildRankCard } from '../utils/rankEmbeds';
import { rankCard } from '../utils/rankcard';

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Check your XP and level')
  .addUserOption((option) =>
    option.setName('user').setDescription('The user to check').setRequired(false),
  );

export async function execute(interaction: any): Promise<void> {
  const target = interaction.options.getUser('user') || interaction.user;
  const guild = interaction.guild;

  const row = getUser(target.id);
  if (!row) {
    await interaction.reply({
      content: `${target.username} hasn't earned any XP yet.`,
      ephemeral: true,
    });
    return;
  }

  const info = levelFromXp(row.xp);
  const position = getRankPosition(target.id);

  // Rendering happens off the response path, so defer first.
  await interaction.deferReply();

  try {
    const buffer = await rankCard.generate({
      avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
      username: target.username,
      statusText: null,
      level: info.level,
      rank: position || null,
      totalRanked: countRanked(),
      xpIntoLevel: info.xpInLevel,
      xpNeeded: info.xpForNext,
      totalXp: info.totalXp,
      guildName: guild?.name,
    });

    const attachment = new AttachmentBuilder(buffer, { name: 'rank.png' });
    await interaction.editReply({ files: [attachment] });
  } catch (err) {
    console.error('Failed to render rank card:', err);
    // Fall back to a plain embed if the canvas fails.
    const embed = buildRankCard({
      user: target,
      info,
      guildName: guild?.name ?? 'this server',
      position,
    });
    await interaction.editReply({ embeds: [embed] });
  }
}
