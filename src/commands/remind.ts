import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import {
  createReminder,
  listReminders,
  deleteReminder,
  getDueReminders,
  markReminderSent,
} from '../db';

export const data = new SlashCommandBuilder()
  .setName('remind')
  .setDescription('Set a reminder for yourself')
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Create a new reminder')
      .addStringOption((o) =>
        o
          .setName('time')
          .setDescription('When to remind you (e.g. "10m", "2h", "1d", "2026-12-25 12:00")')
          .setRequired(true)
          .setMaxLength(50),
      )
      .addStringOption((o) =>
        o
          .setName('message')
          .setDescription('What to remind you about')
          .setRequired(true)
          .setMaxLength(500),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('List your pending reminders'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel a reminder by id')
      .addStringOption((o) =>
        o.setName('reminder-id').setDescription('The reminder id').setRequired(true),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'set': return setReminder(interaction);
    case 'list': return listRemindersCmd(interaction);
    case 'cancel': return cancelReminder(interaction);
    default: return;
  }
}

function parseTime(input: string): { ms: number; error?: string } {
  const now = Date.now();
  const lower = input.toLowerCase().trim();

  // Absolute ISO datetime
  if (/^\d{4}-\d{2}-\d{2}/.test(lower)) {
    const ts = Date.parse(lower);
    if (!Number.isNaN(ts)) return { ms: ts };
    return { ms: 0, error: 'I could not parse that date/time.' };
  }

  // Relative: number + unit, e.g. 10m, 2h, 1d, 30s
  const match = /^(\d+)\s*(s|sec|m|min|h|hr|d|day)s?$/i.exec(lower);
  if (match) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    let ms: number;
    if (unit.startsWith('s')) ms = value * 1000;
    else if (unit.startsWith('m')) ms = value * 60 * 1000;
    else if (unit.startsWith('h')) ms = value * 60 * 60 * 1000;
    else ms = value * 24 * 60 * 60 * 1000; // day
    if (ms < 1000 || ms > 30 * 24 * 60 * 60 * 1000) {
      return { ms: 0, error: 'Time must be between 1 second and 30 days.' };
    }
    return { ms: now + ms };
  }

  return { ms: 0, error: 'Use a format like `10m`, `2h`, `1d`, or `2026-12-25 12:00`.' };
}

async function setReminder(interaction: ChatInputCommandInteraction): Promise<void> {
  const timeInput = interaction.options.getString('time', true);
  const message = interaction.options.getString('message', true);
  const parsed = parseTime(timeInput);
  if (parsed.error) {
    await interaction.reply({ content: parsed.error, ephemeral: true });
    return;
  }

  const reminder = createReminder({
    userId: interaction.user.id,
    channelId: interaction.channelId,
    message,
    scheduledAt: parsed.ms,
    sent: false,
    createdAt: Date.now(),
  });

  const until = new Date(parsed.ms).toLocaleString();
  await interaction.reply({
    content: `⏰ Reminder set (id: \`${reminder.id}\`). I'll DM you <t:${Math.floor(parsed.ms / 1000)}:R> (${until}).`,
    ephemeral: true,
  });
}

async function listRemindersCmd(interaction: ChatInputCommandInteraction): Promise<void> {
  const reminders = listReminders(interaction.user.id, true);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`⏰ ${interaction.user.username}'s Reminders`);

  if (reminders.length === 0) {
    embed.setDescription('No pending reminders. Set one with `/remind set`.');
  } else {
    embed.setDescription(
      reminders
        .map((r) => `• \`${r.id}\` — ${r.message}\n  <t:${Math.floor(r.scheduledAt / 1000)}:R>`)
        .join('\n'),
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function cancelReminder(interaction: ChatInputCommandInteraction): Promise<void> {
  const reminderId = interaction.options.getString('reminder-id', true);
  const ok = deleteReminder(reminderId);
  if (!ok) {
    await interaction.reply({ content: `No reminder found with id \`${reminderId}\`.`, ephemeral: true });
    return;
  }
  await interaction.reply({ content: `✅ Reminder \`${reminderId}\` cancelled.`, ephemeral: true });
}

export function formatReminder(reminder: { userId: string; channelId: string; message: string }): string {
  return `<@${reminder.userId}> 🔔 Reminder: ${reminder.message}`;
}
