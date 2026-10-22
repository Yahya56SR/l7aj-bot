# TALABA <3 Discord Bot — Agent Instructions

## Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | `tsx watch src/index.ts` — restarts on code changes (dev) |
| `npm start` | `tsx src/index.ts` — no build step |
| `npm run build` | `tsc` → `dist/` |
| `npm run serve` | `node dist/index.js` |

## Configuration
- `config.json` — runtime config (edit by hand, via the in-Discord `/config` commands, or the web dashboard). **Gitignored — never commit real tokens.**
- `.env` — optional `BOT_TOKEN`, `CLIENT_ID`, `GUILD_ID` overrides (dotenv; `config.json` is the fallback). See `.env.example`.
- Dashboard env vars: `DASHBOARD_ENABLED` (default `true`), `DASHBOARD_HOST` (default `127.0.0.1`), `DASHBOARD_PORT` (default `3000`), `DASHBOARD_PASSWORD` (optional; required for non-loopback hosts).
- `data/talaba.json` — JSON DB (XP, levels, voice minutes, tickets). Auto-created. **Gitignored.**
- `dist/` — build output. **Gitignored.**

## Architecture
- Entry: `src/index.ts` — loads config, inits DB, registers slash commands to the guild, logs in.
- Commands (`src/commands/`): `rank`, `leaderboard`, `reactionroles`, `roles` (button panels), `levels`, `xp`, `verify`, `config`, `tickets`.
- Events (`src/events/`): `messageCreate` (XP), `voiceStateUpdate` + 1-min tick (voice XP), `messageReactionAdd/Remove` (reaction roles), `guildMemberAdd/Remove`.
- Handlers (`src/handlers/`): `registerCommands` (guild-scoped), `buttons` (role panels + verification), `tickets` (panel/modal/transcript), `levelUp` (role rewards + announcement).
- Utils (`src/utils/`): `level.ts` (MEE6 math), `rankcard.ts` + `rankEmbeds.ts` (PNG/embed fallback), `welcomecard.ts`, `automod.ts`, `discord.ts`, `fonts.ts`.
- Dashboard (`src/dashboard/server.ts` + `dashboard/`): in-process HTTP server started before Discord login. `dashboard/` holds the vanilla HTML/CSS/JS UI (no build step, no framework); the server exposes a JSON API, serves those assets, and writes config through `replaceConfig()` in `src/config.ts`.

## Dashboard
- Start the bot and open `http://127.0.0.1:3000`. It starts even when the token/login fails, so it can be used to fix a broken config.
- `GET/PUT /api/config` — config with `token` and `automod.aiModeration.apiKey` redacted; `PUT` requires the revision hash and returns `409` if a slash command changed the file meanwhile.
- `POST /api/secrets` — write-only token/Gemini key fields. `.env` overrides still win; a token change needs a restart.
- `POST /api/actions/publish-role-panel` / `publish-ticket-panel` — create or edit the Discord panel message and save its `messageId`.
- `POST /api/actions/test-welcome` / `test-goodbye`, `POST /api/ai/test` — save first, then send/classify.
- Config saves run through `replaceConfig()` → `normalizeConfig()` + `sanitizeConfig()`, so both the web UI and the raw JSON editor produce a valid config and changes are live immediately.
- Auth: loopback-only by default; `DASHBOARD_PASSWORD` enables a login with a 12-hour `HttpOnly; SameSite=Strict` cookie. Session state is in memory, so a restart signs everyone out.

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
- If role changes silently fail, check the bot's role position and its 401/token errors in the startup log.

## Development notes
- No test suite / linter / formatter — plain TypeScript, `tsc --strict`. Typecheck: `npx tsc --noEmit`.
- Dashboard assets are plain files in `dashboard/` (served as-is, no bundler). When adding UI features, keep the CSP in mind: external scripts only (`script-src 'self'`), inline styles allowed.
- Slash commands re-register to `guildId` on every start — run `npm start` after adding commands.
- `config.json` is read once at startup; in-Discord slash-command changes write to disk but do **not** restart the bot. `npm run dev` only restarts on code changes.
- Token vs client secret: both look like `xxx.yyy.zzz`. Only the Bot Token works; the startup log reports a 401.
- Line endings: `.gitattributes` forces LF (`eol=lf`) even on Windows — match existing files when editing.
