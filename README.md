# Stickfigure Platformer Game

A standalone platformer game built with Next.js and Canvas. Use Node.js 22 or newer.

## Quick Start

```bash
npm ci
npm run dev
```

Visit `http://localhost:3000`. Solo gameplay runs without service credentials. For multiplayer, copy `.env.example` to `.env.local` and set `ABLY_API_KEY` before starting the server. Share a room code or use **Copy invite link** from the lobby.

## Build for Production

```bash
npm run build
npm start
```

## JRod Hub and ChatGPT Sites

`npm run build:hub` packages the prerendered game and assets under `build/site/stickfigure/`. The Hub Worker serves `index.html` for `/stickfigure/`. The rest of that directory goes into the Hub's static assets at the same prefix.

In the Hub Worker, call `issueMultiplayerToken(request, env.STICKFIGURE_ABLY_API_KEY)` from `app/utils/multiplayerAuth.mjs` for `GET /stickfigure/api/multiplayer-token/`. Configure `STICKFIGURE_ABLY_API_KEY` as a runtime secret. A standalone Next.js deployment uses `ABLY_API_KEY` for the corresponding route. Keep the same Ably app and room namespace if players on both hosts should be able to share room codes.

Use the existing JRod Hub Site (`appgprj_6ac2e378ab00819189d0aa31f0db5147`) and reconcile the game with the latest Hub source before saving and deploying. Record the exact GitHub revision in the integration. Verify the JRod and generated Sites URLs with a host and guest through room creation, ready-up, match start and gameplay. Pushes to this repository do not deploy the Hub.

## Game Controls

- **Arrow Keys / WASD**: Move
- **Space**: Jump
- **Mouse Click**: Shoot
- **Number Keys 1-9**: Switch weapons
- **ESC**: Pause menu

Survive waves of enemies and see how long you can last!
