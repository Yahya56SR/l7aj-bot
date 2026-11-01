import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  TextChannel,
} from 'discord.js';
import {
  createGiveaway,
  getGiveaway,
  getGiveawayByMessageId,
  listGiveaways,
  enterGiveaway,
  endGiveaway,
  deleteGiveaway,
  updateGiveaway,
} from '../db';
import { getConfig } from '../config';

export const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Create and manage giveaways')
  .setDefaultMemberPermissions(0n /* ManageEvents */)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Create a new giveaway')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to post the giveaway in')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('duration-minutes')
          .setDescription('How long the giveaway runs (minutes)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(44640), // 31 days
      )
      .addIntegerOption((o) =>
        o.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1).setMaxValue(20),
      )
      .addStringOption((o) =>
        o.setName('prize').setDescription('What is being given away').setRequired(true).setMaxLength(200),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('end')
      .setDescription('End a giveaway early and pick winners')
      .addStringOption((o) =>
        o.setName('giveaway-id').setDescription('The giveaway id').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('reroll')
      .setDescription('Re-roll winners for a completed giveaway')
      .addStringOption((o) =>
        o.setName('giveaway-id').setDescription('The giveaway id').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('List open giveaways'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'create': return create(interaction);
    case 'end': return end(interaction);
    case 'reroll': return reroll(interaction);
    case 'list': return list(interaction);
    default: return;
  }
}

async function create(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel('channel', true) as TextChannel;
  const durationMinutes = interaction.options.getInteger('duration-minutes', true);
  const winners = interaction.options.getInteger('winners', true);
  const prize = interaction.options.getString('prize', true);

  const perms = interaction.memberPermissions;
  if (!perms || (!perms.has('ManageEvents') && !perms.has('ManageGuild'))) {
    await interaction.reply({ content: 'You need **Manage Events** or **Manage Server** permission to create giveaways.', ephemeral: true });
    return;
  }

  const endsAt = Date.now() + durationMinutes * 60 * 1000;
  const giveaway = createGiveaway({
    channelId: channel.id,
    messageId: '',
    prize,
    winnerCount: winners,
    endsAt,
    ended: false,
    createdAt: Date.now(),
    entries: [],
  });

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎉 GIVEAWAY')
    .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>`)
    .addFields({ name: 'Entries', value: '0', inline: true })
    .setFooter({ text: `Giveaway ID: ${giveaway.id} • Click 🎉 to enter` })
    .setTimestamp();

  const message = await channel.send({
    content: `@everyone\nA new giveaway has started!`,
    embeds: [embed],
  });
  await message.react('🎉');

  // Update the stored message id.
  updateGiveaway(giveaway.id, { messageId: message.id });
}

async function end(interaction: ChatInputCommandInteraction): Promise<void> {
  const giveawayId = interaction.options.getString('giveaway-id', true);
  const giveaway = getGiveaway(giveawayId);
  if (!giveaway) {
    await interaction.reply({ content: `No giveaway found with id \`${giveawayId}\`.`, ephemeral: true });
    return;
  }
  if (giveaway.ended) {
    await interaction.reply({ content: `Giveaway \`${giveawayId}\` has already ended.`, ephemeral: true });
    return;
  }

  const winners = endGiveaway(giveawayId);
  if (!winners || winners.length === 0) {
    await interaction.reply({ content: `No one entered giveaway \`${giveawayId}\`. No winners.`, ephemeral: true });
    return;
  }

  const channel = await interaction.client.channels.fetch(giveaway.channelId).catch(() => null);
  if (channel && channel.isTextBased()) {
    const msg = await (channel as TextChannel).messages.fetch(giveaway.messageId).catch(() => null);
    if (msg) {
      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('🎉 GIVEAWAY ENDED')
            .setDescription(
              `**Prize:** ${giveaway.prize}\n**Winner(s):** ${winners.map((w) => `<@${w}>`).join(', ')}`,
            )
            .setTimestamp(),
        ],
        content: `Congratulations ${winners.map((w) => `<@${w}>`).join(', ')}! You won **${giveaway.prize}**!`,
      });
    }
  }

  await interaction.reply({ content: `✅ Giveaway \`${giveawayId}\` ended. Winner(s): ${winners.map((w) => `<@${w}>`).join(', ')}.`, ephemeral: true });
}

async function reroll(interaction: ChatInputCommandInteraction): Promise<void> {
  const giveawayId = interaction.options.getString('giveaway-id', true);
  const giveaway = getGiveaway(giveawayId);
  if (!giveaway || !giveaway.ended) {
    await interaction.reply({ content: `No completed giveaway found with id \`${giveawayId}\`.`, ephemeral: true });
    return;
  }

  const winners = endGiveaway(giveawayId); // re-pick (marks ended again, harmless)
  if (!winners || winners.length === 0) {
    await interaction.reply({ content: `No entries to re-roll for \`${giveawayId}\`.`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: `🎲 Re-rolled \`${giveawayId}\`. New winner(s): ${winners.map((w) => `<@${w}>`).join(', ')}.`, ephemeral: true });
}

async function list(interaction: ChatInputCommandInteraction): Promise<void> {
  const giveaways = listGiveaways(true);
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('🎉 Open Giveaways');

  if (giveaways.length === 0) {
    embed.setDescription('No open giveaways.');
  } else {
    embed.setDescription(
      giveaways
        .map((g) => {
          const channel = interaction.guild?.channels.cache.get(g.channelId);
          return `**${g.prize}** — <#${g.channelId}> • ${g.winnerCount} winner(s) • ends <t:${Math.floor(g.endsAt / 1000)}:R> • id \`${g.id}\` • ${g.entries.length} entr${g.entries.length === 1 ? 'y' : 'ies'}`;
        })
        .join('\n'),
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Reaction handler (called from messageReactionAdd)                  */
/* ------------------------------------------------------------------ */

/** Handle a 🎉 reaction on a giveaway message: enter the user. Returns true if handled. */
export async function handleGiveawayReaction(
  reaction: { emoji: { name: string | null; id: string | null }; message: { id: string } },
  user: { id: string; bot: boolean },
): Promise<boolean> {
  if (user.bot) return false;
  if (reaction.emoji.name !== '🎉') return false;
  const giveaway = getGiveawayByMessageId(reaction.message.id);
  if (!giveaway || giveaway.ended) return false;
  const entered = enterGiveaway(giveaway.id, user.id);
  return entered;
}
