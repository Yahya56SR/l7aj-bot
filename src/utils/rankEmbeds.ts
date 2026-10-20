import { EmbedBuilder, User } from 'discord.js';
import { LevelInfo, progressBar, progressPercent } from './level';

export interface RankCardOptions {
  user: User;
  info: LevelInfo;
  guildName: string;
  position?: number;
}

/**
 * Text fallback for the rank card — used only when the canvas renderer fails.
 */
export function buildRankCard(opts: RankCardOptions): EmbedBuilder {
  const { user, info } = opts;
  const percent = progressPercent(info);
  const remaining = Math.max(0, info.xpForNext - info.xpInLevel);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setDescription(
      [
        `**Level ${info.level}**`,
        `${progressBar(percent)}  \`${percent}%\``,
        '',
        `\`${info.xpInLevel.toLocaleString()}\` / \`${info.xpForNext.toLocaleString()}\` XP`,
      ].join('\n'),
    )
    .addFields(
      { name: 'XP to next level', value: `${remaining.toLocaleString()} XP`, inline: true },
      { name: 'Total XP', value: info.totalXp.toLocaleString(), inline: true },
    )
    .setFooter({ text: opts.guildName })
    .setTimestamp();

  if (opts.position && opts.position > 0) {
    embed.addFields({ name: 'Rank', value: `#${opts.position}`, inline: true });
  }

  return embed;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  level: number;
  totalXp: number;
}

/**
 * Text fallback for the leaderboard.
 */
export function buildLeaderboardEmbed(
  entries: LeaderboardEntry[],
  guildName: string,
): EmbedBuilder {
  const description = entries
    .map((entry, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      return `${medal} <@${entry.userId}> — level **${entry.level}** (\`${entry.totalXp.toLocaleString()}\` XP)`;
    })
    .join('\n');

  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle('🏆 Top members')
    .setDescription(description)
    .setFooter({ text: guildName })
    .setTimestamp();
}
