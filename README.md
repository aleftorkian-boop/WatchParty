# Watch Party Monorepo

Full-stack Watch Party app with synchronized playback, room host controls, chat, participants, and optional video streaming proxy.

## Stack

- `web/`: Next.js + TypeScript
- `server/`: Express + Socket.IO + TypeScript
- Monorepo managed with `pnpm` workspaces

## Features

- Create and join rooms
- Authoritative server room state sync
- Host-only controls by default (with host transfer)
- Optional `allow anyone to control` toggle
- Synchronized play, pause, seek, and playback rate
- Drift correction on clients (>0.5s with throttled seeks)
- Chat (last 50 messages in memory)
- Participant list + host indicator
- URL validation (`http/https` only)
- Best-effort `/resolve` endpoint for common share links (Drive/Dropbox/OneDrive)
- Supports direct `.mp4`, `.webm`, `.m3u8` sources
- Uses `hls.js` for `.m3u8` when browser lacks native HLS
- Optional backend proxy endpoint with range forwarding and CORS

## Project Structure

- `README.md`
- `.gitignore`
- `package.json`
- `pnpm-workspace.yaml`
- `web/`
- `server/`

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Configure env files:

```bash
cp server/.env.example server/.env
cp web/.env.local.example web/.env.local
```

3. Start both apps:

```bash
pnpm dev
```

4. Open:

- Web: `http://localhost:3000`
- Server health: `http://localhost:4000/health`

## Scripts

Root:

- `pnpm dev` - run server + web concurrently
- `pnpm build` - build server + web

Server (`server/`):

- `pnpm dev`
- `pnpm build`
- `pnpm start`

Web (`web/`):

- `pnpm dev`
- `pnpm build`
- `pnpm start`

## Environment Variables

Server (`server/.env`):

- `PORT` - API/socket server port
- `CORS_ORIGIN` - allowed web origin for API + Socket.IO
- `ENABLE_PROXY` - `true|false` for `/stream`
- `PROXY_ALLOWLIST` - comma-separated host allowlist (optional)
- `PROXY_ALLOWED_ORIGIN` - CORS origin for proxy responses
- `PROXY_MAX_BYTES` - max allowed upstream content-length before reject

Web (`web/.env.local`):

- `NEXT_PUBLIC_SERVER_URL` - backend URL (default `http://localhost:4000`)
- `NEXT_PUBLIC_ENABLE_PROXY` - show proxy option in UI

## Proxy Endpoint

`GET /stream?url=<http/https-url>`

Proxy behavior:

- Validates URL protocol and optional allowlist
- Applies in-memory per-IP rate limit
- Forwards `Range` header upstream
- Returns upstream status (`206` for partial content)
- Exposes range/media headers for browser playback
- Sets CORS headers from env
- Uses timeout and pass-through streaming (no storage)

## Notes and Limitations

- In-memory room/chat/proxy-limit state resets on server restart
- Proxy cannot play DRM-protected streams
- Some upstreams may still block proxying or require auth headers/cookies
- For production, set strict `CORS_ORIGIN` and `PROXY_ALLOWED_ORIGIN`

