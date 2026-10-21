# TALABA <3 Discord Bot — Agent Instructions

## Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | `tsx watch src/index.ts` — restarts on code changes (dev) |
| `npm start` | `tsx src/index.ts` — no build step |
| `npm run build` | `tsc` → `dist/` |
| `npm run serve` | `node dist/index.js` |
| `npm run setup` | Interactive config wizard → writes `config.json` (validates token live) |
| `npm run doctor` | Diagnose token, permissions, channels, roles, panel messages |

## Configuration
- `config.json` — runtime config (created by `npm run setup`). **Gitignored — never commit real tokens.**
- `.env` — optional `BOT_TOKEN`, `CLIENT_ID`, `GUILD_ID` overrides (dotenv; `config.json` is the fallback). See `.env.example`.
- `data/talaba.json` — JSON DB (XP, levels, voice minutes, tickets). Auto-created. **Gitignored.**
- `dist/` — build output. **Gitignored.**

## Architecture
- Entry: `src/index.ts` — loads config, inits DB, registers slash commands to the guild, logs in.
- Commands (`src/commands/`): `rank`, `leaderboard`, `reactionroles`, `roles` (button panels), `levels`, `xp`, `verify`, `config`, `tickets`.
- Events (`src/events/`): `messageCreate` (XP), `voiceStateUpdate` + 1-min tick (voice XP), `messageReactionAdd/Remove` (reaction roles), `guildMemberAdd/Remove`.
- Handlers (`src/handlers/`): `registerCommands` (guild-scoped), `buttons` (role panels + verification), `tickets` (panel/modal/transcript), `levelUp` (role rewards + announcement).
- Utils (`src/utils/`): `level.ts` (MEE6 math), `rankcard.ts` + `rankEmbeds.ts` (PNG/embed fallback), `welcomecard.ts`, `automod.ts`, `discord.ts`, `fonts.ts`.

## Key behaviors
- XP: MEE6 parity — random 15–25 XP/message, 60s cooldown, 5–8 XP/voice minute. Curve: `5*L² + 50*L + 100` per level. Bots ignored by default.
- Rank cards / leaderboard: PNG via `@napi-rs/canvas` (prebuilt binaries). Fonts in `assets/fonts/`. Falls back to text embed on canvas failure.
- Level rewards: roles at milestones; lower tiers removed automatically.
- Button role panels: unlimited panels, one button per role, toggle on click; panel message auto-updates.
- Verification: single button granting a role; optional unverify button.
- Tickets: panel + modal form fields, staff/ping roles, transcripts, auto-close.
- Automod: URL/GIF/caps blocking with whitelists and ignored channels.
- Welcome/goodbye: optional card image (PNG) or plain text.

## Discord requirements
- Privileged intents (Developer Portal → Bot): **Server Members**, **Message Content**. (Presence is not used.)
- Bot permissions: Manage Roles (must sit above any role it assigns), Send Messages, Read Message History, View Channels.
- `npm run doctor` catches role-hierarchy issues, missing intents, and 401 tokens.

## Development notes
- No test suite / linter / formatter — plain TypeScript, `tsc --strict`. Typecheck: `npx tsc --noEmit`.
- Slash commands re-register to `guildId` on every start — run `npm start` after adding commands.
- `config.json` is read once at startup; in-Discord slash-command changes write to disk but do **not** restart the bot. `npm run dev` only restarts on code changes.
- Token vs client secret: both look like `xxx.yyy.zzz`. Only the Bot Token works. `setup`/`doctor` detect 401.
- Line endings: `.gitattributes` forces LF (`eol=lf`) even on Windows — match existing files when editing.
