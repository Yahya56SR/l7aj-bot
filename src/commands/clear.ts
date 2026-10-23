import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  Message,
  NewsChannel,
  TextChannel,
  ThreadChannel,
} from 'discord.js';

/** Discord refuses bulk deletes for anything older than 14 days. */
const MAX_MESSAGE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** One fetch can never return more than 100 messages. */
const FETCH_LIMIT = 100;

export const data = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Delete recent messages in this channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setDMPermission(false)
  .addIntegerOption((o) =>
    o
      .setName('amount')
      .setDescription('How many messages to delete (1-100)')
      .setMinValue(1)
      .setMaxValue(FETCH_LIMIT)
      .setRequired(true),
  )
  .addUserOption((o) =>
    o.setName('user').setDescription('Only delete messages from this member'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    await interaction.reply({
      content: 'I can only clear messages in a server text channel or thread.',
      ephemeral: true,
    });
    return;
  }

  const textChannel = channel as TextChannel | NewsChannel | ThreadChannel;
  const me = interaction.guild.members.me;
  if (me && !textChannel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      content: `I need the **Manage Messages** permission in <#${textChannel.id}> to delete messages.`,
      ephemeral: true,
    });
    return;
  }

  const amount = interaction.options.getInteger('amount', true);
  const targetUser = interaction.options.getUser('user');

  await interaction.deferReply({ ephemeral: true });

  const cutoff = Date.now() - MAX_MESSAGE_AGE_MS;
  let candidates: Message[];
  let available: number;
  try {
    const fetched = await textChannel.messages.fetch({ limit: FETCH_LIMIT });
    const recent = [...fetched.values()]
      .filter((message) => message.createdTimestamp > cutoff)
      .filter((message) => !targetUser || message.author.id === targetUser.id);
    available = recent.length;
    candidates = recent.slice(0, amount);
  } catch (err) {
    console.error('[Clear] Failed to fetch messages:', err);
    await interaction.editReply({
      content:
        'I could not read the message history here. Check my **View Channel** and **Read Message History** permissions.',
    });
    return;
  }

  if (candidates.length === 0) {
    await interaction.editReply({
      content: targetUser
        ? `No recent messages from **${targetUser.username}** to delete in <#${textChannel.id}>.`
        : 'There is nothing recent enough to delete here — Discord only allows bulk deletes for messages newer than 14 days.',
    });
    return;
  }

  try {
    const deleted = await textChannel.bulkDelete(candidates, true);
    const plural = deleted.size === 1 ? 'message' : 'messages';
    const scope = targetUser ? ` from **${targetUser.username}**` : '';

    await interaction.editReply({
      content:
        `🧹 Deleted **${deleted.size}** ${plural}${scope} in <#${textChannel.id}>.` +
        (available < amount
          ? `\nOnly ${available} recent ${available === 1 ? 'message was' : 'messages were'} available — Discord blocks bulk deletes for messages older than 14 days.`
          : ''),
    });
  } catch (err) {
    console.error('[Clear] Failed to delete messages:', err);
    await interaction.editReply({
      content: 'I could not delete those messages. Check that I have **Manage Messages** in this channel.',
    });
  }
}
