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
- `data/talaba.json` — JSON DB (users + tickets) written synchronously, auto-created, gitignored. `data/fonts/` may hold a runtime-downloaded emoji font. `data/l7aj-memory.json` holds the persona's durable notes (auto-created, gitignored).
- `.env` precedence: `process.env.BOT_TOKEN || cfg.token`; same for `GEMINI_API_KEY || automod.aiModeration.apiKey`.

## Architecture
- Entry `src/index.ts`: dotenv → `loadConfig()` → `initDb()` → `startDashboard()` → guild command registration → `login()`. The dashboard deliberately starts before login.
- Ready handler is `clientReady` (not `ready`). It creates the 1-minute voice-XP interval and the 5-minute ticket auto-close sweeper, clearing any previous interval first so reconnects don't double-award.
- Commands (`src/commands/`): `rank`, `leaderboard`, `reactionroles`, `roles` (button panels), `levels`, `xp`, `verify`, `config`, `tickets`, `clear`. Events (`src/events/`): `messageCreate` (automod → L7aj persona, fire-and-forget → XP), `voiceStateUpdate`, `messageReaction`, `guildMember`, `logging` (wires ~all guild events to `utils/logger.ts`). Handlers (`src/handlers/`): `registerCommands`, `buttons`, `tickets`, `levelUp`. Utils: `level`, `rankcard`/`rankEmbeds`, `welcomecard`, `automod`, `autoReply`, `gemini-live`, `gemini-persona`, `l7aj`, `l7aj-memory`, `logger`, `fonts`, `discord`. Prompts live in `src/prompts/` (the L7aj character prompt).
- Interaction routing is manual in `src/index.ts`: modals → `ticket:*` buttons → other buttons (`verify:grant`/`verify:revoke`, `role:toggle:<roleId>`) → autocomplete → slash commands. New component namespaces must be wired there.
- Log channel resolves to `config.logging.channelId` when set, otherwise `config.channels.logs`. Logging fails open (never blocks core functionality).
- Paths for `config.json`, `data/`, fonts and dashboard assets resolve via `__dirname/..`, so both `tsx src/...` and `dist/` builds work from anywhere. Exception: `welcome.backgroundImage` resolves against `process.cwd()` — run the bot from the repo root.
- XP: MEE6 math `5*L² + 50*L + 100`; random 15–25/msg with 60s cooldown, 5–8/voice minute, bots ignored by default. Rank cards are PNGs via `@napi-rs/canvas` with a text-embed fallback.
- Auto-replies (`src/utils/autoReply.ts`, edited in the dashboard's **Auto-replies** section): `config.autoReplies.rules` are checked in order and the first match replies once per message. Bots are always ignored, so replies cannot cascade. Matching is `exact`/`contains`/`startsWith`/`regex` (invalid regex fails closed), empty `channelIds` means every channel, and `cooldownSeconds` is per member per rule. Placeholders: `{user}` `{username}` `{server}` `{channel}` `{message}` `{trigger}`.
- Live leaderboard (`src/utils/liveLeaderboard.ts`): one persistent message (`config.liveLeaderboard.channelId/messageId`) re-rendered every `intervalMinutes` by a 60s scheduler started in `clientReady` — the interval is re-read each tick, so dashboard edits apply live. It sends ONE embed: top-3 podium PNG, Top 3 links, rank zones with inline text progress bars and `─` divider fields. Usernames are masked links to `discord.com/users/<id>`. Discord always renders an embed image after its fields, so the podium sits at the bottom of the card. Separate from `/leaderboard`, which still renders per call. Unchanged data only skips the edit until the "last update" footer wording changes; a missing message id/channel re-posts and saves the new id.

## Dashboard
- `src/dashboard/server.ts` + plain HTML/CSS/JS in `dashboard/`. No build step: editing those files only needs a browser refresh, not a bot restart.
- CSP is strict: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:`. No inline `<script>`, no CDN scripts/fonts — new JS must be a file under `dashboard/`.
- Routes: `GET /api/session`, `POST /api/login|logout`, `GET /api/health|guild|stats|config`, `PUT /api/config`, `POST /api/secrets`, `POST /api/actions/reload-config|test-welcome|test-goodbye|publish-role-panel|publish-ticket-panel|publish-live-leaderboard|clear-l7aj-memory`, `POST /api/ai/test`, `POST /api/ai/persona-test`.
- `GET /api/config` omits `token` and returns the Gemini key as `__REDACTED__`. `PUT /api/config` requires the returned `revision` (sha256 of the live config, 16 chars) and returns `409` if a slash command changed it meanwhile. Secrets go only through `POST /api/secrets`.
- Auth is loopback-only by default; a non-loopback `DASHBOARD_HOST` refuses to start without `DASHBOARD_PASSWORD`. Sessions are in memory (12h HttpOnly cookie), so a restart signs everyone out.
- Dashboard actions that need Discord (publish/test) fail when the bot is not logged in, but the dashboard itself still starts — that is how a broken token gets fixed.

## AI moderation (Gemini Live)
- `src/utils/gemini-live.ts` streams via `@google/genai` Live sessions; turn-based, so requests are serialised through a queue. Defaults: 15s timeout, queue 50, recycle socket after 20 turns or 5 minutes.
- Verified model quirks (header comment): `gemini-3.8-live` closes with code 1007 if you ask for `responseModalities: [TEXT]` — request AUDIO plus `outputAudioTranscription` and read the transcript. `gemini-3.8-live` must NOT receive `thinkingConfig`; the `-extended-thinking` variant requires `thinkingLevel`.
- Automod order: owner and moderation-permission bypass → ignored channels (skip everything) → bypass roles (skip regex, still AI) → URL/GIF/CAPS → Gemini. `automod.aiModeration.bypassRoleIds` is the inverse exemption: those roles skip the AI check but keep the regex filters. AI deletes the message, DMs the author, and alerts staff only at/above `confidenceThreshold`.
- Fail-open everywhere: timeout, queue overflow, connection loss, or invalid JSON yields `null` → message allowed.

## L7aj persona
- `src/utils/l7aj.ts` is the Discord side: per-channel batching (default 2.5s, max 12 messages), an in-memory history ring per channel, a global decision cooldown (default 10s) so a busy channel cannot open a Live session every few seconds, a reply cooldown + hourly cap, tool execution and sending. It never awaits the model on the `messageCreate` path. Every member message in a monitored channel is logged as `[L7aj] #channel | author (id): content`.
- `src/utils/l7aj-media.ts` turns image/GIF attachments and supported GIF links (Discord CDN, Tenor, Giphy, Imgur) into Gemini Live inline image parts. GIFs are reduced to their first frame and images are resized/capped; failures just leave the text marker. Only the current batch is sent as visual input.
- `src/utils/gemini-persona.ts` is the Live transport. The reply/silent decision is expressed with three always-on tools (`send_message`, `send_sticker`, `stay_silent`); `send_message`/`send_sticker` take a model-chosen `reply` boolean, so native replies are not a static config. `src/prompts/l7aj.ts` holds the character prompt verbatim and appends a runtime contract that replaces section 14 (the JSON envelope), which the model could not post to Discord, plus the full Discord formatting/mention/emoji/sticker contract. JSON output is still parsed as a fail-safe fallback. The transport ignores the tool-call turn's `turnComplete` until the follow-up round starts, and nudges the model once if a tool result is answered with prose instead of a decision tool.
- `src/utils/l7aj-memory.ts` persists `data/l7aj-memory.json`. Notes are deduped, capped at 300 per guild, and written synchronously best-effort.
- The persona uses the same key as AI moderation (`GEMINI_API_KEY` → `automod.aiModeration.apiKey`). Like the moderator it requests AUDIO plus `outputAudioTranscription` (TEXT-only is rejected by `gemini-3.8-live`) and must not receive `thinkingConfig` unless the model is the `-extended-thinking` variant.
- Every failure fails silent: timeout, queue overflow, connection loss or a malformed turn all resolve to "do not speak". A decision tears down/recycles the socket immediately so trailing audio cannot leak into the next event.
- Tools: recent messages, history search, member info, user XP stats, leaderboard, server info, voice members, channel info, server emoji list, server sticker list, current time, reaction, recall/remember fact, Minecraft status (only when a server address is configured). `l7aj.toolsEnabled` gates the information/action tools; the three decision tools are always present. History lines include author IDs so `<@ID>` mentions use real IDs, and a `[reply to ...]` marker (`[reply to your message]` when the reply targets L7aj). The runtime prompt treats a reply to L7aj's own message, or a direct mention of its ID, as a strong signal the message is addressed to it, while leaving the final reply/silent decision to the model. `allowedMentions` enables users only (roles, `@everyone` and `@here` stay silent).
- `config.l7aj` is live on save. `channelIds` empty means it listens nowhere; `systemPrompt` empty falls back to `L7AJ_DEFAULT_PROMPT`. The dashboard **L7aj Persona** section has a dry-run test (`POST /api/ai/persona-test`) and a clear-memory action.

## Scripts & benchmark
- `npx tsx scripts/preview-welcome.ts` renders `preview-welcome.png` (gitignored).
- `node scripts/moroccan_darija_ai_moderation_benchmark.js` runs the dependency-free curated benchmark (docs: `docs/README_moroccan_darija_ai_moderation_benchmark.md`). `npx tsx scripts/run_ai_moderation_benchmark.ts` needs `GEMINI_API_KEY`.
- Trust `src/` over `scripts/`: benchmark/probe scripts predate the current `GeminiLiveModerator` options-object constructor and are not compiled.
- Root-level `moroccan_darija_ai_moderation_benchmark.js`, `darija_arabizi_moderation_tests.js`, the zip and its README duplicate the benchmark; they differ from `scripts/` and `docs/`, which are the maintained copies.

## Discord requirements
- Privileged intents (Developer Portal → Bot): **Server Members**, **Message Content**. Presence is unused.
- Permissions: Manage Roles (must sit above every assigned role or changes fail silently), Send Messages, Read Message History, View Channels. Add Reactions is only used by the L7aj persona's reaction tool.
- Login 401 = token reset/revoked or the client secret was used (both look like `xxx.yyy.zzz`). 403 = bot not in the guild.

## Repo notes
- Git: commits use `type(scope): summary` (e.g. `fix(voice): ...`) and go straight to `main`; `.gitattributes` enforces LF — keep it when editing.
- `.kilo/worktrees/brash-asiago/` is an ignored git worktree pinned to an older commit with stale copies of every file. Ignore it in searches; the repo root is current.
