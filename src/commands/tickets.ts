import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  TextChannel,
  Role,
  CategoryChannel,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  Message,
} from 'discord.js';
import { getConfig, updateConfig, TicketPanel } from '../config';
import {
  getNextTicketNumber,
  createTicket,
  getTicket,
  getTicketByChannel,
  getTicketsByCreator,
  getTicketsByPanel,
  getOpenTickets,
  updateTicket,
  closeTicket,
  claimTicket,
  unclaimTicket,
  deleteTicket,
  getAllTickets,
} from '../db';
import { canAssignRole } from '../utils/discord';

export const data = new SlashCommandBuilder()
  .setName('tickets')
  .setDescription('Ticket system management')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommandGroup((group) =>
    group
      .setName('panel')
      .setDescription('Manage ticket panels')
      .addSubcommand((sub) =>
        sub
          .setName('create')
          .setDescription('Create a new ticket panel')
          .addStringOption((o) =>
            o.setName('name').setDescription('Panel name, e.g. "Support"').setRequired(true),
          )
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Channel to post the panel message')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          )
          .addChannelOption((o) =>
            o
              .setName('category')
              .setDescription('Category where ticket channels will be created')
              .addChannelTypes(ChannelType.GuildCategory)
              .setRequired(true),
          )
          .addStringOption((o) => o.setName('title').setDescription('Panel embed title'))
          .addStringOption((o) => o.setName('description').setDescription('Panel embed description'))
          .addStringOption((o) =>
            o
              .setName('button-label')
              .setDescription('Button label (defaults to "Open Ticket")')
              .setRequired(false),
          )
          .addStringOption((o) =>
            o.setName('button-emoji').setDescription('Button emoji').setRequired(false),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('delete')
          .setDescription('Delete a ticket panel')
          .addStringOption((o) =>
            o
              .setName('panel')
              .setDescription('Panel to delete')
              .setRequired(true)
              .setAutocomplete(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('list')
          .setDescription('List all ticket panels'),
      )
      .addSubcommand((sub) =>
        sub
          .setName('config')
          .setDescription('Configure a ticket panel')
          .addStringOption((o) =>
            o
              .setName('panel')
              .setDescription('Panel to configure')
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addStringOption((o) =>
            o
              .setName('welcome-message')
              .setDescription('Welcome message in ticket channels. Placeholders: {user}, {panel}')
              .setRequired(false),
          )
          .addBooleanOption((o) =>
            o
              .setName('ping-on-create')
              .setDescription('Ping staff roles when a ticket is created'),
          )
          .addIntegerOption((o) =>
            o
              .setName('auto-close-hours')
              .setDescription('Auto-close after X hours of inactivity (0 = disabled)')
              .setMinValue(0)
              .setMaxValue(720),
          )
          .addBooleanOption((o) =>
            o
              .setName('transcripts')
              .setDescription('Enable transcripts when tickets close'),
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Quick setup: create ticket category and log channel')
      .addChannelOption((o) =>
        o
          .setName('category')
          .setDescription('Category for ticket channels')
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(false),
      )
      .addChannelOption((o) =>
        o
          .setName('log-channel')
          .setDescription('Channel for ticket logs')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('Show ticket system status'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  if (group === 'panel') {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'create':
        return createPanel(interaction);
      case 'delete':
        return deletePanel(interaction);
      case 'list':
        return listPanels(interaction);
      case 'config':
        return configPanel(interaction);
      default:
        return;
    }
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'setup':
      return setup(interaction);
    case 'status':
      return status(interaction);
    default:
      return;
  }
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused();
  const panels = getConfig().tickets.panels;
  const choices = panels
    .filter((panel) => panel.name.toLowerCase().includes(focused.toLowerCase()))
    .slice(0, 25)
    .map((panel) => ({ name: panel.name, value: panel.id }));
  await interaction.respond(choices);
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

async function setup(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const categoryOption = interaction.options.getChannel('category');
  const logChannelOption = interaction.options.getChannel('log-channel');

  const category = categoryOption ? await guild.channels.fetch(categoryOption.id).catch(() => null) : null;
  const logChannel = logChannelOption
    ? await guild.channels.fetch(logChannelOption.id).catch(() => null)
    : null;

  updateConfig((cfg) => {
    cfg.tickets.categoryId = category?.id || cfg.tickets.categoryId;
    cfg.tickets.logChannelId = logChannel?.id || cfg.tickets.logChannelId;
  });

  const cfg = getConfig();
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎫 Ticket System Setup')
    .addFields(
      {
        name: 'Category',
        value: cfg.tickets.categoryId ? `<#${cfg.tickets.categoryId}>` : '(not set)',
        inline: true,
      },
      {
        name: 'Log Channel',
        value: cfg.tickets.logChannelId ? `<#${cfg.tickets.logChannelId}>` : '(not set)',
        inline: true,
      },
      {
        name: 'Panels',
        value: cfg.tickets.panels.length > 0 ? `${cfg.tickets.panels.length} panel(s)` : '(none)',
        inline: true,
      },
    )
    .setDescription(
      'Create ticket panels with `/tickets panel create`. Members open tickets by clicking buttons on panels.',
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Panel create                                                        */
/* ------------------------------------------------------------------ */

async function createPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const name = interaction.options.getString('name', true).trim();
  const channelOption = interaction.options.getChannel('channel', true);
  const categoryOption = interaction.options.getChannel('category', true);
  const title = interaction.options.getString('title') || `🎫 ${name}`;
  const description =
    interaction.options.getString('description') || 'Click the button below to open a support ticket.';
  const buttonLabel = interaction.options.getString('button-label') || 'Open Ticket';
  const buttonEmoji = interaction.options.getString('button-emoji') || '🎫';

  const channel = await guild.channels.fetch(channelOption.id).catch(() => null);
  const category = await guild.channels.fetch(categoryOption.id).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    await interaction.reply({ content: 'Please pick a text channel for the panel.', ephemeral: true });
    return;
  }

  if (!category || category.type !== ChannelType.GuildCategory) {
    await interaction.reply({ content: 'Please pick a category channel for ticket creation.', ephemeral: true });
    return;
  }

  const panels = getConfig().tickets.panels;
  if (panels.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    await interaction.reply({
      content: `A ticket panel named **${name}** already exists. Pick a different name.`,
      ephemeral: true,
    });
    return;
  }

  const id = nextPanelId(panels);
  const panel: TicketPanel = {
    id,
    name,
    channelId: channel.id,
    messageId: '',
    title,
    description,
    buttonLabel,
    buttonEmoji,
    buttonStyle: ButtonStyle.Primary,
    categoryId: category.id,
    staffRoles: [],
    pingRoles: [],
    formFields: [],
    welcomeMessage: '👋 Hello {user}! A staff member will be with you shortly.',
    pingOnCreate: true,
    autoCloseHours: 0,
    transcriptsEnabled: true,
    transcriptChannelId: '',
  };

  try {
    updateConfig((cfg) => {
      cfg.guildId = cfg.guildId || guild.id;
      cfg.tickets.categoryId = cfg.tickets.categoryId || category.id;
      cfg.tickets.panels.push(panel);
    });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: 'Click the button below to open a ticket.' })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:open:${id}`)
        .setLabel(buttonLabel)
        .setEmoji(buttonEmoji)
        .setStyle(ButtonStyle.Primary),
    );

    const message = await (channel as TextChannel).send({ embeds: [embed], components: [row] });

    updateConfig((cfg) => {
      const p = cfg.tickets.panels.find((x) => x.id === id);
      if (p) p.messageId = message.id;
    });

    await interaction.reply({
      content: `✅ Ticket panel **${name}** created in <#${channel.id}>. Category: <#${category.id}>\n` +
        `Configure staff roles and form fields with \`/tickets panel config\`.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error('Failed to create ticket panel:', err);
    updateConfig((cfg) => {
      cfg.tickets.panels = cfg.tickets.panels.filter((p) => p.id !== id);
    });
    await interaction.reply({
      content: 'I could not post in that channel. Check my permissions and try again.',
      ephemeral: true,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Panel delete                                                        */
/* ------------------------------------------------------------------ */

async function deletePanel(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const panel = resolvePanel(interaction.options.getString('panel', true));
  if (!panel) return;

  try {
    const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages.fetch(panel.messageId).catch(() => null);
      if (message) await message.delete();
    }
  } catch (err) {
    console.error('Failed to delete panel message:', err);
  }

  updateConfig((c) => {
    c.tickets.panels = c.tickets.panels.filter((p) => p.id !== panel.id);
  });

  await interaction.reply({
    content: `✅ Ticket panel **${panel.name}** deleted. Open tickets are not affected.`,
    ephemeral: true,
  });
}

/* ------------------------------------------------------------------ */
/* Panel list                                                          */
/* ------------------------------------------------------------------ */

async function listPanels(interaction: ChatInputCommandInteraction): Promise<void> {
  const panels = getConfig().tickets.panels;
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🎫 Ticket Panels');

  if (panels.length === 0) {
    embed.setDescription('No ticket panels yet. Create one with `/tickets panel create`.');
  } else {
    embed.setDescription(
      panels
        .map(
          (panel) =>
            `**${panel.name}** — <#${panel.channelId}> · Category: <#${panel.categoryId}> · ` +
            `${panel.staffRoles.length} staff role(s) · Auto-close: ${panel.autoCloseHours}h`,
        )
        .join('\n'),
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Panel config                                                        */
/* ------------------------------------------------------------------ */

async function configPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  const panel = resolvePanel(interaction.options.getString('panel', true));
  if (!panel) return;

  const welcomeMessage = interaction.options.getString('welcome-message');
  const pingOnCreate = interaction.options.getBoolean('ping-on-create');
  const autoCloseHours = interaction.options.getInteger('auto-close-hours');
  const transcripts = interaction.options.getBoolean('transcripts');

  if (welcomeMessage === null && pingOnCreate === null && autoCloseHours === null && transcripts === null) {
    // Show current config
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`⚙️ Ticket Panel Config: ${panel.name}`)
      .addFields(
        { name: 'Welcome Message', value: panel.welcomeMessage || '(not set)', inline: false },
        { name: 'Ping on Create', value: panel.pingOnCreate ? '✅ Enabled' : '❌ Disabled', inline: true },
        { name: 'Auto-close (hours)', value: panel.autoCloseHours === 0 ? 'Disabled' : `${panel.autoCloseHours}h`, inline: true },
        { name: 'Transcripts', value: panel.transcriptsEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
        { name: 'Staff Roles', value: panel.staffRoles.map((r) => `<@&${r}>`).join(', ') || '(none)', inline: false },
        { name: 'Ping Roles', value: panel.pingRoles.map((r) => `<@&${r}>`).join(', ') || '(none)', inline: false },
        { name: 'Form Fields', value: panel.formFields.length > 0 ? `${panel.formFields.length} field(s)` : '(none)', inline: false },
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  updateConfig((c) => {
    const target = c.tickets.panels.find((p) => p.id === panel.id);
    if (target) {
      if (welcomeMessage !== null) target.welcomeMessage = welcomeMessage;
      if (pingOnCreate !== null) target.pingOnCreate = pingOnCreate;
      if (autoCloseHours !== null) target.autoCloseHours = autoCloseHours;
      if (transcripts !== null) target.transcriptsEnabled = transcripts;
    }
  });

  await interaction.reply({
    content: `✅ Ticket panel **${panel.name}** updated.`,
    ephemeral: true,
  });
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

async function status(interaction: ChatInputCommandInteraction): Promise<void> {
  const cfg = getConfig();
  const panels = cfg.tickets.panels;
  const openTickets = getOpenTickets();

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎫 Ticket System Status')
    .addFields(
      {
        name: 'Category',
        value: cfg.tickets.categoryId ? `<#${cfg.tickets.categoryId}>` : '(not set)',
        inline: true,
      },
      {
        name: 'Log Channel',
        value: cfg.tickets.logChannelId ? `<#${cfg.tickets.logChannelId}>` : '(not set)',
        inline: true,
      },
      {
        name: 'Panels',
        value: `${panels.length}`,
        inline: true,
      },
      {
        name: 'Open Tickets',
        value: `${openTickets.length}`,
        inline: true,
      },
      {
        name: 'Total Tickets',
        value: `${getTicketCount()}`,
        inline: true,
      },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function nextPanelId(panels: TicketPanel[]): string {
  let index = panels.length + 1;
  const used = new Set(panels.map((p) => p.id));
  while (used.has(`t${index}`)) index++;
  return `t${index}`;
}

function resolvePanel(idOrName: string): TicketPanel | null {
  const panels = getConfig().tickets.panels;
  return (
    panels.find((p) => p.id === idOrName) ||
    panels.find((p) => p.name.toLowerCase() === idOrName.toLowerCase()) ||
    null
  );
}

function getTicketCount(): number {
  return getAllTickets().length;
}
