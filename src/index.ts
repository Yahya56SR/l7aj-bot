import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { REST } from '@discordjs/rest';
import dotenv from 'dotenv';
import { getConfig, loadConfig } from './config';
import { initDb } from './db';
import { registerCommands } from './handlers/registerCommands';
import { handleButtonInteraction } from './handlers/buttons';
import * as rankCmd from './commands/rank';
import * as leaderboardCmd from './commands/leaderboard';
import * as reactionRolesCmd from './commands/reactionroles';
import * as rolesCmd from './commands/roles';
import * as levelsCmd from './commands/levels';
import * as xpCmd from './commands/xp';
import * as verifyCmd from './commands/verify';
import * as configCmd from './commands/config';
import { handleMessageCreate } from './events/messageCreate';
import { handleVoiceStateUpdate, handleVoiceTick } from './events/voiceStateUpdate';
import { handleReactionAdd, handleReactionRemove } from './events/messageReaction';

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

client.on('ready', () => {
  console.log(`Logged in as ${client.user?.tag} (${client.user?.id})`);
  // Award voice XP every minute to users still in VC
  setInterval(() => {
    void handleVoiceTick(client);
  }, 60 * 1000);
});

client.on('messageCreate', handleMessageCreate);
client.on('voiceStateUpdate', handleVoiceStateUpdate);
client.on('messageReactionAdd', handleReactionAdd);
client.on('messageReactionRemove', handleReactionRemove);

client.on('interactionCreate', async (interaction) => {
  // Button clicks (role panels + verification)
  if (interaction.isButton()) {
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
  try {
    await (cmd as any).execute(interaction);
  } catch (err) {
    console.error(err);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'There was an error executing that command.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error executing that command.', ephemeral: true });
    }
  }
});

initDb();

const commands = [
  rankCmd.data,
  leaderboardCmd.data,
  reactionRolesCmd.data,
  rolesCmd.data,
  levelsCmd.data,
  xpCmd.data,
  verifyCmd.data,
  configCmd.data,
];

async function start(): Promise<void> {
  const cfg = getConfig();
  const token = process.env.BOT_TOKEN || cfg.token;
  const clientId = process.env.CLIENT_ID || cfg.clientId;
  const guildId = process.env.GUILD_ID || cfg.guildId;

  if (!token || token === 'YOUR_BOT_TOKEN_HERE') {
    console.error('\n❌ No bot token configured.');
    console.error('   Run "npm run setup" to fill in config.json.\n');
    process.exitCode = 1;
    return;
  }

  if (!clientId || !guildId || clientId === 'YOUR_APPLICATION_CLIENT_ID_HERE') {
    console.error('\n❌ Client ID or Guild ID is missing.');
    console.error('   Run "npm run setup" to fill in config.json.\n');
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
      console.error('     3. Run "npm run setup" and paste it in');
      console.error('     4. Run "npm run doctor" to verify\n');
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
