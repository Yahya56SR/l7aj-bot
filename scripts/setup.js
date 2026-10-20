#!/usr/bin/env node
'use strict';

/**
 * Interactive setup for the TALABA <3 bot.
 *
 * Usage:
 *   npm run setup                      # writes ./config.json
 *   npm run setup -- path/to/config    # writes a custom path
 *
 * Reads any existing config.json so previous values become defaults.
 * Works interactively (TTY) and with piped/redirected input (automation).
 */

const fs = require('fs');
const path = require('path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

const CONFIG_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.env.CONFIG_PATH
    ? path.resolve(process.env.CONFIG_PATH)
    : path.join(__dirname, '..', 'config.json');

const BORDER = '─'.repeat(62);

const DEFAULTS = {
  token: '',
  clientId: '',
  guildId: '',
  reactionRoles: { messageId: '', channelId: '', mappings: {} },
  roles: { panels: [] },
  levelRoles: {},
  xp: {
    perMessageMin: 15,
    perMessageMax: 25,
    cooldownSeconds: 60,
    perVoiceMinuteMin: 5,
    perVoiceMinuteMax: 8,
    noXpChannels: [],
    xpChannel: '',
  },
  channels: {
    levelUp: '',
    logs: '',
    levelUpMessage: '🎉 Congratulations {user}, you have reached **level {level}**!',
  },
  verification: {
    messageId: '',
    channelId: '',
    roleId: '',
    title: '✅ Verification',
    description: 'Click the button below to verify yourself and unlock the server.',
    showUnverify: true,
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadExisting() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      const legacyPerMessage = parsed.xp?.perMessage;
      const legacyPerVoice = parsed.xp?.perVoiceMinute;

      return {
        ...clone(DEFAULTS),
        ...parsed,
        reactionRoles: {
          ...clone(DEFAULTS.reactionRoles),
          ...(parsed.reactionRoles || {}),
        },
        roles: { panels: [...(parsed.roles?.panels || [])] },
        xp: {
          perMessageMin: parsed.xp?.perMessageMin ?? legacyPerMessage ?? DEFAULTS.xp.perMessageMin,
          perMessageMax: parsed.xp?.perMessageMax ?? legacyPerMessage ?? DEFAULTS.xp.perMessageMax,
          cooldownSeconds: parsed.xp?.cooldownSeconds ?? DEFAULTS.xp.cooldownSeconds,
          perVoiceMinuteMin:
            parsed.xp?.perVoiceMinuteMin ?? legacyPerVoice ?? DEFAULTS.xp.perVoiceMinuteMin,
          perVoiceMinuteMax:
            parsed.xp?.perVoiceMinuteMax ?? legacyPerVoice ?? DEFAULTS.xp.perVoiceMinuteMax,
          noXpChannels: [...(parsed.xp?.noXpChannels || [])],
          xpChannel: parsed.xp?.xpChannel || '',
        },
        channels: { ...clone(DEFAULTS.channels), ...(parsed.channels || {}) },
        verification: { ...clone(DEFAULTS.verification), ...(parsed.verification || {}) },
      };
    }
  } catch (err) {
    console.warn(`⚠️  Could not read existing config (${err.message}). Starting fresh.`);
  }
  return clone(DEFAULTS);
}

function isSnowflake(value) {
  return /^\d{5,25}$/.test(value);
}

function isToken(value) {
  return /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}$/.test(value);
}

function maskToken(token) {
  if (!token) return '(none)';
  if (token.length <= 12) return '(set)';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

/**
 * Ask Discord whether a token actually works.
 * Returns { ok, username, id, reason }.
 */
async function validateToken(token) {
  if (!token) return { ok: false, reason: 'missing' };
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.ok) {
      const body = await res.json();
      return { ok: true, username: body.username, id: body.id };
    }
    return { ok: false, reason: res.status === 401 ? 'unauthorized' : `http_${res.status}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Build an `ask(question, defaultValue, displayDefault)` function.
 * - TTY: real readline prompts with echo.
 * - Piped: reads stdin once, then serves lines from memory (deterministic).
 */
function createAsker() {
  let rl = null;
  let lines = null;
  let cursor = 0;

  if (stdin.isTTY) {
    rl = readline.createInterface({ input: stdin, output: stdout });
  } else {
    lines = fs.readFileSync(0, 'utf8').split(/\r?\n/);
  }

  const ask = async (question, defaultValue = '', displayDefault = defaultValue) => {
    const shown =
      displayDefault === null || displayDefault === undefined ? '' : String(displayDefault);
    const suffix = shown ? ` [${shown}]` : '';
    const prompt = `  ${question}${suffix}: `;

    if (rl) {
      const answer = (await rl.question(prompt)).trim();
      return answer || defaultValue;
    }

    // Non-TTY: prompt is printed, value is not echoed (keeps secrets out of logs)
    stdout.write(`${prompt}\n`);
    const raw = lines[cursor++] ?? '';
    return raw.trim() || defaultValue;
  };

  const close = () => {
    if (rl) rl.close();
  };

  return { ask, close };
}

async function main() {
  const { ask, close } = createAsker();

  const existing = loadExisting();
  const config = clone(existing);

  console.log(`\n${BORDER}`);
  console.log('  TALABA <3 bot — interactive setup');
  console.log(BORDER);
  console.log('  Press Enter to keep the value shown in [brackets].');
  console.log('  Leave optional fields blank to skip them.\n');

  /* ------------------------------------------------------------------ */
  /* Credentials                                                         */
  /* ------------------------------------------------------------------ */
  console.log('— Bot credentials —');

  // Check whether an existing token still works before offering to keep it.
  let existingTokenValid = false;
  if (existing.token) {
    const check = await validateToken(existing.token);
    existingTokenValid = check.ok;
    if (check.ok) {
      console.log(`  Existing token is valid — bot: ${check.username}`);
    } else {
      console.log('  ⚠️  The existing token is INVALID (401 Unauthorized).');
      console.log('      It was reset/revoked, or it is the client secret instead of the bot token.');
    }
  }

  const mustPaste = Boolean(existing.token) && !existingTokenValid;

  config.token = await ask(
    'Bot token   (Developer Portal → Bot → Reset Token)',
    mustPaste ? '' : existing.token,
    mustPaste ? 'REQUIRED - existing token is invalid' : existing.token ? 'set - Enter to keep' : '',
  );

  if (!config.token) {
    console.error('\n❌ A bot token is required. Aborting.');
    close();
    process.exitCode = 1;
    return;
  }

  if (!isToken(config.token)) {
    console.warn('  ⚠️  That does not look like a standard bot token.');
  }

  const tokenCheck = await validateToken(config.token);
  if (tokenCheck.ok) {
    console.log(`  ✅ Token valid — bot: ${tokenCheck.username} (${tokenCheck.id})`);
  } else {
    console.log('');
    console.log('  ❌ Discord rejected that token (401 Unauthorized).');
    console.log('');
    console.log('      Most likely causes:');
    console.log('        1. The token was reset and this is the old one.');
    console.log('        2. You copied the CLIENT SECRET instead of the BOT TOKEN.');
    console.log('           Both look like "xxx.yyy.zzz" — only Discord can tell them apart.');
    console.log('');
    console.log('      Get the right one: Developer Portal → your app → Bot →');
    console.log('      "Reset Token" → click Copy next to the BOT TOKEN.');
    console.log('');

    const force = await ask('Save this token anyway? (y/n)', 'n');
    if (force.toLowerCase() !== 'y') {
      console.log('\nAborted — nothing was written.\n');
      close();
      return;
    }
  }

  config.clientId = await ask('Application (Client) ID', existing.clientId);
  config.guildId = await ask('Server (Guild) ID', existing.guildId);

  /* ------------------------------------------------------------------ */
  /* Reaction roles                                                      */
  /* ------------------------------------------------------------------ */
  console.log('\n— Reaction roles —');
  console.log('  Right-click the message → Copy Message ID. Leave blank to disable.');
  config.reactionRoles.messageId = await ask(
    'Role message ID',
    existing.reactionRoles.messageId,
  );
  config.reactionRoles.channelId = await ask(
    'Role message channel ID',
    existing.reactionRoles.channelId,
  );

  if (config.reactionRoles.messageId) {
    const hasExisting = Object.keys(existing.reactionRoles.mappings || {}).length > 0;
    const keepAnswer = hasExisting
      ? await ask('Keep existing emoji → role mappings? (y/n)', 'y')
      : 'n';

    if (keepAnswer.toLowerCase() === 'y') {
      config.reactionRoles.mappings = { ...existing.reactionRoles.mappings };
      console.log('  Kept existing mappings.');
    } else {
      config.reactionRoles.mappings = {};
      console.log('  Enter emoji → role mappings. Leave the emoji blank when done.');
      while (true) {
        const emoji = await ask('Emoji (blank to finish)');
        if (!emoji) break;
        const roleId = await ask(`Role ID for ${emoji}`);
        if (!roleId) {
          console.log('  Skipped (no role ID).');
          continue;
        }
        if (!isSnowflake(roleId)) {
          console.warn('  ⚠️  That does not look like a role ID, saving anyway.');
        }
        config.reactionRoles.mappings[emoji] = roleId;
      }
    }

    if (Object.keys(config.reactionRoles.mappings).length === 0) {
      console.log('  ⚠️  No emoji mappings — reaction roles will be inactive.');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Level roles                                                         */
  /* ------------------------------------------------------------------ */
  console.log('\n— Level reward roles —');
  console.log('  Enter level milestones and the role IDs to grant. Blank level when done.');

  const hasLevels = Object.keys(existing.levelRoles || {}).length > 0;
  const keepLevels = hasLevels
    ? await ask('Keep existing level → role mappings? (y/n)', 'y')
    : 'n';

  if (keepLevels.toLowerCase() === 'y') {
    config.levelRoles = { ...existing.levelRoles };
    console.log('  Kept existing level roles.');
  } else {
    config.levelRoles = {};
    while (true) {
      const level = await ask('Level (blank to finish)');
      if (!level) break;
      if (!/^\d+$/.test(level)) {
        console.log('  ⚠️  Level must be a whole number.');
        continue;
      }
      const roleId = await ask(`Role ID for level ${level}`);
      if (!roleId) {
        console.log('  Skipped (no role ID).');
        continue;
      }
      config.levelRoles[level] = roleId;
    }
  }

  /* ------------------------------------------------------------------ */
  /* XP settings                                                         */
  /* ------------------------------------------------------------------ */
  console.log('\n— XP settings —');
  console.log('  MEE6 defaults: 15-25 XP per message, once per minute, 5-8 XP per voice minute.');
  config.xp.perMessageMin = toNumber(
    await ask('XP per message (min)', String(existing.xp.perMessageMin ?? 15)),
    15,
  );
  config.xp.perMessageMax = toNumber(
    await ask('XP per message (max)', String(existing.xp.perMessageMax ?? 25)),
    25,
  );
  config.xp.cooldownSeconds = toNumber(
    await ask('Message cooldown (seconds)', String(existing.xp.cooldownSeconds ?? 60)),
    60,
  );
  config.xp.perVoiceMinuteMin = toNumber(
    await ask('XP per voice minute (min)', String(existing.xp.perVoiceMinuteMin ?? 5)),
    5,
  );
  config.xp.perVoiceMinuteMax = toNumber(
    await ask('XP per voice minute (max)', String(existing.xp.perVoiceMinuteMax ?? 8)),
    8,
  );

  /* ------------------------------------------------------------------ */
  /* Channels                                                            */
  /* ------------------------------------------------------------------ */
  console.log('\n— Announcement channels —');
  config.channels.levelUp = await ask(
    'Level-up channel ID (blank = announce in the current channel)',
    existing.channels.levelUp,
  );
  config.channels.logs = await ask('Bot log channel ID (optional)', existing.channels.logs);
  config.channels.levelUpMessage = await ask(
    'Level-up message ({user} {level} {role} {server})',
    existing.channels.levelUpMessage ||
      '🎉 Congratulations {user}, you have reached **level {level}**!',
  );

  /* ------------------------------------------------------------------ */
  /* Summary                                                             */
  /* ------------------------------------------------------------------ */
  console.log(`\n${BORDER}`);
  console.log('  Configuration summary');
  console.log(BORDER);
  console.log(`  Token:            ${maskToken(config.token)}`);
  console.log(`  Client ID:        ${config.clientId || '(missing)'}`);
  console.log(`  Guild ID:         ${config.guildId || '(missing)'}`);
  console.log(`  Reaction message: ${config.reactionRoles.messageId || '(disabled)'}`);
  console.log(`  Emoji mappings:   ${Object.keys(config.reactionRoles.mappings).length}`);
  console.log(`  Level roles:      ${Object.keys(config.levelRoles).length}`);
  console.log(
    `  XP:               ${config.xp.perMessageMin}-${config.xp.perMessageMax}/msg · ${config.xp.perVoiceMinuteMin}-${config.xp.perVoiceMinuteMax}/vc-min · ${config.xp.cooldownSeconds}s cooldown`,
  );
  console.log(`  Level-up channel: ${config.channels.levelUp || '(current channel)'}`);
  console.log(`  Log channel:      ${config.channels.logs || '(none)'}`);
  console.log(BORDER);

  const confirm = await ask('Write config.json? (y/n)', 'y');
  if (confirm.toLowerCase() !== 'y') {
    console.log('\nAborted — nothing was written.');
    close();
    return;
  }

  if (!config.clientId || !config.guildId) {
    console.log('\n⚠️  Missing Client ID or Guild ID — slash commands will not register.');
    console.log('   Re-run "npm run setup" once you have them.');
  }

  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`\n✅ Saved to ${CONFIG_PATH}`);
  console.log('   Next steps:');
  console.log('     1. npm run dev      (starts the bot, no build needed)');
  console.log('     2. npm run doctor   (verifies everything)');
  console.log('');
  console.log('   Then configure the rest from Discord:');
  console.log('     /roles setup name:Games channel:#roles     - button role panels');
  console.log('     /roles panel add panel:Games role:@Gamer  - add a button');
  console.log('     /reactionroles setup channel:#roles        - reaction role panel');
  console.log('     /verify setup role:@Verified channel:#verify');
  console.log('     /levels role add level:5 role:@Level 5    - level rewards');
  console.log('');
  console.log('   On bot-hosting.net, set BOT_TOKEN / CLIENT_ID / GUILD_ID in the');
  console.log('   environment dashboard — those override config.json.\n');

  close();
}

main().catch((err) => {
  console.error('\nSetup failed:', err);
  process.exit(1);
});
