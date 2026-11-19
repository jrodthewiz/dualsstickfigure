# Stickfigure Platformer Game

A standalone platformer game built with Next.js and Canvas. Use Node.js 22 or newer.

## Quick Start

```bash
npm ci
npm run dev
```

Visit `http://localhost:3000`. Solo and multiplayer need no provider credentials. Open the game in two independent browser contexts and use **Copy invite link** or the displayed room code. The standalone Next server stores rooms in memory for one process. Use localhost or HTTPS for browser cryptography and WebRTC.

## Build for Production

```bash
npm run build
npm start
```

## JRod Hub and ChatGPT Sites

`npm run build:hub` packages the prerendered game and assets under `build/site/stickfigure/`. The Hub Worker serves `index.html` for `/stickfigure/`. The rest of that directory goes into the Hub's static assets at the same prefix.

The Hub build uses lossless WebP for sprites and match-intro art. The build checks image dimensions, alpha, and every visible pixel after encoding.

Apply [the room migration](integration/stickfigure-rooms.sql) to the Hub's existing D1 database. Copy [the Worker route adapter](integration/stickfigure-room-worker.mjs) and its [room server module](app/utils/roomServer.mjs) into the Hub source. In the Hub Worker's fetch handler, call `routeStickfigureRoom(request, env.DB)` before routing static assets, using the actual Hub D1 binding in place of `DB`. Return its result when it handles the request. The adapter handles `POST /stickfigure/api/multiplayer-room/` with or without the trailing slash.

The room endpoint carries lobby membership and WebRTC signaling. Gameplay sends over WebRTC DataChannels when connected. Until a peer connects, or when a network blocks the direct connection, the same Hub endpoint relays gameplay for that peer. WebRTC uses a public STUN endpoint for address discovery and the Hub relay for fallback. No TURN service or provider key is required. Rooms expire after the host disconnects. Voice uses its existing WebRTC stream and may be unavailable on networks that prevent direct connections.

Use the existing JRod Hub Site (`appgprj_6ac2e378ab00819189d0aa31f0db5147`) and reconcile the game with the latest Hub source before saving and deploying. Record the exact GitHub revision in the integration. Verify the JRod and generated Sites URLs with a host and guest through room creation, ready-up, match start and gameplay. Pushes to this repository do not deploy the Hub.

## Test the Hub package

Run `npm run build:hub` followed by `node scripts/preview-hub.mjs` on Node 24 or newer. Open `http://127.0.0.1:3104/stickfigure/`. The preview serves the actual static build and uses the same Worker callback, schema, and queries with local SQLite. Production durability and routing require a deployed Hub Worker and its D1 binding.

With Chromium installed, run `npm run smoke:hub` while the preview is running. It verifies software rasterization and completes the two-player flow. Use `npm run smoke:hub -- --force-relay` to exercise the relay by disabling WebRTC in the test browser. Use `npm run smoke:hub -- --require-direct` on an unrestricted network to require gameplay over a WebRTC DataChannel. Set `GAME_URL` or `CHROMIUM_PATH` if your preview URL or Chromium executable differs.

## Game Controls

- **Arrow Keys / WASD**: Move
- **Space**: Jump
- **Mouse Click**: Shoot
- **Number Keys 1-9**: Switch weapons
- **ESC**: Pause menu

Survive waves of enemies and see how long you can last!
