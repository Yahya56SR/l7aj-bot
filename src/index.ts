import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { REST } from '@discordjs/rest';
import dotenv from 'dotenv';
import { getConfig, loadConfig } from './config';
import { initDb, initializeTotalMembers, getDueReminders, markReminderSent, addBalance } from './db';
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
import * as clearCmd from './commands/clear';
import * as moderationCmd from './commands/moderation';
import * as utilityCmd from './commands/utility';
import * as economyCmd from './commands/economy';
import * as giveawayCmd from './commands/giveaway';
import * as remindCmd from './commands/remind';
import * as suggestCmd from './commands/suggest';
import * as afkCmd from './commands/afk';
import * as starboardCmd from './commands/starboard';
import * as invitesCmd from './commands/invites';
import * as tempvcCmd from './commands/tempvc';
import * as antinukeCmd from './commands/antinuke';
import { handleMessageCreate } from './events/messageCreate';
import { handleVoiceStateUpdate, handleVoiceTick, seedVoiceSessions } from './events/voiceStateUpdate';
import { handleReactionAdd, handleReactionRemove } from './events/messageReaction';
import { handleGuildMemberAdd, handleGuildMemberRemove } from './events/guildMember';
import { registerLoggingEvents } from './events/logging';
import { logCommandUsage } from './utils/logger';
import { startDashboard } from './dashboard/server';
import { startLiveLeaderboard, stopLiveLeaderboard } from './utils/liveLeaderboard';
import { closeL7aj, primeL7ajHistory } from './utils/l7aj';
import { startScheduledMessageScheduler, stopScheduledMessageScheduler } from './utils/l7aj-tools';

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
client.commands.set(clearCmd.data.name, clearCmd);
client.commands.set(moderationCmd.data.name, moderationCmd);
client.commands.set(utilityCmd.data.name, utilityCmd);
client.commands.set(economyCmd.data.name, economyCmd);
client.commands.set(giveawayCmd.data.name, giveawayCmd);
client.commands.set(remindCmd.data.name, remindCmd);
client.commands.set(suggestCmd.data.name, suggestCmd);
client.commands.set(afkCmd.data.name, afkCmd);
client.commands.set(starboardCmd.data.name, starboardCmd);
client.commands.set(invitesCmd.data.name, invitesCmd);
client.commands.set(tempvcCmd.data.name, tempvcCmd);
client.commands.set(antinukeCmd.slashData.name, antinukeCmd);

// Register server logging event listeners (roles, members, channels, messages)
registerLoggingEvents(client);
// Printed at boot so a deploy can be verified from the host console.
console.log(
  '[Logging] Log embeds name the acting member (audit log attribution enabled)',
);

let voiceTickInterval: ReturnType<typeof setInterval> | null = null;
let ticketSweepInterval: ReturnType<typeof setInterval> | null = null;
let scheduledSchedulerInterval: ReturnType<typeof setInterval> | null = null;
let reminderSchedulerInterval: ReturnType<typeof setInterval> | null = null;

client.on('clientReady', () => {
  console.log(`Logged in as ${client.user?.tag} (${client.user?.id})`);
  // Initialize total member count from current guild member count
  const cfg = getConfig();
  const guild = client.guilds.cache.get(cfg.guildId);
  if (guild) {
    initializeTotalMembers(guild.memberCount);
  }
  // Award voice XP every minute to users still in VC.
  // Track anyone already connected before this login so a restart doesn't
  // silently skip their voice minutes.
  seedVoiceSessions(client);
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

  // One persistent leaderboard message, re-rendered on the configured
  // interval. Reading the interval on every tick means dashboard edits apply
  // without a restart.
  startLiveLeaderboard(client);

  // Send due scheduled messages every 30 seconds.
  scheduledSchedulerInterval = startScheduledMessageScheduler(client);

  // Give the L7aj persona conversation context immediately after a restart.
  void primeL7ajHistory(client).catch((err) => console.error('[L7aj] History priming failed:', err));

  // Due reminders scheduler: DM users when their reminder is due, every 30s.
  if (reminderSchedulerInterval) clearInterval(reminderSchedulerInterval);
  reminderSchedulerInterval = setInterval(async () => {
    try {
      const due = getDueReminders();
      for (const reminder of due) {
        try {
          const user = await client.users.fetch(reminder.userId).catch(() => null);
          if (user) {
            await user.send(`🔔 Reminder: ${reminder.message}`).catch(() => undefined);
          }
        } catch {
          /* ignore DM failures */
        }
        markReminderSent(reminder.id);
      }
    } catch (err) {
      console.error('Reminder scheduler error:', err);
    }
  }, 30 * 1000);

  // Cache invites for the configured guild so we can track who invited whom.
  const inviteGuild = client.guilds.cache.get(cfg.guildId);
  if (inviteGuild) {
    void invitesCmd.cacheGuildInvites(client, inviteGuild.id);
  }

  // Register anti-nuke event listeners.
  client.on('roleCreate', (role) => {
    void antinukeCmd.handleRoleCreate(role, {
      client,
      guild: role.guild,
      actor: null,
      reason: null,
    });
  });
  client.on('roleDelete', (role) => {
    void antinukeCmd.handleRoleDelete(role, {
      client,
      guild: role.guild,
      actor: null,
      reason: null,
    });
  });
  client.on('channelCreate', (channel) => {
    if (channel.isDMBased()) return;
    void antinukeCmd.handleChannelCreate(channel, {
      client,
      guild: channel.guild,
      actor: null,
      reason: null,
    });
  });
  client.on('channelDelete', (channel) => {
    if (channel.isDMBased()) return;
    void antinukeCmd.handleChannelDelete(channel, {
      client,
      guild: channel.guild,
      actor: null,
      reason: null,
    });
  });
  client.on('guildBanAdd', (ban) => {
    const { guild, user } = ban;
    void antinukeCmd.handleMemberBan(guild, user, {
      client,
      guild,
      actor: null,
      reason: null,
    });
  });
  client.on('guildMemberRemove', (member) => {
    // Kicks fire guildMemberRemove too; anti-nuke kick attribution is handled
    // via audit log inside handleMemberKick when a ban is not involved. We only
    // treat bans here (guildBanAdd) to avoid double-punishing.
  });
});

client.on('messageCreate', async (message) => {
  try {
    await handleMessageCreate(message);
  } catch (err) {
    console.error('Message create handler error:', err);
  }

  // AFK handling: clear AFK when the user speaks; notify on mentions of AFK users.
  try {
    if (!message.author.bot && message.guild) {
      const afk = afkCmd.getAfkStatus(message.author.id);
      if (afk) {
        afkCmd.clearAfkStatus(message.author.id);
        await message.channel.send(
          `👋 Welcome back, ${message.author}! You are no longer AFK.`,
        ).catch(() => undefined);
      }

      const mentionedAfk: string[] = [];
      for (const user of message.mentions.users.values()) {
        if (user.id === message.author.id || user.bot) continue;
        const status = afkCmd.getAfkStatus(user.id);
        if (status) mentionedAfk.push(`<@${user.id}> is AFK: ${status.message}`);
      }
      if (mentionedAfk.length > 0) {
        await message.reply(mentionedAfk.join('\n')).catch(() => undefined);
      }
    }
  } catch (err) {
    console.error('AFK handler error:', err);
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    handleVoiceStateUpdate(oldState, newState);
  } catch (err) {
    console.error('Voice state update handler error:', err);
  }

  // Temporary voice channels (join-to-create).
  try {
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;
    await tempvcCmd.handleTempVC(
      oldState.channelId ?? null,
      newState.channelId ?? null,
      member,
    );
  } catch (err) {
    console.error('Temp VC handler error:', err);
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    await handleReactionAdd(reaction, user);
  } catch (err) {
    console.error('Message reaction add handler error:', err);
  }

  // Giveaway entry (🎉), suggestion voting (👍/👎), starboard (star emoji).
  try {
    if (user.bot) return;

    // Resolve partials so we have a real message to inspect.
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    const message = reaction.message;
    if (message.partial) {
      try {
        await message.fetch();
      } catch {
        return;
      }
    }

    const reactionShape = {
      emoji: reaction.emoji,
      count: reaction.count ?? 0,
      message: {
        id: message.id,
        channel: { id: message.channel.id },
        content: message.content ?? '',
        author: { id: message.author!.id, username: message.author!.username },
        url: message.url,
      },
    };

    const handledGiveaway = await giveawayCmd.handleGiveawayReaction(reactionShape, user);
    if (handledGiveaway) return;
    await suggestCmd.handleSuggestionReaction(reactionShape, user, true);
    await starboardCmd.handleStarboardReaction(reactionShape, {
      channels: client.channels,
      guilds: client.guilds,
    });
  } catch (err) {
    console.error('Reaction feature handler error:', err);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    await handleReactionRemove(reaction, user);
  } catch (err) {
    console.error('Message reaction remove handler error:', err);
  }

  // Remove suggestion votes when a reaction is removed.
  try {
    if (user.bot) return;

    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    const message = reaction.message;
    if (message.partial) {
      try {
        await message.fetch();
      } catch {
        return;
      }
    }

    const reactionShape = {
      emoji: reaction.emoji,
      count: reaction.count ?? 0,
      message: {
        id: message.id,
        channel: { id: message.channel.id },
        content: message.content ?? '',
        author: { id: message.author!.id, username: message.author!.username },
        url: message.url,
      },
    };

    await suggestCmd.handleSuggestionReaction(reactionShape, user, false);
  } catch (err) {
    console.error('Reaction remove feature handler error:', err);
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

    // Invite tracking: diff current invites vs cache to find who invited this member.
    try {
      const guild = member.guild;
      const currentInvites = await guild.invites.fetch().catch(() => null);
      if (currentInvites) {
        const currentMap = new Map<string, { inviterId: string; uses: number }>();
        for (const [code, invite] of currentInvites) {
          currentMap.set(code, { inviterId: invite.inviterId ?? '', uses: invite.uses ?? 0 });
        }
        const inviterId = invitesCmd.diffInvite(guild.id, currentMap);
        if (inviterId) {
          addBalance(inviterId, 50);
        }
      }
    } catch (err) {
      console.error('Invite tracking error:', err);
    }
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
  stopScheduledMessageScheduler(scheduledSchedulerInterval);
  stopLiveLeaderboard();
  closeL7aj();
  dashboardServer?.close();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  if (voiceTickInterval) clearInterval(voiceTickInterval);
  if (ticketSweepInterval) clearInterval(ticketSweepInterval);
  stopScheduledMessageScheduler(scheduledSchedulerInterval);
  stopLiveLeaderboard();
  closeL7aj();
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
  clearCmd.data,
  moderationCmd.data,
  utilityCmd.data,
  economyCmd.data,
  giveawayCmd.data,
  remindCmd.data,
  suggestCmd.data,
  afkCmd.data,
  starboardCmd.data,
  invitesCmd.data,
  tempvcCmd.data,
  antinukeCmd.slashData,
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
