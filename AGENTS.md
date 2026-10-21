# TALABA <3 Discord Bot — Agent Instructions

## Quick Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | Run with `tsx watch` — restarts on file changes (preferred for dev) |
| `npm start` | Run via `tsx` — no build step |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run serve` | Run compiled `dist/index.js` |
| `npm run setup` | Interactive config wizard → writes `config.json` (validates token live) |
| `npm run doctor` | Diagnose token, permissions, channels, roles, panel messages |

## Configuration
- **`config.json`** — runtime config (created by `npm run setup`). Never commit real tokens.
- **Environment overrides** (bot-hosting.net, etc.): `BOT_TOKEN`, `CLIENT_ID`, `GUILD_ID` — these take precedence over `config.json`.
- **Database**: `data/talaba.json` (auto-created, persists XP/levels/voice minutes).

## Architecture
- **Entry**: `src/index.ts` — registers slash commands to the guild on every start, then logs in.
- **Commands** (`src/commands/`): `rank`, `leaderboard`, `reactionroles`, `roles` (button panels), `levels`, `xp`, `verify`, `config`.
- **Events** (`src/events/`): `messageCreate` (XP), `voiceStateUpdate` + 1-min tick (voice XP), `messageReactionAdd/Remove` (reaction roles).
- **Handlers** (`src/handlers/`): `registerCommands` (guild-scoped), `buttons` (role panels + verification), `levelUp` (role rewards + announcement).
- **Utils**: `level.ts` (MEE6 math), `rankcard.ts` + `rankEmbeds.ts` (PNG/image fallback), `automod.ts`, `discord.ts`.

## Key Behaviors
- **XP system**: MEE6 parity — 15–25 XP/message (random), 60s cooldown, 5–8 XP/voice minute. Formula: `5*L² + 50*L + 100` per level.
- **Rank cards / leaderboard**: Rendered as PNG via `@napi-rs/canvas` (prebuilt binaries, no compiler needed). Fonts in `assets/fonts/` cover Latin, Cyrillic, Greek, Vietnamese, Arabic, Hebrew, Thai, Devanagari, Bengali, Tamil. Falls back to text embed on canvas failure.
- **Level rewards**: Roles granted at milestones; lower-tier reward roles removed automatically.
- **Button role panels**: Unlimited panels, one button per role, toggle on click. Panel message auto-updates on add/remove.
- **Verification**: Single button message granting a role; optional unverify button.

## Discord Requirements
- **Privileged Gateway Intents** (Developer Portal → Bot): Server Members, Message Content, Presence.
- **Bot permissions**: Manage Roles (must be above any role the bot assigns), Send Messages, Read Message History, View Channels.
- `npm run doctor` catches role-hierarchy issues and missing intents.

## Development Notes
- **No test suite / linter / formatter configured** — plain TypeScript with `tsc --strict`.
- **Commands re-register on every start** — run `npm start` after adding new command files.
- **Config is read at runtime** — changing settings from Discord (slash commands) does **not** restart the bot; `npm run dev` watch only restarts on code changes.
- **Token validation**: `npm run setup` and `npm run doctor` both hit Discord API to verify the token is a valid **bot token** (not client secret).

## File Layout
```
src/
  index.ts           # bootstrap, event wiring, command registration
  config.ts          # config load/save/migrate, types
  db.ts              # JSON file DB (talaba.json) — XP, levels, voice minutes
  commands/          # slash command implementations
  events/            # Discord event handlers
  handlers/          # shared logic (command reg, buttons, level-up)
  utils/             # level math, rank card rendering, automod, discord helpers
assets/fonts/        # Noto fonts (SIL OFL) for rank cards
scripts/
  setup.js           # interactive config wizard (validates token with Discord)
  doctor.js          # diagnostics
config.json          # runtime config (gitignored)
data/talaba.json     # XP database (gitignored)
```

## Common Gotchas
- **Token vs Client Secret**: Both look like `xxx.yyy.zzz`. Only the **Bot Token** (Developer Portal → Bot → Reset Token → Copy) works. `npm run setup` / `doctor` detect 401 and explain this.
- **Role hierarchy**: If the bot's highest role is below a level-reward or panel role, assignment silently fails. `doctor` flags this.
- **Guild-scoped commands**: Registered to `guildId` in config. Changing `guildId` requires re-register (restart).
- **No hot-reload for config**: Slash commands (`/levels setup`, `/roles panel add`, etc.) write to `config.json` but the bot keeps running — no restart needed.