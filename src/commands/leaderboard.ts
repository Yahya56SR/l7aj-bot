import { SlashCommandBuilder, AttachmentBuilder, ChatInputCommandInteraction } from 'discord.js';
import { getLeaderboard } from '../db';
import { levelFromXp } from '../utils/level';
import { buildLeaderboardEmbed } from '../utils/rankEmbeds';
import { leaderboardCard } from '../utils/rankcard';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View the top XP earners in the server')
  .addIntegerOption((option) =>
    option
      .setName('limit')
      .setDescription('How many members to show (1-25)')
      .setMinValue(1)
      .setMaxValue(25),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const limit = interaction.options.getInteger('limit') ?? 10;
  const rows = getLeaderboard(limit);

  if (rows.length === 0) {
    await interaction.reply({ content: 'No XP records yet.', ephemeral: true });
    return;
  }

  const entries = await Promise.all(
    rows.map(async (row) => {
      let user = interaction.client.users.cache.get(row.user_id);
      if (!user) {
        try {
          user = await interaction.client.users.fetch(row.user_id);
        } catch {
          // User not found on Discord (e.g. left the server / deleted account)
          user = undefined;
        }
      }
      return {
        userId: row.user_id,
        username: user?.username ?? 'Unknown user',
        avatarUrl: user?.displayAvatarURL({ extension: 'png', size: 128 }) ?? '',
        level: levelFromXp(row.xp).level,
        totalXp: row.xp,
      };
    }),
  );

  await interaction.deferReply();

  try {
    const buffer = await leaderboardCard.generate(
      entries,
      interaction.guild?.name ?? 'this server',
      '🏆 Top members',
    );

    const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
    await interaction.editReply({ files: [attachment] });
  } catch (err) {
    console.error('Failed to render leaderboard image:', err);
    const embed = buildLeaderboardEmbed(
      entries.map((e) => ({
        userId: e.userId,
        username: e.username,
        level: e.level,
        totalXp: e.totalXp,
      })),
      interaction.guild?.name ?? 'this server',
    );
    await interaction.editReply({ embeds: [embed] }).catch(() => undefined);
  }
}
