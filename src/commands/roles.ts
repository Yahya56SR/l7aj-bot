import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  TextChannel,
  Role,
  Message,
} from 'discord.js';
import { getConfig, updateConfig, PanelButton, RolePanel } from '../config';
import { canAssignRole } from '../utils/discord';
import { buildPanelRows, MAX_BUTTONS } from '../handlers/buttons';

export const data = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Self-assign role panels driven by buttons')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Create a new self-assign role panel')
      .addStringOption((o) =>
        o.setName('name').setDescription('Name of the panel, e.g. "Games"').setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to post the panel in')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      )
      .addStringOption((o) => o.setName('title').setDescription('Embed title'))
      .addStringOption((o) => o.setName('description').setDescription('Embed description')),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('panel')
      .setDescription('Manage an existing role panel')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add a role button to a panel')
          .addStringOption((o) =>
            o
              .setName('panel')
              .setDescription('Panel to add the button to')
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true))
          .addStringOption((o) =>
            o.setName('label').setDescription('Button text (defaults to role name)'),
          )
          .addStringOption((o) =>
            o.setName('emoji').setDescription('Button emoji (unicode or <:name:id>)'),
          )
          .addStringOption((o) =>
            o
              .setName('style')
              .setDescription('Button colour')
              .addChoices(
                { name: 'Grey', value: 'secondary' },
                { name: 'Blurple', value: 'primary' },
                { name: 'Green', value: 'success' },
                { name: 'Red', value: 'danger' },
              ),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove a role button from a panel')
          .addStringOption((o) =>
            o
              .setName('panel')
              .setDescription('Panel to remove the button from')
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('list')
          .setDescription('Show all panels, or the buttons of one panel')
          .addStringOption((o) =>
            o
              .setName('panel')
              .setDescription('Panel to inspect (omit to list every panel)')
              .setAutocomplete(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('delete')
          .setDescription('Delete a panel and its message')
          .addStringOption((o) =>
            o
              .setName('panel')
              .setDescription('Panel to delete')
              .setRequired(true)
              .setAutocomplete(true),
          ),
      ),
  );

const STYLE_MAP: Record<string, number> = {
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
};

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  if (group === 'panel') {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'add':
        return add(interaction);
      case 'remove':
        return remove(interaction);
      case 'list':
        return list(interaction);
      case 'delete':
        return removePanel(interaction);
      default:
        return;
    }
  }

  if (interaction.options.getSubcommand() === 'setup') {
    return setup(interaction);
  }
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused();
  const panels = getConfig().roles.panels;

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
  const name = interaction.options.getString('name', true).trim();
  const channelOption = interaction.options.getChannel('channel', true);
  const channel = await guild.channels.fetch(channelOption.id).catch(() => null);
  const title = interaction.options.getString('title') || `🎭 ${name}`;
  const description =
    interaction.options.getString('description') ||
    'Click a button to get the role. Click it again to remove it.';

  if (!channel || !channel.isTextBased()) {
    await interaction.reply({ content: 'Please pick a text channel.', ephemeral: true });
    return;
  }

  const panels = getConfig().roles.panels;
  if (panels.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    await interaction.reply({
      content: `A panel named **${name}** already exists. Pick a different name.`,
      ephemeral: true,
    });
    return;
  }

  const id = nextPanelId(panels);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(description);

  try {
    const message = await (channel as TextChannel).send({ embeds: [embed] });

    updateConfig((cfg) => {
      cfg.guildId = cfg.guildId || guild.id;
      cfg.roles.panels.push({
        id,
        name,
        messageId: message.id,
        channelId: channel.id,
        title,
        description,
        buttons: [],
      });
    });

    await interaction.reply({
      content: `✅ Panel **${name}** posted in <#${channel.id}>.\nAdd buttons with \`/roles panel add panel:${name} role:@Role\`.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error('Failed to create role panel:', err);
    await interaction.reply({
      content: 'I could not post in that channel. Check my permissions and try again.',
      ephemeral: true,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Panel add / remove                                                  */
/* ------------------------------------------------------------------ */

async function add(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const panel = resolvePanel(interaction.options.getString('panel', true));
  if (!panel) return;

  const role = interaction.options.getRole('role', true) as Role;
  const label = interaction.options.getString('label') || role.name.slice(0, 80);
  const emoji = interaction.options.getString('emoji') || '';
  const styleKey = interaction.options.getString('style') || 'secondary';

  const error = canAssignRole(guild, role);
  if (error) {
    await interaction.reply({ content: error, ephemeral: true });
    return;
  }

  if (panel.buttons.some((b) => b.roleId === role.id)) {
    await interaction.reply({
      content: `**${role.name}** is already on the **${panel.name}** panel.`,
      ephemeral: true,
    });
    return;
  }

  if (panel.buttons.length >= MAX_BUTTONS) {
    await interaction.reply({
      content: `That panel already has the maximum of ${MAX_BUTTONS} buttons.`,
      ephemeral: true,
    });
    return;
  }

  const entry: PanelButton = {
    roleId: role.id,
    label,
    emoji,
    style: STYLE_MAP[styleKey] ?? STYLE_MAP.secondary,
  };

  updateConfig((c) => {
    const target = c.roles.panels.find((p) => p.id === panel.id);
    if (target) target.buttons.push(entry);
  });

  const refreshed = await refreshPanel(guild, panel.id);
  if (!refreshed) {
    await interaction.reply({
      content:
        'The button was saved, but I could not update the panel message. Delete and recreate the panel with `/roles setup`.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `✅ **${role.name}** added to the **${panel.name}** panel as "${label}".`,
    ephemeral: true,
  });
}

async function remove(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const panel = resolvePanel(interaction.options.getString('panel', true));
  if (!panel) return;

  const role = interaction.options.getRole('role', true) as Role;

  if (!panel.buttons.some((b) => b.roleId === role.id)) {
    await interaction.reply({
      content: `**${role.name}** is not on the **${panel.name}** panel.`,
      ephemeral: true,
    });
    return;
  }

  updateConfig((c) => {
    const target = c.roles.panels.find((p) => p.id === panel.id);
    if (target) target.buttons = target.buttons.filter((b) => b.roleId !== role.id);
  });

  const refreshed = await refreshPanel(guild, panel.id);
  if (!refreshed) {
    await interaction.reply({
      content: 'The button was removed, but I could not update the panel message.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `✅ **${role.name}** removed from the **${panel.name}** panel. Members keep the role until they click the button again.`,
    ephemeral: true,
  });
}

/* ------------------------------------------------------------------ */
/* Panel list / delete                                                 */
/* ------------------------------------------------------------------ */

async function list(interaction: ChatInputCommandInteraction): Promise<void> {
  const panels = getConfig().roles.panels;
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🎭 Role panels');

  if (panels.length === 0) {
    embed.setDescription('No panels yet. Create one with `/roles setup`.');
  } else {
    embed.setDescription(
      panels
        .map(
          (panel) =>
            `**${panel.name}** — <#${panel.channelId}> · ${panel.buttons.length} button(s)`,
        )
        .join('\n'),
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function removePanel(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const panel = resolvePanel(interaction.options.getString('panel', true));
  if (!panel) return;

  // Try to delete the panel message
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
    c.roles.panels = c.roles.panels.filter((p) => p.id !== panel.id);
  });

  await interaction.reply({
    content: `✅ Panel **${panel.name}** deleted. Members keep any roles they already had.`,
    ephemeral: true,
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function nextPanelId(panels: RolePanel[]): string {
  let index = panels.length + 1;
  const used = new Set(panels.map((p) => p.id));
  while (used.has(`p${index}`)) index++;
  return `p${index}`;
}

function resolvePanel(idOrName: string): RolePanel | null {
  const panels = getConfig().roles.panels;
  return (
    panels.find((p) => p.id === idOrName) ||
    panels.find((p) => p.name.toLowerCase() === idOrName.toLowerCase()) ||
    undefined
  ) || null;
}

/**
 * Re-render a panel message from the current config.
 */
async function refreshPanel(guild: any, panelId: string): Promise<Message | null> {
  const panel = getConfig().roles.panels.find((p) => p.id === panelId);
  if (!panel || !panel.messageId || !panel.channelId) return null;

  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;

  const message = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!message) return null;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(panel.title)
    .setDescription(panel.description);

  await message.edit({
    embeds: [embed],
    components: buildPanelRows(panel.buttons),
  });

  return message;
}
