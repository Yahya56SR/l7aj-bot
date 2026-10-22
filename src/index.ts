import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { REST } from '@discordjs/rest';
import dotenv from 'dotenv';
import { getConfig, loadConfig } from './config';
import { initDb, initializeTotalMembers } from './db';
import { registerCommands } from './handlers/registerCommands';
import { handleButtonInteraction } from './handlers/buttons';
import { handleTicketButton, handleTicketModal, runTicketAutoClose } from './handlers/tickets';
import * as rankCmd from './commands/rank';
import * as leaderboardCmd from './commands/leaderboard';
import * as reactionRolesCmd from './commands/reactionroles';
import * as rolesCmd from './commands/roles';
import * as levelsCmd from './commands/levels';
import * as xpCmd from './commands/xp';
import * as verifyCmd from './commands/verify';
import * as configCmd from './commands/config';
import * as ticketsCmd from './commands/tickets';
import { handleMessageCreate } from './events/messageCreate';
import { handleVoiceStateUpdate, handleVoiceTick } from './events/voiceStateUpdate';
import { handleReactionAdd, handleReactionRemove } from './events/messageReaction';
import { handleGuildMemberAdd, handleGuildMemberRemove } from './events/guildMember';
import { registerLoggingEvents } from './events/logging';
import { logCommandUsage } from './utils/logger';
import { startDashboard } from './dashboard/server';

dotenv.config();
loadConfig();

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

client.commands = new Collection();
client.commands.set(rankCmd.data.name, rankCmd);
client.commands.set(leaderboardCmd.data.name, leaderboardCmd);
client.commands.set(reactionRolesCmd.data.name, reactionRolesCmd);
client.commands.set(rolesCmd.data.name, rolesCmd);
client.commands.set(levelsCmd.data.name, levelsCmd);
client.commands.set(xpCmd.data.name, xpCmd);
client.commands.set(verifyCmd.data.name, verifyCmd);
client.commands.set(configCmd.data.name, configCmd);
client.commands.set(ticketsCmd.data.name, ticketsCmd);

// Register server logging event listeners (roles, members, channels, messages)
registerLoggingEvents(client);

let voiceTickInterval: ReturnType<typeof setInterval> | null = null;
let ticketSweepInterval: ReturnType<typeof setInterval> | null = null;

client.on('clientReady', () => {
  console.log(`Logged in as ${client.user?.tag} (${client.user?.id})`);
  // Initialize total member count from current guild member count
  const cfg = getConfig();
  const guild = client.guilds.cache.get(cfg.guildId);
  if (guild) {
    initializeTotalMembers(guild.memberCount);
  }
  // Award voice XP every minute to users still in VC.
  // `ready` can fire again after a reconnect, so replace any old interval
  // instead of stacking a second one (which would double-award XP).
  if (voiceTickInterval) clearInterval(voiceTickInterval);
  voiceTickInterval = setInterval(async () => {
    try {
      await handleVoiceTick(client);
    } catch (err) {
      console.error('Voice tick error:', err);
    }
  }, 60 * 1000);

  // Close tickets whose panel has autoCloseHours configured and that have been
  // idle longer than that. Runs every 5 minutes.
  if (ticketSweepInterval) clearInterval(ticketSweepInterval);
  ticketSweepInterval = setInterval(async () => {
    try {
      await runTicketAutoClose(client);
    } catch (err) {
      console.error('Ticket auto-close error:', err);
    }
  }, 5 * 60 * 1000);
});

client.on('messageCreate', async (message) => {
  try {
    await handleMessageCreate(message);
  } catch (err) {
    console.error('Message create handler error:', err);
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    handleVoiceStateUpdate(oldState, newState);
  } catch (err) {
    console.error('Voice state update handler error:', err);
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    await handleReactionAdd(reaction, user);
  } catch (err) {
    console.error('Message reaction add handler error:', err);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    await handleReactionRemove(reaction, user);
  } catch (err) {
    console.error('Message reaction remove handler error:', err);
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    // Ensure we have a full GuildMember (fetch if partial)
    if (member.partial) {
      try {
        await member.fetch();
      } catch (fetchErr) {
        console.error('Failed to fetch partial member on join:', fetchErr);
      }
    }
    await handleGuildMemberAdd(member);
  } catch (err) {
    console.error('Guild member add handler error:', err);
  }
});

client.on('guildMemberRemove', async (member) => {
  try {
    // Ensure we have a full GuildMember (fetch if partial)
    if (member.partial) {
      try {
        await member.fetch();
      } catch (fetchErr) {
        console.error('Failed to fetch partial member on leave:', fetchErr);
      }
    }
    await handleGuildMemberRemove(member);
  } catch (err) {
    console.error('Guild member remove handler error:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  // Ticket modal submissions
  if (interaction.isModalSubmit()) {
    try {
      const handled = await handleTicketModal(interaction);
      if (!handled) {
        // Let other handlers deal with it if needed
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Interaction not recognized.', ephemeral: true });
        }
      }
    } catch (err) {
      console.error('Ticket modal handler error:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Something went wrong handling that form.', ephemeral: true }).catch(() => undefined);
      }
    }
    return;
  }

  // Button clicks (role panels + verification + tickets)
  if (interaction.isButton()) {
    const customId = interaction.customId;
    if (customId.startsWith('ticket:')) {
      try {
        await handleTicketButton(interaction);
      } catch (err) {
        console.error('Ticket button interaction failed:', err);
        if (!interaction.replied && !interaction.deferred) {
          await interaction
            .reply({ content: 'Something went wrong handling that ticket button.', ephemeral: true })
            .catch(() => undefined);
        }
      }
      return;
    }
    try {
      await handleButtonInteraction(interaction);
    } catch (err) {
      console.error('Button interaction failed:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: 'Something went wrong handling that button.', ephemeral: true })
          .catch(() => undefined);
      }
    }
    return;
  }

  // Autocomplete (panel name picker)
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd && typeof (cmd as any).autocomplete === 'function') {
      try {
        await (cmd as any).autocomplete(interaction);
      } catch (err) {
        console.error('Autocomplete failed:', err);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  // Log slash command usage to the server logs channel
  logCommandUsage(interaction, client as { channels: { cache: Map<string, any> } }).catch((err) =>
    console.error('[Logging] command usage error:', err),
  );

  try {
    await (cmd as any).execute(interaction);
  } catch (err) {
    console.error(err);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'There was an error executing that command.', ephemeral: true }).catch(() => undefined);
    } else {
      await interaction.reply({ content: 'There was an error executing that command.', ephemeral: true }).catch(() => undefined);
    }
  }
});

// Handle process shutdown gracefully
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (voiceTickInterval) clearInterval(voiceTickInterval);
  if (ticketSweepInterval) clearInterval(ticketSweepInterval);
  dashboardServer?.close();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  if (voiceTickInterval) clearInterval(voiceTickInterval);
  if (ticketSweepInterval) clearInterval(ticketSweepInterval);
  dashboardServer?.close();
  client.destroy();
  process.exit(0);
});

initDb();

// Start the local configuration dashboard. This happens before Discord login
// so settings can still be fixed when the token or intents are wrong.
const dashboardServer = startDashboard(client);

const commands = [
  rankCmd.data,
  leaderboardCmd.data,
  reactionRolesCmd.data,
  rolesCmd.data,
  levelsCmd.data,
  xpCmd.data,
  verifyCmd.data,
  configCmd.data,
  ticketsCmd.data,
];

async function start(): Promise<void> {
  const cfg = getConfig();
  const token = process.env.BOT_TOKEN || cfg.token;
  const clientId = process.env.CLIENT_ID || cfg.clientId;
  const guildId = process.env.GUILD_ID || cfg.guildId;

  if (!token || token === 'YOUR_BOT_TOKEN_HERE') {
    console.error('\n❌ No bot token configured.');
    console.error('   Add BOT_TOKEN to .env, or set "token" in config.json.\n');
    process.exitCode = 1;
    return;
  }

  if (!clientId || !guildId || clientId === 'YOUR_APPLICATION_CLIENT_ID_HERE') {
    console.error('\n❌ Client ID or Guild ID is missing.');
    console.error('   Add CLIENT_ID and GUILD_ID to .env, or set them in config.json.\n');
    process.exitCode = 1;
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('Registering slash commands...');
    await registerCommands(rest, commands, clientId, guildId);
    console.log('Slash commands registered.');

    await client.login(token);
  } catch (err: any) {
    if (err?.status === 401 || err?.code === 'TokenInvalid') {
      console.error('\n❌ Discord rejected the bot token (401 Unauthorized).\n');
      console.error('   The token was reset/revoked, or it is the CLIENT SECRET');
      console.error('   instead of the BOT TOKEN (both look like "xxx.yyy.zzz").\n');
      console.error('   Fix:');
      console.error('     1. Developer Portal → your app → Bot → "Reset Token"');
      console.error('     2. Copy the BOT TOKEN (not the client secret)');
      console.error('     3. Put it in .env (BOT_TOKEN=...) or config.json ("token")');
      console.error('     4. Restart the bot\n');
    } else if (err?.status === 403) {
      console.error('\n❌ Missing Access (403). The bot is not in that server.');
      console.error('   Invite it with the link from Developer Portal → Bot page.\n');
    } else {
      console.error('Failed to start bot:', err);
    }
    process.exitCode = 1;
    return;
  }
}

start();
