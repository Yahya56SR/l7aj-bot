import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  ForumChannel,
  TextChannel,
  MessageReaction,
  User,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
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
  addTask,
  getTask,
  updateTaskStatus,
  listTasks,
  deleteTask,
} from '../db';
import { getConfig } from '../config';

/** Parse a custom emoji ID from a string like <:name:123456789> or return null for unicode. */
function parseEmojiId(emoji: string): string | null {
  const match = emoji.match(/<:[^:]+:(\d+)>/);
  return match ? match[1] : null;
}

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
  const cfg = getConfig();
  const sug = cfg.suggest;

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
        content: `New suggestion from <@${interaction.user.id}>! React with ${sug.likeEmoji} or ${sug.dislikeEmoji} to vote.`,
        embeds: [embed],
      },
    });

    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) {
      await starter.react(sug.likeEmoji).catch(() => undefined);
      await starter.react(sug.dislikeEmoji).catch(() => undefined);
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

  const cfg = getConfig();
  const staffChannelId = cfg.suggest.staffChannelId || existing.staffChannelId;
  let staffMessageId = existing.staffMessageId;

  if (newTag === 'NOTED') {
    // Send to staff channel and pin there
    const staffChannel = staffChannelId
      ? (interaction.guild.channels.cache.get(staffChannelId) as TextChannel | undefined)
      : interaction.guild.channels.cache.find(
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
          { name: 'Status', value: 'Pending Review', inline: true },
        )
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`suggest:approve:${messageId}`)
          .setLabel('Approve')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId(`suggest:deny:${messageId}`)
          .setLabel('Deny')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌'),
      );

      try {
        const staffMsg = await staffChannel.send({ embeds: [staffEmbed], components: [row] });
        await staffMsg.pin().catch(() => undefined);
        staffMessageId = staffMsg.id;
      } catch {
        /* ignore staff channel failures */
      }
    }
  } else if (newTag === 'APPROVED') {
    // Auto-create a task from approved suggestion
    try {
      addTask({
        title: existing.content.slice(0, 200),
        description: `Suggestion from <@${existing.authorId}>\nThread: <#${messageId}>`,
        status: 'NONE',
        sourceType: 'suggestion',
        sourceId: messageId,
        createdBy: interaction.user.id,
      });
    } catch {
      /* ignore task creation failures */
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

interface ReactionShape {
  emoji: { name: string | null; id: string | null };
  message: { id: string };
}

/** Handle like/dislike reactions on suggestion posts. Returns true if handled. */
export async function handleSuggestionReaction(
  reaction: ReactionShape,
  user: { id: string; bot: boolean },
  add: boolean,
): Promise<boolean> {
  if (user.bot) return false;

  const emojiId = reaction.emoji.id;
  const emojiName = reaction.emoji.name;

  const cfg = getConfig();
  const sug = cfg.suggest;
  const likeId = parseEmojiId(sug.likeEmoji);
  const dislikeId = parseEmojiId(sug.dislikeEmoji);

  let vote: 'up' | 'down' | null = null;
  if (emojiId === likeId || emojiName === sug.likeEmoji) vote = 'up';
  else if (emojiId === dislikeId || emojiName === sug.dislikeEmoji) vote = 'down';

  if (!vote) return false;

  const suggestion = getSuggestion(reaction.message.id);
  if (!suggestion) return false;

  if (add) {
    updateSuggestionVotes(reaction.message.id, user.id, vote);

    // Auto-NOTED when likes reach threshold
    const threshold = sug.notedThreshold || 10;
    if (vote === 'up' && suggestion.upvotes.length >= threshold && suggestion.status === 'open') {
      setSuggestionTag(reaction.message.id, 'NOTED');

      // Send to staff channel
      const staffChannelId = cfg.suggest.staffChannelId;
      const staffChannel = staffChannelId
        ? (interactionGuildCache().channels.cache.get(staffChannelId) as TextChannel | undefined)
        : undefined;

      if (staffChannel) {
        const staffEmbed = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('📌 Noted Suggestion (Auto)')
          .setDescription(suggestion.content)
          .addFields(
            { name: 'Author', value: `<@${suggestion.authorId}>`, inline: true },
            { name: 'Original', value: `<#${suggestion.channelId}>`, inline: true },
            { name: 'Thread', value: `<#${reaction.message.id}>`, inline: true },
            { name: 'Upvotes', value: String(suggestion.upvotes.length), inline: true },
          )
          .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`suggest:approve:${reaction.message.id}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
          new ButtonBuilder()
            .setCustomId(`suggest:deny:${reaction.message.id}`)
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌'),
        );

        try {
          const staffMsg = await staffChannel.send({ embeds: [staffEmbed], components: [row] });
          await staffMsg.pin().catch(() => undefined);
          // Update stored staff message id
          const s = getSuggestion(reaction.message.id);
          if (s) {
            s.staffChannelId = staffChannelId;
            s.staffMessageId = staffMsg.id;
            // Re-save
            setSuggestion(s);
          }
        } catch {
          /* ignore staff channel failures */
        }
      }
    }
  } else {
    removeSuggestionVote(reaction.message.id, user.id);
  }

  return true;
}

/** Handle button clicks on staff messages for suggestions. Returns true if handled. */
export async function handleSuggestionButton(interaction: {
  customId: string;
  guild: { id: string; channels: { cache: Map<string, any> } };
  member: { id: string } | null;
  reply: (opts: { content: string; ephemeral: boolean }) => Promise<unknown>;
  followUp: (opts: { content: string; ephemeral: boolean }) => Promise<unknown>;
  replied: boolean;
  deferred: boolean;
}): Promise<boolean> {
  const customId = interaction.customId;
  if (!customId.startsWith('suggest:')) return false;

  const parts = customId.split(':');
  const action = parts[1]; // approve or deny
  const messageId = parts[2];

  if (!action || !messageId) return false;
  if (!interaction.member) return false;

  const suggestion = getSuggestion(messageId);
  if (!suggestion) {
    await interaction.reply({ content: 'Suggestion not found.', ephemeral: true });
    return true;
  }

  const newTag = action === 'approve' ? 'APPROVED' : 'DENIED';

  if (action === 'approve') {
    // Auto-create a task from approved suggestion
    try {
      addTask({
        title: suggestion.content.slice(0, 200),
        description: `Suggestion from <@${suggestion.authorId}>\nThread: <#${messageId}>`,
        status: 'NONE',
        sourceType: 'suggestion',
        sourceId: messageId,
        createdBy: interaction.member.id,
      });
    } catch {
      /* ignore task creation failures */
    }
  }

  setSuggestionTag(messageId, newTag);

  await interaction.reply({ content: `✅ Suggestion \`${messageId}\` tagged as **${newTag}**.`, ephemeral: true });
  return true;
}

/** Helper to get the guild client cache for auto-noted staff messages. */
function interactionGuildCache(): { channels: { cache: Map<string, any> } } {
  // This is a fallback - the real client is passed from index.ts
  return { channels: { cache: new Map() } };
}
