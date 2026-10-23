# TALABA <3 Discord Bot — Agent Instructions

## Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | `tsx watch src/index.ts` — restarts on **source** changes only |
| `npm start` | `tsx src/index.ts` — no build step |
| `npm run build` | `tsc` → `dist/` |
| `npm run serve` | `node dist/index.js` |
| `npx tsc --noEmit` | Only verification in the repo — no tests, linter, or formatter |

`tsconfig.json` includes `src/**/*` only, so `scripts/` is never typechecked and can drift from the API it imports.

## Config & secrets
- `config.json` is runtime state and holds live secrets; `.env` overrides it with `BOT_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `GEMINI_API_KEY`. Both are gitignored — never commit or print their contents.
- Never write the config file directly. Use `updateConfig(mutator)` / `replaceConfig(raw)` from `src/config.ts`: they normalise, sanitise, persist, and swap the live object returned by `getConfig()`. `replaceConfig(..., { preserveSecrets: true })` keeps `__REDACTED__` placeholders.
- Adding/renaming a config field touches: `BotConfig`, `DEFAULT_CONFIG`, `normalizeConfig`, `sanitizeConfig` (all `src/config.ts`), `config.example.json`, and the field lists in `dashboard/app.js`.
- `token`/`clientId`/`guildId` are captured at startup, so a token change needs a restart; every other setting is live on save.
- `data/talaba.json` — JSON DB (users + tickets) written synchronously, auto-created, gitignored. `data/fonts/` may hold a runtime-downloaded emoji font.
- `.env` precedence: `process.env.BOT_TOKEN || cfg.token`; same for `GEMINI_API_KEY || automod.aiModeration.apiKey`.

## Architecture
- Entry `src/index.ts`: dotenv → `loadConfig()` → `initDb()` → `startDashboard()` → guild command registration → `login()`. The dashboard deliberately starts before login.
- Ready handler is `clientReady` (not `ready`). It creates the 1-minute voice-XP interval and the 5-minute ticket auto-close sweeper, clearing any previous interval first so reconnects don't double-award.
- Commands (`src/commands/`): `rank`, `leaderboard`, `reactionroles`, `roles` (button panels), `levels`, `xp`, `verify`, `config`, `tickets`. Events (`src/events/`): `messageCreate` (automod → XP), `voiceStateUpdate`, `messageReaction`, `guildMember`, `logging` (wires ~all guild events to `utils/logger.ts`). Handlers (`src/handlers/`): `registerCommands`, `buttons`, `tickets`, `levelUp`. Utils: `level`, `rankcard`/`rankEmbeds`, `welcomecard`, `automod`, `gemini-live`, `logger`, `fonts`, `discord`.
- Interaction routing is manual in `src/index.ts`: modals → `ticket:*` buttons → other buttons (`verify:grant`/`verify:revoke`, `role:toggle:<roleId>`) → autocomplete → slash commands. New component namespaces must be wired there.
- Log channel resolves to `config.logging.channelId` when set, otherwise `config.channels.logs`. Logging fails open (never blocks core functionality).
- Paths for `config.json`, `data/`, fonts and dashboard assets resolve via `__dirname/..`, so both `tsx src/...` and `dist/` builds work from anywhere. Exception: `welcome.backgroundImage` resolves against `process.cwd()` — run the bot from the repo root.
- XP: MEE6 math `5*L² + 50*L + 100`; random 15–25/msg with 60s cooldown, 5–8/voice minute, bots ignored by default. Rank cards are PNGs via `@napi-rs/canvas` with a text-embed fallback.
- Live leaderboard (`src/utils/liveLeaderboard.ts`): one persistent message (`config.liveLeaderboard.channelId/messageId`) re-rendered every `intervalMinutes` by a 60s scheduler started in `clientReady` — the interval is re-read each tick, so dashboard edits apply live. It sends ONE embed: top-3 podium PNG, Top 3 links, rank zones with inline text progress bars and `─` divider fields. Usernames are masked links to `discord.com/users/<id>`. Discord always renders an embed image after its fields, so the podium sits at the bottom of the card. Separate from `/leaderboard`, which still renders per call. Unchanged data only skips the edit until the "last update" footer wording changes; a missing message id/channel re-posts and saves the new id.

## Dashboard
- `src/dashboard/server.ts` + plain HTML/CSS/JS in `dashboard/`. No build step: editing those files only needs a browser refresh, not a bot restart.
- CSP is strict: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:`. No inline `<script>`, no CDN scripts/fonts — new JS must be a file under `dashboard/`.
- Routes: `GET /api/session`, `POST /api/login|logout`, `GET /api/health|guild|stats|config`, `PUT /api/config`, `POST /api/secrets`, `POST /api/actions/reload-config|test-welcome|test-goodbye|publish-role-panel|publish-ticket-panel|publish-live-leaderboard`, `POST /api/ai/test`.
- `GET /api/config` omits `token` and returns the Gemini key as `__REDACTED__`. `PUT /api/config` requires the returned `revision` (sha256 of the live config, 16 chars) and returns `409` if a slash command changed it meanwhile. Secrets go only through `POST /api/secrets`.
- Auth is loopback-only by default; a non-loopback `DASHBOARD_HOST` refuses to start without `DASHBOARD_PASSWORD`. Sessions are in memory (12h HttpOnly cookie), so a restart signs everyone out.
- Dashboard actions that need Discord (publish/test) fail when the bot is not logged in, but the dashboard itself still starts — that is how a broken token gets fixed.

## AI moderation (Gemini Live)
- `src/utils/gemini-live.ts` streams via `@google/genai` Live sessions; turn-based, so requests are serialised through a queue. Defaults: 15s timeout, queue 50, recycle socket after 20 turns or 5 minutes.
- Verified model quirks (header comment): `gemini-3.8-live` closes with code 1007 if you ask for `responseModalities: [TEXT]` — request AUDIO plus `outputAudioTranscription` and read the transcript. `gemini-3.8-live` must NOT receive `thinkingConfig`; the `-extended-thinking` variant requires `thinkingLevel`.
- Automod order: owner and moderation-permission bypass → ignored channels (skip everything) → bypass roles (skip regex, still AI) → URL/GIF/CAPS → Gemini. AI deletes the message, DMs the author, and alerts staff only at/above `confidenceThreshold`.
- Fail-open everywhere: timeout, queue overflow, connection loss, or invalid JSON yields `null` → message allowed.

## Scripts & benchmark
- `npx tsx scripts/preview-welcome.ts` renders `preview-welcome.png` (gitignored).
- `node scripts/moroccan_darija_ai_moderation_benchmark.js` runs the dependency-free curated benchmark (docs: `docs/README_moroccan_darija_ai_moderation_benchmark.md`). `npx tsx scripts/run_ai_moderation_benchmark.ts` needs `GEMINI_API_KEY`.
- Trust `src/` over `scripts/`: benchmark/probe scripts predate the current `GeminiLiveModerator` options-object constructor and are not compiled.
- Root-level `moroccan_darija_ai_moderation_benchmark.js`, `darija_arabizi_moderation_tests.js`, the zip and its README duplicate the benchmark; they differ from `scripts/` and `docs/`, which are the maintained copies.

## Discord requirements
- Privileged intents (Developer Portal → Bot): **Server Members**, **Message Content**. Presence is unused.
- Permissions: Manage Roles (must sit above every assigned role or changes fail silently), Send Messages, Read Message History, View Channels.
- Login 401 = token reset/revoked or the client secret was used (both look like `xxx.yyy.zzz`). 403 = bot not in the guild.

## Repo notes
- Git: commits use `type(scope): summary` (e.g. `fix(voice): ...`) and go straight to `main`; `.gitattributes` enforces LF — keep it when editing.
- `.kilo/worktrees/brash-asiago/` is an ignored git worktree pinned to an older commit with stale copies of every file. Ignore it in searches; the repo root is current.
