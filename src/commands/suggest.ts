import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  TextChannel,
  ForumChannel,
} from 'discord.js';
import {
  setSuggestion,
  getSuggestion,
  listSuggestions,
  updateSuggestionStatus,
  updateSuggestionVotes,
  removeSuggestionVote,
  deleteSuggestion,
} from '../db';

export const data = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('Submit or manage server suggestions')
  .addSubcommand((sub) =>
    sub
      .setName('submit')
      .setDescription('Submit a new suggestion')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to post the suggestion in')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('suggestion').setDescription('Your suggestion').setRequired(true).setMaxLength(1000),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('Change the status of a suggestion')
      .addStringOption((o) =>
        o
          .setName('message-id')
          .setDescription('The suggestion message id')
          .setRequired(true)
          .setMinLength(15)
          .setMaxLength(25),
      )
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('New status')
          .setRequired(true)
          .addChoices(
            { name: 'Open', value: 'open' },
            { name: 'Accepted', value: 'accepted' },
            { name: 'Rejected', value: 'rejected' },
            { name: 'Implemented', value: 'implemented' },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('List suggestions by status')
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Filter by status')
          .addChoices(
            { name: 'Open', value: 'open' },
            { name: 'Accepted', value: 'accepted' },
            { name: 'Rejected', value: 'rejected' },
            { name: 'Implemented', value: 'implemented' },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove a suggestion')
      .addStringOption((o) =>
        o
          .setName('message-id')
          .setDescription('The suggestion message id')
          .setRequired(true)
          .setMinLength(15)
          .setMaxLength(25),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'submit': return submit(interaction);
    case 'status': return status(interaction);
    case 'list': return list(interaction);
    case 'remove': return remove(interaction);
    default: return;
  }
}

async function submit(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel('channel', true);
  const suggestion = interaction.options.getString('suggestion', true);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('💡 New Suggestion')
    .setDescription(suggestion)
    .addFields(
      { name: 'Author', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
      { name: 'Status', value: 'Open', inline: true },
    )
    .setTimestamp();

  let messageId: string;
  let channelId: string;

  if (channel.type === ChannelType.GuildForum) {
    const forum = channel as ForumChannel;
    const thread = await forum.threads.create({
      name: suggestion.slice(0, 100),
      message: {
        content: `New suggestion from <@${interaction.user.id}>! React with 👍 / 👎 to vote.`,
        embeds: [embed],
      },
    });
    const starter = await thread.fetchStarterMessage().catch(() => null);
    await starter?.react('👍').catch(() => undefined);
    await starter?.react('👎').catch(() => undefined);
    messageId = thread.id; // starter message id == thread id for forum threads
    channelId = forum.id;
  } else {
    const textChannel = channel as TextChannel;
    const message = await textChannel.send({
      content: `New suggestion from <@${interaction.user.id}>! React with 👍 / 👎 to vote.`,
      embeds: [embed],
    });
    await message.react('👍');
    await message.react('👎');
    messageId = message.id;
    channelId = textChannel.id;
  }

  setSuggestion({
    messageId,
    channelId,
    authorId: interaction.user.id,
    content: suggestion,
    status: 'open',
    upvotes: [],
    downvotes: [],
  });

  await interaction.reply({ content: `✅ Suggestion posted in ${channel}.`, ephemeral: true });
}

async function status(interaction: ChatInputCommandInteraction): Promise<void> {
  const messageId = interaction.options.getString('message-id', true);
  const newStatus = interaction.options.getString('status', true);
  const existing = getSuggestion(messageId);
  if (!existing) {
    await interaction.reply({ content: `No suggestion found with message id \`${messageId}\`.`, ephemeral: true });
    return;
  }

  updateSuggestionStatus(messageId, newStatus);
  await interaction.reply({ content: `✅ Suggestion \`${messageId}\` status set to **${newStatus}**.`, ephemeral: true });
}

async function list(interaction: ChatInputCommandInteraction): Promise<void> {
  const statusFilter = interaction.options.getString('status');
  const suggestions = listSuggestions(statusFilter as any);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`💡 Suggestions${statusFilter ? ` (${statusFilter})` : ''}`);

  if (suggestions.length === 0) {
    embed.setDescription('No suggestions.');
  } else {
    embed.setDescription(
      suggestions
        .map((s) => {
          const channel = interaction.guild?.channels.cache.get(s.channelId);
          const score = s.upvotes.length - s.downvotes.length;
          return `• **${s.content}** — <#${s.channelId}> • \`${s.status}\` • ↑${s.upvotes.length} ↓${s.downvotes.length} (net ${score}) • id \`${s.messageId}\``;
        })
        .join('\n'),
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function remove(interaction: ChatInputCommandInteraction): Promise<void> {
  const messageId = interaction.options.getString('message-id', true);
  const ok = deleteSuggestion(messageId);
  if (!ok) {
    await interaction.reply({ content: `No suggestion found with message id \`${messageId}\`.`, ephemeral: true });
    return;
  }
  await interaction.reply({ content: `✅ Removed suggestion \`${messageId}\`.`, ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Reaction handler (called from messageReactionAdd)                  */
/* ------------------------------------------------------------------ */

/** Handle 👍 / 👎 on a suggestion message. Returns true if handled. */
export async function handleSuggestionReaction(
  reaction: { emoji: { name: string | null; id: string | null }; message: { id: string } },
  user: { id: string; bot: boolean },
  add: boolean,
): Promise<boolean> {
  if (user.bot) return false;
  const emoji = reaction.emoji.name;
  if (emoji !== '👍' && emoji !== '👎') return false;
  const suggestion = getSuggestion(reaction.message.id);
  if (!suggestion) return false;

  if (add) {
    updateSuggestionVotes(reaction.message.id, user.id, emoji === '👍' ? 'up' : 'down');
  } else {
    removeSuggestionVote(reaction.message.id, user.id);
  }
  return true;
}

