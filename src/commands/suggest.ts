import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  ForumChannel,
  TextChannel,
} from 'discord.js';
import {
  setSuggestion,
  getSuggestion,
  listSuggestions,
  listSuggestionsByVotes,
  updateSuggestionStatus,
  setSuggestionTag,
  updateSuggestionVotes,
  removeSuggestionVote,
  deleteSuggestion,
} from '../db';

const LIKE_EMOJI_ID = '1562143921587626074';
const DISLIKE_EMOJI_ID = '1562139657817559070';
const NOTED_THRESHOLD = 15;

export const data = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('Submit or manage server suggestions (forum only)')
  .addSubcommand((sub) =>
    sub
      .setName('submit')
      .setDescription('Submit a new suggestion to the suggestions forum')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Forum channel to post the suggestion in')
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('suggestion').setDescription('Your suggestion').setRequired(true).setMaxLength(1000),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('tag')
      .setDescription('Set the tag/state of a suggestion (staff only)')
      .addStringOption((o) =>
        o
          .setName('message-id')
          .setDescription('The suggestion thread/message id')
          .setRequired(true)
          .setMinLength(15)
          .setMaxLength(25),
      )
      .addStringOption((o) =>
        o
          .setName('tag')
          .setDescription('New tag state')
          .setRequired(true)
          .addChoices(
            { name: 'Open', value: 'open' },
            { name: 'Approved', value: 'APPROVED' },
            { name: 'Denied', value: 'DENIED' },
            { name: 'Noted', value: 'NOTED' },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('List suggestions by status or vote count')
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Filter by status')
          .addChoices(
            { name: 'Open', value: 'open' },
            { name: 'Approved', value: 'approved' },
            { name: 'Denied', value: 'denied' },
            { name: 'Noted', value: 'noted' },
          ),
      )
      .addStringOption((o) =>
        o
          .setName('sort')
          .setDescription('Sort by vote count')
          .addChoices(
            { name: 'Net votes', value: 'net' },
            { name: 'Upvotes', value: 'up' },
            { name: 'Downvotes', value: 'down' },
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
          .setDescription('The suggestion thread/message id')
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
    case 'tag': return tag(interaction);
    case 'list': return list(interaction);
    case 'remove': return remove(interaction);
    default: return;
  }
}

async function submit(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const channel = interaction.options.getChannel('channel', true);
  const suggestion = interaction.options.getString('suggestion', true);

  if (channel.type !== ChannelType.GuildForum) {
    await interaction.reply({ content: 'Suggestions can only be posted in a forum channel.', ephemeral: true });
    return;
  }

  const forum = channel as ForumChannel;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('💡 New Suggestion')
    .setDescription(suggestion)
    .addFields(
      { name: 'Author', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
      { name: 'Status', value: 'Open', inline: true },
      { name: 'Votes', value: `↑0 ↓0`, inline: true },
    )
    .setTimestamp();

  try {
    const thread = await forum.threads.create({
      name: suggestion.slice(0, 100),
      message: {
        content: `New suggestion from <@${interaction.user.id}>! React with <:like:${LIKE_EMOJI_ID}> or <:dislike:${DISLIKE_EMOJI_ID}> to vote.`,
        embeds: [embed],
      },
    });

    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) {
      await starter.react(`<:like:${LIKE_EMOJI_ID}>`).catch(() => undefined);
      await starter.react(`<:dislike:${DISLIKE_EMOJI_ID}>`).catch(() => undefined);
    }

    setSuggestion({
      messageId: thread.id,
      channelId: forum.id,
      authorId: interaction.user.id,
      content: suggestion,
      status: 'open',
      upvotes: [],
      downvotes: [],
    });

    await interaction.reply({ content: `✅ Suggestion posted in <#${forum.id}>.`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `Failed to post suggestion: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
  }
}

async function tag(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const messageId = interaction.options.getString('message-id', true);
  const newTag = interaction.options.getString('tag', true) as 'open' | 'APPROVED' | 'DENIED' | 'NOTED';
  const existing = getSuggestion(messageId);
  if (!existing) {
    await interaction.reply({ content: `No suggestion found with id \`${messageId}\`.`, ephemeral: true });
    return;
  }

  const staffChannelId = existing.staffChannelId;
  let staffMessageId = existing.staffMessageId;

  if (newTag === 'NOTED') {
    // Send to staff channel and pin there
    const staffChannel = interaction.guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name?.toLowerCase().includes('staff'),
    ) as TextChannel | undefined;
    if (staffChannel) {
      const staffEmbed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('📌 Noted Suggestion')
        .setDescription(existing.content)
        .addFields(
          { name: 'Author', value: `<@${existing.authorId}>`, inline: true },
          { name: 'Original', value: `<#${existing.channelId}>`, inline: true },
          { name: 'Thread', value: `<#${messageId}>`, inline: true },
        )
        .setTimestamp();

      try {
        const staffMsg = await staffChannel.send({ embeds: [staffEmbed] });
        await staffMsg.pin().catch(() => undefined);
        staffMessageId = staffMsg.id;
      } catch {
        /* ignore staff channel failures */
      }
    }
  }

  setSuggestionTag(messageId, newTag, staffChannelId, staffMessageId);

  await interaction.reply({ content: `✅ Suggestion \`${messageId}\` tagged as **${newTag}**.`, ephemeral: true });
}

async function list(interaction: ChatInputCommandInteraction): Promise<void> {
  const statusFilter = interaction.options.getString('status');
  const sortBy = (interaction.options.getString('sort') || 'net') as 'net' | 'up' | 'down';
  const suggestions = listSuggestionsByVotes(statusFilter || undefined, sortBy);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`💡 Suggestions${statusFilter ? ` (${statusFilter})` : ''}`);

  if (suggestions.length === 0) {
    embed.setDescription('No suggestions.');
  } else {
    embed.setDescription(
      suggestions
        .map((s) => {
          const score = s.upvotes.length - s.downvotes.length;
          const tag = s.tagApplied ? ` • [${s.tagApplied}]` : '';
          return `• **${s.content}** — <#${s.channelId}> • \`${s.status}\`${tag} • ↑${s.upvotes.length} ↓${s.downvotes.length} (net ${score}) • id \`${s.messageId}\``;
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
    await interaction.reply({ content: `No suggestion found with id \`${messageId}\`.`, ephemeral: true });
    return;
  }
  await interaction.reply({ content: `✅ Removed suggestion \`${messageId}\`.`, ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Reaction handler (called from messageReactionAdd/Remove)           */
/* ------------------------------------------------------------------ */

/** Handle like/dislike reactions on suggestion posts. Returns true if handled. */
export async function handleSuggestionReaction(
  reaction: { emoji: { name: string | null; id: string | null }; message: { id: string } },
  user: { id: string; bot: boolean },
  add: boolean,
): Promise<boolean> {
  if (user.bot) return false;

  const emojiId = reaction.emoji.id;
  const emojiName = reaction.emoji.name;

  let vote: 'up' | 'down' | null = null;
  if (emojiId === LIKE_EMOJI_ID) vote = 'up';
  else if (emojiId === DISLIKE_EMOJI_ID) vote = 'down';
  else if (emojiName === '👍') vote = 'up';
  else if (emojiName === '👎') vote = 'down';

  if (!vote) return false;

  const suggestion = getSuggestion(reaction.message.id);
  if (!suggestion) return false;

  if (add) {
    updateSuggestionVotes(reaction.message.id, user.id, vote);

    // Auto-NOTED when likes reach threshold
    if (vote === 'up' && suggestion.upvotes.length >= NOTED_THRESHOLD && suggestion.status === 'open') {
      setSuggestionTag(reaction.message.id, 'NOTED');
    }
  } else {
    removeSuggestionVote(reaction.message.id, user.id);
  }

  return true;
}
