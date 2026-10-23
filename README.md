# TALABA <3 Bot

Discord bot with a MEE6-style XP system, button role panels, reaction roles, verification and level-based role rewards.

## Quick start

```bash
npm install
cp .env.example .env   # then fill in BOT_TOKEN, CLIENT_ID, GUILD_ID
npm run dev            # starts the bot (tsx watch, no build needed)
```

Settings can also live in `config.json` (`token`, `clientId`, `guildId`); environment variables
take precedence. Every other setting is managed from Discord with the `/config`, `/levels`, `/xp`,
`/roles`, `/verify` and `/tickets` commands, or from the web dashboard described below — both write
back to `config.json`.

## Web dashboard

The bot starts a local configuration dashboard on **http://127.0.0.1:3000**:

```bash
npm start        # or npm run dev
# then open http://127.0.0.1:3000
```

It is served from inside the bot process, so **saving applies changes immediately** (no restart) and
writes the same `config.json` that slash commands use.

| What you can edit | Details |
| --- | --- |
| XP & levels | Message/voice rates, cooldown, XP channels, level reward roles |
| Channels & logging | Level-up channel + template, log channel, per-event log categories |
| Welcome & goodbye | Channel, messages, card text, background path, **send test** button |
| AutoMod & AI | URL/GIF/CAPS filters, thresholds, exemptions, Gemini prompt/model/threshold, **dry-run classifier** |
| Role panels | Create/edit/delete panels and buttons, override mode, **post/update the Discord message** |
| Reaction roles & verification | Channel, message, emoji→role mappings, verified role |
| Tickets | Panels, button styling, categories, staff/ping roles, form fields, auto-close, transcripts |
| Auto-reactions | Channel → emoji list |
| L7aj persona | Channels, model, pacing, tools/memory, full character prompt, **dry-run persona test**, clear memory |
| Data & stats | XP leaderboard, tracked members, recent/open tickets |
| Advanced | Write-only bot token / Gemini key fields, raw JSON editor |

Environment variables (all optional):

| Variable | Default | Purpose |
| --- | --- | --- |
| `DASHBOARD_ENABLED` | `true` | Set to `false` to disable the dashboard |
| `DASHBOARD_HOST` | `127.0.0.1` | Interface to bind. Non-loopback hosts require a password |
| `DASHBOARD_PORT` | `3000` | HTTP port |
| `DASHBOARD_PASSWORD` | *(empty)* | Set to require a login (12-hour session cookie) |

The token and Gemini API key are never sent to the browser. Secrets are edited through write-only
fields and can be overwritten by `BOT_TOKEN` / `GEMINI_API_KEY` in `.env`. The dashboard has no
Discord login — it is a host-local admin tool. Run it on a machine you trust and use a password if
you expose the port.


## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the bot with `tsx watch` — restarts on code changes |
| `npm start` | Run the bot (no build needed) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run serve` | Run the compiled output in `dist/` |

> `npm run dev` uses `tsx watch src/index.ts`. Because `config.json` is read at runtime rather
> than imported, changing settings from Discord **does not** trigger a restart.

## Features

| Feature | Details |
| --- | --- |
| XP system | MEE6-identical: random 15–25 XP per message, once per minute |
| Voice XP | Random 5–8 XP per voice minute |
| Rank card | Rendered as a **PNG image** (MEE6 style) — avatar, level, XP bar, rank |
| Leaderboard | Also a **PNG image** with avatars and level/XP per member |
| Level rewards | Roles granted at level milestones, lower tiers removed automatically |
| Level-up ping | Plain text message that pings the member who levelled up |
| Button role panels | Unlimited self-assign panels, one button per role |
| Reaction roles | Optional — react to a message to get a role |
| Verification | Click a button to receive the "verified" role |
| Rank card fallback | If the canvas fails, a text embed is sent instead |
| L7aj persona | A second Gemini Live client that reads chosen channels and decides on its own whether to reply — silent by default, with conversation history, durable memory and server tools |
| Web dashboard | Local UI at `http://127.0.0.1:3000` to edit every setting, post role/ticket panels, and test welcome/AI moderation |

## Rank card & leaderboard images

Rendered with [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) — prebuilt binaries, so
no compiler is needed on the host.

Fonts live in `assets/fonts/` (Noto, SIL Open Font License) and cover Latin, Latin-Ext, Greek,
Cyrillic, Vietnamese, Arabic, Hebrew, Thai, Devanagari, Bengali and Tamil. Host fonts (Arial,
DejaVu, Noto Color Emoji, Segoe UI Emoji…) are picked up automatically when present. On a bare
Linux host with no emoji font, the bot downloads Noto Color Emoji once into `data/fonts/`.

## MEE6 parity

The level curve is MEE6's exact formula — XP needed to advance from level `L` to `L+1`:

```
5 * L^2 + 50 * L + 100
```

| Level | XP needed | Total XP |
| --- | --- | --- |
| 0 → 1 | 100 | 0 |
| 1 → 2 | 155 | 100 |
| 5 → 6 | 475 | 1,150 |
| 10 → 11 | 1,100 | 4,675 |
| 20 → 21 | 3,100 | 23,850 |
| 50 → 51 | 15,100 | 268,375 |

MEE6 defaults also mirrored: **random 15–25 XP per message**, maximum once every **60 seconds**,
and XP is never awarded in DMs.

## Commands

### Members

| Command | Description |
| --- | --- |
| `/rank [user]` | MEE6-style rank card (image) |
| `/leaderboard [limit]` | Top members by XP (image) |

### Roles — button panels

| Command | Description |
| --- | --- |
| `/roles setup name:Games channel:#roles` | Create a new role panel (you can make as many as you like) |
| `/roles panel add panel:Games role:@Gamer label:Gamer emoji:🎮 style:green` | Add a role button |
| `/roles panel remove panel:Games role:@Gamer` | Remove a button |
| `/roles panel list [panel]` | List panels, or the buttons of one |
| `/roles panel delete panel:Games` | Delete a panel and its message |

Buttons **toggle** the role: click to get it, click again to drop it. The panel message is
re-rendered automatically whenever you add or remove a button.

### Roles — reaction panel

| Command | Description |
| --- | --- |
| `/reactionroles setup channel:#roles` | Post a reaction-role message |
| `/reactionroles add emoji:👍 role:@Member` | Add a mapping and react automatically |
| `/reactionroles remove emoji:👍` | Remove a mapping |
| `/reactionroles list` | List mappings |

### Verification

| Command | Description |
| --- | --- |
| `/verify setup role:@Verified channel:#verify` | Post a verify button |
| `/verify disable` | Delete the message and turn it off |
| `/verify status` | Show the current setup |

### XP & levels (admin)

| Command | Description |
| --- | --- |
| `/levels setup` | XP rates, level-up channel, log channel, announcement text |
| `/levels role add level:5 role:@Level 5` | Grant a role at a level |
| `/levels role remove level:5` | Remove a level reward |
| `/levels role list` | List level rewards |
| `/xp channel [#channel]` | MEE6 `!xpchannel` — only this channel gives XP (blank = all) |
| `/xp nocxp add\|remove\|list` | MEE6 `!nocxp` — channels where XP is not earned |
| `/config show` | Full configuration overview (token never shown) |

All admin commands require the **Manage Server** permission.

### Level-up announcements

Level-ups post a **plain text message that pings the member** (only them — `allowedMentions` is
limited to that user). The template is configurable:

```
/levels setup announce_message:"🎉 {user} just hit **level {level}**! {role}"
```

Available placeholders: `{user}` (ping) · `{username}` · `{level}` · `{server}` · `{role}` ·
`{xp}` (XP in the current level) · `{xpneeded}` (XP required for the next level).

## Discord requirements

**Developer Portal → Bot → Privileged Gateway Intents** — enable:

- Server Members Intent
- Message Content Intent

Presence is not used, so the Presence Intent is optional.

**Server permissions for the bot:** Manage Roles, Send Messages, Read Message History, View Channels.
**Manage Roles** must sit above any role the bot assigns, otherwise role assignment silently fails.
**Add Reactions** is only needed if L7aj's reaction tool should work.

## Hosting (bot-hosting.net)

- Install command: `npm install`
- Start command: `npm start` (runs through `tsx`, no build step)
- Environment variables (override `config.json`):
  - `BOT_TOKEN`
  - `CLIENT_ID`
  - `GUILD_ID`

XP data is stored in `data/talaba.json` and is created automatically. In-Discord config changes
are written back to `config.json`, so make sure the host has a persistent filesystem.

## Where the IDs come from

1. **Bot token / Client ID** — [Discord Developer Portal](https://discord.com/developers/applications) → your app → **Bot** tab. The token is on the *Bot* tab; the *client secret* on *General Information* looks identical but does not work.
2. **Guild ID** — enable Developer Mode (Settings → Advanced), then right-click your server → Copy Server ID.
3. **Message / channel IDs** — right-click → Copy Message ID / Copy Channel ID.
4. **Role IDs** — Server Settings → Roles → right-click a role → Copy Role ID.
5. **Emoji** — type or paste it directly (e.g. `👍`), or use `<:name:id>` for custom emoji.
