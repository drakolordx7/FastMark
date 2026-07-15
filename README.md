# FastMark

Self-hosted multi-user AI bookmark organizer: crawl/index pages, summarize & tag via an OpenAI-compatible proxy, organize with collections & tags, hybrid search, confirm-to-apply chat, and a Firefox/Chromium extension.

**Repo:** https://github.com/drakolordx7/FastMark

## Features

- Username/password auth (first account is admin; admin creates other users)
- Private libraries per user
- Collections (folders), dynamic tags, favorites, read later
- Background indexer (fetch + Readability → AI summary/tags → embeddings)
- Manual index queue when crawl fails (paste HTML from UI or extension)
- Manual reindex: one / all / collection / tag
- Hybrid FTS + vector search
- AI chat with propose → confirm → apply organization actions
- Per-user AI credentials + admin global default (base URL like `https://…/v1`)
- Optional per-user AI daily caps + usage stats
- HTML bookmark import (Firefox/Chrome)
- Browser extension: login, save tab, context menu, selection search, offline cache, HTML submit
- Light/dark theme; swappable logo URL; timezone (default `America/Chicago`)

## Quick start (Docker)

```bash
cp .env.example .env
# set ENCRYPTION_SECRET and AUTH_SECRET
docker compose up --build
```

Open `http://localhost:3000` (or your reverse-proxied HTTPS URL). Create the first admin account.

Set `APP_URL` to your public origin (no hardcoded production domain in the app). For LAN HTTP use `COOKIE_SECURE=false` or `auto` with an `http://` `APP_URL`.

### Services

| Service  | Role                          |
|----------|-------------------------------|
| web      | Next.js UI + API (`:3000`)    |
| worker   | BullMQ crawl/index jobs       |
| postgres | PostgreSQL + pgvector         |
| redis    | Job queue                     |
| migrate  | One-shot schema bootstrap     |

## Local development

```bash
# start postgres + redis (compose or local)
docker compose up -d postgres redis
cp .env.example .env
# DATABASE_URL=postgres://fastmark:fastmark@localhost:5432/fastmark
# REDIS_URL=redis://localhost:6379
npm install
npx tsx src/lib/db/migrate.ts
npm run dev
# other terminal:
npm run worker
```

## AI configuration

Configure in **Settings** (per user) and/or **Admin** (global default):

- Base URL: `https://your-proxy/v1`
- API key
- Chat/summarize model (leave blank until ready)
- Optional embedding model (otherwise a local hash embedding is used for vector search)

## Browser extension

Folder: [`extension/`](extension/)

### Firefox (temporary add-on)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select [`extension/manifest.json`](extension/manifest.json)
4. Open the toolbar popup, set your FastMark server URL, and sign in
5. Use toolbar popup, context menu “Save to FastMark”, or highlight text → “Search FastMark”

Temporary add-ons unload when Firefox restarts — reload the manifest after restart.

### Chromium / Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder
4. Set server URL in the popup and sign in

Bookmark HTML import in **Settings** always imports into **your** account. Admins can import for another user from **Admin → Import bookmarks for a user**.

## Environment

See [`.env.example`](.env.example). Important:

- `APP_URL` — public origin you reverse-proxy to
- `COOKIE_SECURE` — `auto` | `true` | `false`
- `ENCRYPTION_SECRET` / `AUTH_SECRET` — long random strings

## License

MIT
