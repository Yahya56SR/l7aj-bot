import {
  ButtonInteraction,
  ModalSubmitInteraction,
  TextChannel,
  CategoryChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
  Message,
  Role,
  GuildMember,
  AttachmentBuilder,
} from 'discord.js';
import { getConfig, updateConfig, TicketPanel, TicketFormField } from '../config';
import {
  createTicket,
  getTicket,
  getTicketByChannel,
  updateTicket,
  closeTicket,
  claimTicket,
  unclaimTicket,
  getTicketsByCreator,
  getNextTicketNumber,
  updateTicketActivity,
} from '../db';
import { canAssignRole } from '../utils/discord';

export const TICKET_OPEN_PREFIX = 'ticket:open:';
export const TICKET_CLOSE_PREFIX = 'ticket:close:';
export const TICKET_CLAIM_PREFIX = 'ticket:claim:';
export const TICKET_UNCLAIM_PREFIX = 'ticket:unclaim:';
export const TICKET_TRANSCRIPT_PREFIX = 'ticket:transcript:';

export const TICKET_MODAL_PREFIX = 'ticket:modal:';

/**
 * Route ticket-related button interactions.
 */
export async function handleTicketButton(interaction: ButtonInteraction): Promise<boolean> {
  const customId = interaction.customId;

  if (customId.startsWith(TICKET_OPEN_PREFIX)) {
    const panelId = customId.slice(TICKET_OPEN_PREFIX.length);
    await handleTicketOpen(interaction, panelId);
    return true;
  }

  if (customId.startsWith(TICKET_CLOSE_PREFIX)) {
    const ticketId = customId.slice(TICKET_CLOSE_PREFIX.length);
    await handleTicketClose(interaction, ticketId);
    return true;
  }

  if (customId.startsWith(TICKET_CLAIM_PREFIX)) {
    const ticketId = customId.slice(TICKET_CLAIM_PREFIX.length);
    await handleTicketClaim(interaction, ticketId);
    return true;
  }

  if (customId.startsWith(TICKET_UNCLAIM_PREFIX)) {
    const ticketId = customId.slice(TICKET_UNCLAIM_PREFIX.length);
    await handleTicketUnclaim(interaction, ticketId);
    return true;
  }

  if (customId.startsWith(TICKET_TRANSCRIPT_PREFIX)) {
    const ticketId = customId.slice(TICKET_TRANSCRIPT_PREFIX.length);
    await handleTicketTranscript(interaction, ticketId);
    return true;
  }

  return false;
}

/**
 * Route ticket modal submissions.
 */
export async function handleTicketModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  const customId = interaction.customId;
  if (!customId.startsWith(TICKET_MODAL_PREFIX)) return false;

  const panelId = customId.slice(TICKET_MODAL_PREFIX.length);
  await handleTicketModalSubmit(interaction, panelId);
  return true;
}

/* ------------------------------------------------------------------ */
/* Open ticket                                                         */
/* ------------------------------------------------------------------ */

async function handleTicketOpen(interaction: ButtonInteraction, panelId: string): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const cfg = getConfig();
  const panel = cfg.tickets.panels.find((p) => p.id === panelId);
  if (!panel) {
    await safeReply(interaction, { content: 'Ticket panel not found.', ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;

  // Check if user already has an open ticket in this panel
  const existing = getTicketsByCreator(member.id).find(
    (t) => t.panelId === panelId && (t.status === 'open' || t.status === 'claimed'),
  );
  if (existing) {
    await safeReply(interaction, {
      content: `You already have an open ticket in <#${existing.channelId}>.`,
      ephemeral: true,
    });
    return;
  }

  // If panel has form fields, show modal first
  if (panel.formFields && panel.formFields.length > 0) {
    await showTicketModal(interaction, panel);
    return;
  }

  await createTicketChannel(interaction, panel, member, []);
}

/**
 * Show the ticket creation modal with form fields.
 */
async function showTicketModal(interaction: ButtonInteraction, panel: TicketPanel): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`${TICKET_MODAL_PREFIX}${panel.id}`)
    .setTitle(`New Ticket — ${panel.name}`);

  for (const field of panel.formFields) {
    const input = new TextInputBuilder()
      .setCustomId(`field:${field.id}`)
      .setLabel(field.label)
      .setStyle(field.type === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required)
      .setPlaceholder(field.placeholder || '');
    if (field.maxLength) input.setMaxLength(field.maxLength);
    if (field.minLength) input.setMinLength(field.minLength);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }

  await (interaction as any).showModal(modal).catch(() => undefined);
}

/**
 * Handle modal submission - collect form responses and create ticket.
 */
async function handleTicketModalSubmit(interaction: ModalSubmitInteraction, panelId: string): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const cfg = getConfig();
  const panel = cfg.tickets.panels.find((p) => p.id === panelId);
  if (!panel) {
    await interaction.reply({ content: 'Ticket panel not found.', ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;

  // Check for existing open ticket
  const existing = getTicketsByCreator(member.id).find(
    (t) => t.panelId === panelId && (t.status === 'open' || t.status === 'claimed'),
  );
  if (existing) {
    await interaction.reply({
      content: `You already have an open ticket in <#${existing.channelId}>.`,
      ephemeral: true,
    });
    return;
  }

  // Collect form responses
  const formResponses: { fieldId: string; label: string; value: string }[] = [];
  for (const field of panel.formFields) {
    const value = interaction.fields.getTextInputValue(`field:${field.id}`);
    formResponses.push({ fieldId: field.id, label: field.label, value });
  }

  await interaction.deferReply({ ephemeral: true });
  await createTicketChannel(interaction as any, panel, member, formResponses);
  await interaction.editReply({
    content: `✅ Ticket created! Check <#${getConfig().tickets.categoryId} category> for your new ticket channel.`,
  });
}

/**
 * Create the ticket channel and database record.
 */
async function createTicketChannel(
  interaction: ButtonInteraction | any,
  panel: TicketPanel,
  member: GuildMember,
  formResponses: { fieldId: string; label: string; value: string }[],
): Promise<void> {
  const guild = interaction.guild || interaction.client.guilds.cache.get(interaction.guildId!);
  if (!guild) return;

  const cfg = getConfig();
  const category = await guild.channels.fetch(panel.categoryId).catch(() => null);
  if (!category || category.type !== 4) {
    // GUILD_CATEGORY = 4
    await safeReply(interaction, { content: 'Ticket category not found.', ephemeral: true });
    return;
  }

  const ticketNumber = getNextTicketNumber();
  const ticketId = `T-${ticketNumber}`;
  const channelName = `ticket-${ticketNumber.toString().padStart(4, '0')}`;

  // Permission overwrites
  const overwrites: Array<{ id: string; allow?: string[]; deny?: string[] }> = [
    { id: guild.id, deny: ['ViewChannel'] },
    { id: member.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles'] },
  ];

  // Staff roles can see the ticket
  const staffRoles = panel.staffRoles.length > 0 ? panel.staffRoles : cfg.tickets.defaultStaffRoles;
  for (const roleId of staffRoles) {
    overwrites.push({ id: roleId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages'] });
  }

  let channel: TextChannel;
  try {
    channel = (await guild.channels.create({
      name: channelName,
      type: 0,
      parent: category.id,
      permissionOverwrites: overwrites as any,
      topic: `Ticket #${ticketNumber} | Created by ${member.user.tag} (${member.id}) | Panel: ${panel.name}`,
    })) as TextChannel;
  } catch (err) {
    console.error('Failed to create ticket channel:', err);
    await safeReply(interaction, { content: 'Failed to create ticket channel. Check my permissions.', ephemeral: true });
    return;
  }

  // Create ticket record
  const now = Date.now();
  createTicket({
    id: ticketId,
    channelId: channel.id,
    panelId: panel.id,
    creatorId: member.id,
    status: 'open',
    createdAt: now,
    formResponses: formResponses,
    lastActivity: now,
  });

  // Build welcome embed
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎫 Ticket #${ticketNumber}`)
    .setDescription(
      panel.welcomeMessage.replace(/{user}/g, `<@${member.id}>`).replace(/{panel}/g, panel.name),
    )
    .addFields(
      { name: 'Creator', value: `<@${member.id}>`, inline: true },
      { name: 'Status', value: 'Open', inline: true },
      { name: 'Panel', value: panel.name, inline: true },
    )
    .setTimestamp();

  if (formResponses.length > 0) {
    embed.addFields({
      name: 'Form Responses',
      value: formResponses.map((f) => `**${f.label}:** ${f.value}`).join('\n'),
      inline: false,
    });
  }

  // Build action buttons
  const claimButton = new ButtonBuilder()
    .setCustomId(`${TICKET_CLAIM_PREFIX}${ticketId}`)
    .setLabel('Claim')
    .setStyle(ButtonStyle.Success)
    .setEmoji('👋');

  const closeButton = new ButtonBuilder()
    .setCustomId(`${TICKET_CLOSE_PREFIX}${ticketId}`)
    .setLabel('Close')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🔒');

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(claimButton, closeButton);

  // Send welcome message
  let content = '';
  if (panel.pingOnCreate && panel.pingRoles.length > 0) {
    content = panel.pingRoles.map((r) => `<@&${r}>`).join(' ');
  } else if (panel.pingOnCreate && staffRoles.length > 0) {
    content = staffRoles.map((r) => `<@&${r}>`).join(' ');
  }

  await channel.send({ content, embeds: [embed], components: [row] });

  // Log to log channel
  await logTicketEvent(guild, 'OPEN', ticketId, member, channel, panel);

  // Try to notify user (ephemeral reply from original interaction)
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `✅ Ticket opened: <#${channel.id}>`,
        ephemeral: true,
      });
    }
  } catch {
    // Ignore
  }
}

/* ------------------------------------------------------------------ */
/* Close ticket                                                        */
/* ------------------------------------------------------------------ */

async function handleTicketClose(interaction: ButtonInteraction, ticketId: string): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ticket = getTicket(ticketId);
  if (!ticket) {
    await safeReply(interaction, { content: 'Ticket not found.', ephemeral: true });
    return;
  }

  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    await safeReply(interaction, { content: 'Ticket channel not found.', ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;
  const cfg = getConfig();
  const panel = cfg.tickets.panels.find((p) => p.id === ticket.panelId);

  // Permission check: creator, staff, or admin
  const panelStaffRoles = panel?.staffRoles ?? [];
  const staffRoles = panelStaffRoles.length > 0 ? panelStaffRoles : cfg.tickets.defaultStaffRoles;
  const isStaff = staffRoles.some((r) => member.roles.cache.has(r));
  const isAdmin = member.permissions.has('ManageGuild');
  const isCreator = ticket.creatorId === member.id;

  if (!isCreator && !isStaff && !isAdmin) {
    await safeReply(interaction, { content: 'You do not have permission to close this ticket.', ephemeral: true });
    return;
  }

  // Generate transcript if enabled
  let transcriptUrl: string | undefined;
  if (panel?.transcriptsEnabled) {
    transcriptUrl = await generateTranscript(channel as TextChannel, ticketId);
  }

  // Close in DB
  closeTicket(ticketId, member.id, undefined, transcriptUrl);

  // Update embed to show closed
  try {
    const messages = await channel.messages.fetch({ limit: 10 });
    const welcomeMsg = messages.find((m) => m.author.id === guild.members.me!.id && m.embeds.length > 0);
    if (welcomeMsg) {
      const oldEmbed = welcomeMsg.embeds[0];
      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle(`🔒 Ticket Closed — #${ticketId.slice(2)}`)
        .setDescription(oldEmbed.data.description || '')
        .addFields(oldEmbed.data.fields || [])
        .setTimestamp();
      await welcomeMsg.edit({ embeds: [embed], components: [] });
    }
  } catch {
    // Ignore
  }

  await safeReply(interaction, {
    content: `✅ Ticket #${ticketId.slice(2)} closed by ${member.user.tag}.`,
    ephemeral: false,
  });

  // Log
  await logTicketEvent(guild, 'CLOSE', ticketId, member, channel as TextChannel, panel);

  // Optionally delete channel after delay or notify
  setTimeout(async () => {
    try {
      await channel.delete().catch(() => undefined);
    } catch {
      // Ignore
    }
  }, 5000);
}

/* ------------------------------------------------------------------ */
/* Claim ticket                                                        */
/* ------------------------------------------------------------------ */

async function handleTicketClaim(interaction: ButtonInteraction, ticketId: string): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ticket = getTicket(ticketId);
  if (!ticket) {
    await safeReply(interaction, { content: 'Ticket not found.', ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;
  const cfg = getConfig();
  const panel = cfg.tickets.panels.find((p) => p.id === ticket.panelId);
  const panelStaffRoles = panel?.staffRoles ?? [];
  const staffRoles = panelStaffRoles.length > 0 ? panelStaffRoles : cfg.tickets.defaultStaffRoles;

  const isStaff = staffRoles.some((r) => member.roles.cache.has(r));
  const isAdmin = member.permissions.has('ManageGuild');

  if (!isStaff && !isAdmin) {
    await safeReply(interaction, { content: 'Only staff can claim tickets.', ephemeral: true });
    return;
  }

  if (ticket.status === 'closed') {
    await safeReply(interaction, { content: 'This ticket is already closed.', ephemeral: true });
    return;
  }

  if (ticket.status === 'claimed' && ticket.claimedBy === member.id) {
    await safeReply(interaction, { content: 'You have already claimed this ticket.', ephemeral: true });
    return;
  }

  claimTicket(ticketId, member.id);

  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (channel && channel.isTextBased()) {
    await (channel as TextChannel).send(
      `👋 <@${member.id}> has claimed this ticket. They will be assisting you shortly.`,
    );
  }

  await safeReply(interaction, { content: `✅ You claimed ticket #${ticketId.slice(2)}.`, ephemeral: true });

  await logTicketEvent(guild, 'CLAIM', ticketId, member, channel as TextChannel, panel);
}

/* ------------------------------------------------------------------ */
/* Unclaim ticket                                                      */
/* ------------------------------------------------------------------ */

async function handleTicketUnclaim(interaction: ButtonInteraction, ticketId: string): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ticket = getTicket(ticketId);
  if (!ticket) {
    await safeReply(interaction, { content: 'Ticket not found.', ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;
  const cfg = getConfig();
  const panel = cfg.tickets.panels.find((p) => p.id === ticket.panelId);
  const panelStaffRoles = panel?.staffRoles ?? [];
  const staffRoles = panelStaffRoles.length > 0 ? panelStaffRoles : cfg.tickets.defaultStaffRoles;

  const isStaff = staffRoles.some((r) => member.roles.cache.has(r));
  const isAdmin = member.permissions.has('ManageGuild');

  if (!isStaff && !isAdmin) {
    await safeReply(interaction, { content: 'Only staff can unclaim tickets.', ephemeral: true });
    return;
  }

  if (ticket.status !== 'claimed' || ticket.claimedBy !== member.id) {
    await safeReply(interaction, { content: 'You have not claimed this ticket.', ephemeral: true });
    return;
  }

  unclaimTicket(ticketId);

  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (channel && channel.isTextBased()) {
    await (channel as TextChannel).send(`➖ <@${member.id}> has unclaimed this ticket.`);
  }

  await safeReply(interaction, { content: `✅ You unclaimed ticket #${ticketId.slice(2)}.`, ephemeral: true });

  await logTicketEvent(guild, 'UNCLAIM', ticketId, member, channel as TextChannel, panel);
}

/* ------------------------------------------------------------------ */
/* Transcript                                                          */
/* ------------------------------------------------------------------ */

async function handleTicketTranscript(interaction: ButtonInteraction, ticketId: string): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ticket = getTicket(ticketId);
  if (!ticket) {
    await safeReply(interaction, { content: 'Ticket not found.', ephemeral: true });
    return;
  }

  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    await safeReply(interaction, { content: 'Ticket channel not found.', ephemeral: true });
    return;
  }

  const transcriptUrl = await generateTranscript(channel as TextChannel, ticketId);
  updateTicket(ticketId, { transcriptUrl: transcriptUrl });

  await safeReply(interaction, {
    content: `📄 Transcript for ticket #${ticketId.slice(2)}: ${transcriptUrl}`,
    ephemeral: true,
  });
}

/**
 * Generate a text transcript of a ticket channel.
 */
async function generateTranscript(channel: TextChannel, ticketId: string): Promise<string> {
  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  let transcript = `Transcript for Ticket ${ticketId}\n`;
  transcript += `Channel: #${channel.name}\n`;
  transcript += `Generated: ${new Date().toISOString()}\n`;
  transcript += '='.repeat(50) + '\n\n';

  for (const msg of sorted.values()) {
    transcript += `[${msg.createdAt.toISOString()}] ${msg.author.tag} (${msg.author.id}): ${msg.content}\n`;
    if (msg.attachments.size > 0) {
      for (const [, att] of msg.attachments) {
        transcript += `  Attachment: ${att.url}\n`;
      }
    }
  }

  // Save to file
  const fs = await import('fs');
  const path = await import('path');
  const transcriptsDir = path.join(process.cwd(), 'data', 'transcripts');
  if (!fs.existsSync(transcriptsDir)) {
    fs.mkdirSync(transcriptsDir, { recursive: true });
  }
  const fileName = `${ticketId}-${Date.now()}.txt`;
  const filePath = path.join(transcriptsDir, fileName);
  fs.writeFileSync(filePath, transcript, 'utf8');

  // Return a local file path reference (in production, upload to a paste service)
  return `file://${filePath}`;
}

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

async function logTicketEvent(
  guild: any,
  event: string,
  ticketId: string,
  member: GuildMember,
  channel: TextChannel,
  panel: TicketPanel | undefined,
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.tickets.logChannelId) return;

  const logChannel = await guild.channels.fetch(cfg.tickets.logChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(event === 'OPEN' ? 0x57f287 : event === 'CLOSE' ? 0xed4245 : 0xf59e42)
    .setTitle(`🎫 Ticket ${event}`)
    .addFields(
      { name: 'Ticket ID', value: `#${ticketId.slice(2)}`, inline: true },
      { name: 'Panel', value: panel?.name || 'Unknown', inline: true },
      { name: 'Channel', value: `<#${channel.id}>`, inline: true },
      { name: 'User', value: `<@${member.id}>`, inline: true },
    )
    .setTimestamp();

  await (logChannel as TextChannel).send({ embeds: [embed] }).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Safe reply                                                          */
/* ------------------------------------------------------------------ */

async function safeReply(
  interaction: ButtonInteraction,
  options: { content: string; ephemeral: boolean },
): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(options).catch(() => undefined);
    } else {
      await interaction.reply(options).catch(() => undefined);
    }
  } catch {
    // Ignore
  }
}
