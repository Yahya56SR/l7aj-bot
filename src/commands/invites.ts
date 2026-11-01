import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import {
  setInvite,
  getInvite,
  listInvites,
  deleteInvite,
  addBalance,
} from '../db';
import type { Client } from 'discord.js';

// In-memory invite cache: guildId -> Map<code, { inviterId, uses }>
const inviteCache = new Map<string, Map<string, { inviterId: string; uses: number }>>();

export function setInviteCache(guildId: string, invites: Map<string, { inviterId: string; uses: number }>): void {
  inviteCache.set(guildId, invites);
}

export function getInviteCache(guildId: string): Map<string, { inviterId: string; uses: number }> | undefined {
  return inviteCache.get(guildId);
}

/** Diff old vs new invite cache to find which invite was used, returning inviter id or null. */
export function diffInvite(
  guildId: string,
  newInvites: Map<string, { inviterId: string; uses: number }>,
): string | null {
  const old = inviteCache.get(guildId) ?? new Map();
  for (const [code, current] of newInvites) {
    const previous = old.get(code);
    if (!previous) continue;
    if (current.uses > previous.uses) {
      setInviteCache(guildId, newInvites);
      return current.inviterId;
    }
  }
  setInviteCache(guildId, newInvites);
  return null;
}

export const data = new SlashCommandBuilder()
  .setName('invites')
  .setDescription('Check invite statistics')
  .addSubcommand((sub) =>
    sub.setName('check').setDescription('Check your own or another member\'s invites')
      .addUserOption((o) => o.setName('member').setDescription('Member to check').setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub.setName('leaderboard').setDescription('Top inviters in the server'),
  )
  .addSubcommand((sub) =>
    sub.setName('info').setDescription('Info about a specific invite code')
      .addStringOption((o) => o.setName('code').setDescription('Invite code').setRequired(true)),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'check': return check(interaction);
    case 'leaderboard': return leaderboard(interaction);
    case 'info': return info(interaction);
    default: return;
  }
}

async function check(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser('member') ?? interaction.user;
  const invites = listInvites();
  const userInvites = invites.filter((i) => i.inviterId === target.id);
  const totalUses = userInvites.reduce((sum, i) => sum + i.uses, 0);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🔗 Invites for ${target.username}`)
    .addFields(
      { name: 'Total Invites', value: String(userInvites.length), inline: true },
      { name: 'Total Uses', value: String(totalUses), inline: true },
      {
        name: 'Top Code',
        value: userInvites.length > 0 ? userInvites.sort((a, b) => b.uses - a.uses)[0].code : 'None',
        inline: true,
      },
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function leaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const invites = listInvites();
  const byUser = new Map<string, { userId: string; uses: number; count: number }>();
  for (const inv of invites) {
    const cur = byUser.get(inv.inviterId) || { userId: inv.inviterId, uses: 0, count: 0 };
    cur.uses += inv.uses;
    cur.count += 1;
    byUser.set(inv.inviterId, cur);
  }

  const sorted = [...byUser.values()].sort((a, b) => b.uses - a.uses).slice(0, 10);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🏆 Invite Leaderboard');

  if (sorted.length === 0) {
    embed.setDescription('No invites tracked yet.');
  } else {
    embed.setDescription(
      sorted
        .map((entry, i) => `**${i + 1}.** <@${entry.userId}> — ${entry.uses} invite${entry.uses === 1 ? '' : 's'} (${entry.count} code${entry.count === 1 ? '' : 's'})`)
        .join('\n'),
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function info(interaction: ChatInputCommandInteraction): Promise<void> {
  const code = interaction.options.getString('code', true);
  const inv = getInvite(code);
  if (!inv) {
    await interaction.reply({ content: `Invite code \`${code}\` is not being tracked.`, ephemeral: true });
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🔗 Invite \`${code}\``)
    .addFields(
      { name: 'Inviter', value: `<@${inv.inviterId}>`, inline: true },
      { name: 'Uses', value: String(inv.uses), inline: true },
      { name: 'Reset', value: String(inv.reset), inline: true },
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export async function cacheGuildInvites(client: Client, guildId: string): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  try {
    const invites = await guild.invites.fetch();
    const map = new Map<string, { inviterId: string; uses: number }>();
    for (const [code, invite] of invites) {
      map.set(code, { inviterId: invite.inviterId ?? '', uses: invite.uses ?? 0 });
    }
    inviteCache.set(guildId, map);
    // Persist to db
    for (const [code, data] of map) {
      setInvite({ code, inviterId: data.inviterId, uses: data.uses, reset: false });
    }
  } catch {
    // No permission to fetch invites; silently skip.
  }
}
