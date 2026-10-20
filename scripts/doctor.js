#!/usr/bin/env node
'use strict';

/**
 * Diagnostic tool for the TALABA <3 bot.
 * Usage: npm run doctor
 *
 * Never prints the bot token — only metadata about it.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const configPath = path.join(root, 'config.json');
const API = 'https://discord.com/api/v10';

let failures = 0;
let warnings = 0;

function ok(msg) {
  console.log(`  ✅ ${msg}`);
}
function warn(msg) {
  warnings++;
  console.log(`  ⚠️  ${msg}`);
}
function fail(msg) {
  failures++;
  console.log(`  ❌ ${msg}`);
}
function head(msg) {
  console.log(`\n${msg}`);
  console.log('─'.repeat(62));
}

async function api(pathname, options = {}) {
  const token = process.env.BOT_TOKEN || loadConfig().token;
  const res = await fetch(`${API}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body };
}

let cachedConfig = null;
function loadConfig() {
  if (cachedConfig) return cachedConfig;
  if (!fs.existsSync(configPath)) {
    console.error('❌ config.json not found. Run "npm run setup" first.');
    process.exit(1);
  }
  cachedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return cachedConfig;
}

async function main() {
  const cfg = loadConfig();
  const token = process.env.BOT_TOKEN || cfg.token;
  const tokenSource = process.env.BOT_TOKEN ? 'environment variable' : 'config.json';

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  TALABA <3 bot — doctor');
  console.log('══════════════════════════════════════════════════════════════');

  /* ---------------------------------------------------------------- */
  head('1. Configuration');
  if (!token) {
    fail('No bot token found. Run "npm run setup".');
  } else {
    ok(`Bot token present (source: ${tokenSource}, length ${token.length})`);
    if (/\s/.test(token)) fail('Token contains whitespace — it was likely copied with a newline.');
    if (/^["']|["']$/.test(token)) fail('Token is wrapped in quotes — remove the quotes.');

    try {
      const appId = Buffer.from(token.split('.')[0], 'base64').toString();
      if (cfg.clientId && appId !== cfg.clientId) {
        fail(`Token belongs to application ${appId} but config.clientId is ${cfg.clientId}.`);
      } else {
        ok(`Token belongs to application ${appId}`);
      }
    } catch {
      warn('Could not decode the token — it may be malformed.');
    }
  }

  if (!cfg.clientId) fail('clientId is missing.');
  else ok(`clientId: ${cfg.clientId}`);

  if (!cfg.guildId) fail('guildId is missing.');
  else ok(`guildId: ${cfg.guildId}`);

  /* ---------------------------------------------------------------- */
  head('2. Authentication');
  let me = null;
  const auth = await api('/users/@me');
  if (auth.status === 200) {
    me = auth.body;
    ok(`Token is valid — authenticated as ${me.username}#${me.discriminator} (${me.id})`);
  } else if (auth.status === 401) {
    fail('401 Unauthorized — the token is not valid.');
    console.log('');
    console.log('      Most likely causes:');
    console.log('      1. The token was reset ("Reset Token") and config.json still has the old one.');
    console.log('      2. You copied the CLIENT SECRET instead of the BOT TOKEN.');
    console.log('         Both look like "xxxx.yyy.zzz" and only Discord can tell them apart.');
    console.log('');
    console.log('      Fix:');
    console.log('        a. Developer Portal → your app → Bot → "Reset Token"');
    console.log('        b. Click "Copy" next to the BOT TOKEN (not the client secret)');
    console.log('        c. Run "npm run setup" and PASTE the new token');
    console.log('           (pressing Enter keeps the old, broken token)');
  } else {
    fail(`Unexpected response ${auth.status}: ${auth.body?.message ?? 'unknown'}`);
  }

  /* ---------------------------------------------------------------- */
  head('3. Application');
  const app = await api('/applications/@me');
  if (app.status === 200) {
    ok(`Application found: ${app.body.name} (${app.body.id})`);
    if (cfg.clientId && app.body.id !== cfg.clientId) {
      fail(`config.clientId (${cfg.clientId}) does not match the token's app (${app.body.id}).`);
    }
  } else if (app.status === 401) {
    fail('Could not read the application (token invalid).');
  } else {
    warn(`Could not read the application: ${app.body?.message ?? app.status}`);
  }

  /* ---------------------------------------------------------------- */
  head('4. Server');
  if (cfg.guildId) {
    const guild = await api(`/guilds/${cfg.guildId}`);
    if (guild.status === 200) {
      ok(`Bot is in server: ${guild.body.name}`);
    } else if (guild.status === 404) {
      fail('Bot is NOT in that server. Invite it with the invite link from the Developer Portal → Bot page.');
    } else {
      fail(`Could not access the server: ${guild.body?.message ?? guild.status}`);
    }

    const member = await api(`/guilds/${cfg.guildId}/members/@me`);
    if (member.status === 200) {
      const perms = BigInt(member.body.permissions ?? 0);
      const MANAGE_ROLES = 1n << 28n;
      const MANAGE_GUILD = 1n << 5n;
      const VIEW_CHANNEL = 1n << 10n;
      const SEND_MESSAGES = 1n << 11n;
      const READ_HISTORY = 1n << 16n;

      if (perms & MANAGE_ROLES) ok('Bot has Manage Roles');
      else fail('Bot is missing the Manage Roles permission.');

      if (perms & VIEW_CHANNEL && perms & SEND_MESSAGES) ok('Bot can view channels and send messages');
      else warn('Bot may be missing View Channel / Send Messages.');

      if (perms & MANAGE_GUILD) ok('Bot has Manage Server (can run setup commands)');
      else warn('Bot lacks Manage Server — setup commands will be hidden from you.');

      if (perms & READ_HISTORY) ok('Bot can read message history');
      else warn('Bot may be missing Read Message History.');
    }
  }

  /* ---------------------------------------------------------------- */
  head('5. Reaction roles');
  const rr = cfg.reactionRoles ?? {};
  if (!rr.messageId) {
    warn('No reaction-role message configured. Run "/reactionroles setup" in Discord.');
  } else {
    const msg = await api(`/channels/${rr.channelId}/messages/${rr.messageId}`);
    if (msg.status === 200) {
      ok(`Reaction-role message is reachable (${rr.channelId}/${rr.messageId})`);
    } else if (msg.status === 404) {
      fail('The configured reaction-role message no longer exists. Run "/reactionroles setup" again.');
    } else {
      warn(`Could not fetch the reaction-role message: ${msg.body?.message ?? msg.status}`);
    }

    const count = Object.keys(rr.mappings ?? {}).length;
    if (count === 0) warn('No emoji → role mappings. Use "/reactionroles add".');
    else ok(`${count} emoji → role mapping(s) configured`);
  }

  /* ---------------------------------------------------------------- */
  head('6. Level roles');
  const levels = Object.entries(cfg.levelRoles ?? {});
  if (levels.length === 0) {
    warn('No level reward roles. Use "/levels role add".');
  } else {
    ok(`${levels.length} level reward(s) configured`);
    if (cfg.guildId) {
      const roles = await api(`/guilds/${cfg.guildId}/roles`);
      if (roles.status === 200) {
        const botMember = await api(`/guilds/${cfg.guildId}/members/@me`);
        const botRoleId = botMember.body?.roles?.at(-1);
        const botRole = roles.body.find((r) => r.id === botRoleId);
        const botPos = botRole ? botRole.position : 0;

        for (const [level, roleId] of levels) {
          const role = roles.body.find((r) => r.id === roleId);
          if (!role) {
            fail(`Level ${level} role no longer exists in the server.`);
          } else if (role.position >= botPos) {
            fail(`Level ${level} role (${role.name}) is above the bot's role — move the bot up.`);
          } else {
            ok(`Level ${level} → ${role.name}`);
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  head('7. Role panels (buttons)');
  const panels = cfg.roles?.panels ?? [];
  if (panels.length === 0) {
    warn('No role panels configured. Create one with "/roles setup".');
  } else {
    ok(`${panels.length} role panel(s) configured`);
    for (const panel of panels) {
      const msg = await api(`/channels/${panel.channelId}/messages/${panel.messageId}`);
      if (msg.status === 200) {
        ok(`Panel "${panel.name}" → ${panel.buttons.length} button(s) in <#${panel.channelId}>`);
      } else if (msg.status === 404) {
        fail(`Panel "${panel.name}" message no longer exists. Recreate it with "/roles setup".`);
      } else {
        fail(`Panel "${panel.name}" unreadable: ${msg.body?.message ?? msg.status}`);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  head('8. Verification');
  const ver = cfg.verification ?? {};
  if (!ver.roleId) {
    warn('Verification is not set up. Run "/verify setup".');
  } else {
    ok(`Verification role configured: ${ver.roleId}`);
    const msg = await api(`/channels/${ver.channelId}/messages/${ver.messageId}`);
    if (msg.status === 200) {
      ok(`Verification message is live in <#${ver.channelId}>`);
    } else if (msg.status === 404) {
      fail('The verification message no longer exists. Run "/verify setup" again.');
    } else {
      fail(`Verification message unreadable: ${msg.body?.message ?? msg.status}`);
    }
  }

  /* ---------------------------------------------------------------- */
  head('9. Reminders');
  console.log('  • Developer Portal → Bot → Privileged Gateway Intents:');
  console.log('      enable Server Members, Message Content and Presence.');
  console.log('  • Slash commands are registered on every start — run "npm start"');
  console.log('    after adding new commands.');
  console.log('  • On bot-hosting.net, set BOT_TOKEN / CLIENT_ID / GUILD_ID in the');
  console.log('    environment panel; those override config.json.');

  /* ---------------------------------------------------------------- */
  console.log('\n══════════════════════════════════════════════════════════════');
  if (failures === 0 && warnings === 0) {
    console.log('  ✅ All checks passed.');
  } else {
    console.log(`  ${failures} failure(s), ${warnings} warning(s).`);
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  process.exitCode = failures > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('\nDoctor failed:', err);
  process.exitCode = 1;
});
