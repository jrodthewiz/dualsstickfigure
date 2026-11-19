# PvP Multiplayer Setup Guide

> This is the historical Ably setup. See the [current keyless setup](README.md#jrod-hub-and-chatgpt-sites).

This guide explains how to set up and use the newly implemented PvP multiplayer feature in the Stickfigure Platformer game.

## What Was Implemented

The game now supports real-time PvP (Player vs Player) multiplayer using Ably for real-time communication. Key features include:

- **Lobby System**: Create or join game lobbies with unique session IDs
- **Real-time Player Synchronization**: Player positions, animations, and health sync at 20 Hz
- **Presence Tracking**: See who's connected in real-time
- **Host Authority**: Host controls game start
- **Remote Player Rendering**: See other players' stickfigure animations in real-time

## Prerequisites

1. **Node.js** (v22 or higher)
2. **Ably Account** (free tier works fine)

## Setup Instructions

### 1. Install Dependencies

```bash
npm ci
```

### 2. Get Ably API Keys

1. Go to [https://ably.com/](https://ably.com/) and create a free account
2. Create a new app in the Ably dashboard
3. Copy your API key from the "API Keys" tab

### 3. Configure Environment Variables

Create a `.env.local` file in the project root:

```env
ABLY_API_KEY=your_ably_key_here
```

Use a server-side Ably key allowed to publish, subscribe, and use presence on `stickfigure:*`. The game requests a short-lived token when a player chooses multiplayer. Remove the legacy `NEXT_PUBLIC_ABLY_API_KEY` setting from new deployments.

### 4. Start the Development Server

```bash
npm run dev
```

Visit `http://localhost:3000` (or the port shown in your terminal).

## How to Use PvP Mode

### Creating a Lobby (Host)

1. Start the game
2. Select **PvP** mode (instead of Infinite)
3. Enter your username
4. Click "START GAME" or press Enter
5. In the lobby menu, click **"CREATE LOBBY"**
6. Enter your username and click "🎮 CREATE LOBBY"
7. You'll see a **Session ID** - share this with other players
8. Click **"📋 COPY"** to copy the session ID to clipboard
9. Wait for players to join (you'll see them appear in the player list)
10. When ready, click **"⚔ START GAME"** (requires at least 2 players)

### Joining a Lobby (Client)

1. Start the game
2. Select **PvP** mode
3. Enter your username
4. Click "START GAME" or press Enter
5. In the lobby menu, click **"JOIN LOBBY"**
6. Enter your username
7. Paste the **Session ID** from the host
8. Click "🚪 JOIN LOBBY"
9. Wait in the lobby until the host starts the game

## Testing Locally

To test multiplayer on the same computer:

1. Open the game in your main browser window
2. Create a lobby and copy the session ID
3. Open a new incognito/private window (or different browser)
4. Join the lobby using the session ID
5. Start the game from the host window

**Tip**: Use Chrome + Firefox, or Chrome regular + Chrome incognito for testing.

## Features

### Real-time Synchronization

- **Player Position**: Synced 20 times per second
- **Animations**: All stickfigure animations are synced
- **Health**: Health bars update in real-time
- **Movement**: Smooth player movement with interpolation

### Lobby Features

- **Session IDs**: Unique identifiers for each game
- **Player List**: See all connected players
- **Host Controls**: Only the host can start the game
- **Presence**: Automatic disconnect detection

### Technical Details

- **Rate Limiting**: 50ms minimum between syncs (20 Hz)
- **Conflict Resolution**: Timestamp-based stale data rejection
- **Client-side Prediction**: Local player actions are instant
- **Safe Channel Operations**: Error-proof Ably channel management

## Architecture

### Core Components

```
app/
├── context/
│   ├── AblyContext.tsx       - Singleton Ably client provider
│   └── GameContext.tsx        - Multiplayer state & lobby management
├── components/multiplayer/
│   ├── LobbyMenu.tsx          - Create/Join lobby UI
│   └── LobbyView.tsx          - Lobby waiting room UI
├── utils/
│   └── ablyHelpers.ts         - Safe Ably operations
└── types/
    └── Multiplayer.ts         - TypeScript types
```

### Message Flow

1. **Lobby Creation**:
   - Host generates sessionId
   - Enters Ably presence
   - Subscribes to presence events

2. **Player Joining**:
   - Client gets sessionId from host
   - Joins Ably channel
   - Enters presence with username

3. **Game Start**:
   - Host publishes 'gameStart' event
   - All clients receive event and start game

4. **In-Game Sync**:
   - Each player publishes 'playerSync' every 50ms
   - Clients receive and render remote players

## Troubleshooting

### "Failed to create lobby"

- Check that your Ably API key is correct in `.env.local`
- Ensure `.env.local` is in the project root
- Restart the dev server after adding environment variables

### "Failed to join lobby"

- Verify the session ID is correct (copy-paste recommended)
- Ensure the host is still in the lobby
- Check browser console for connection errors

### Players not seeing each other

- Check browser console for Ably connection state
- Verify both players are using the same session ID
- Ensure Ably API key has presence permissions enabled

### Lag or sync issues

- Check your internet connection
- Ably free tier has rate limits - avoid spamming
- Close other bandwidth-heavy applications

## Known Limitations

1. **No Combat Sync**: Attacks and damage are not yet synchronized
2. **No Enemy Sync**: AI enemies are not visible to other players
3. **No Spectator Mode**: Players can't watch after dying
4. **No Reconnection**: Disconnected players must rejoin manually
5. **Max Players**: Tested with 2-4 players

## Future Enhancements

Potential improvements for the multiplayer system:

- [ ] Attack and hit detection synchronization
- [ ] Enemy synchronization (host authority)
- [ ] Player respawn in PvP
- [ ] Spectator mode
- [ ] Reconnection handling
- [ ] Game end conditions (last player standing)
- [ ] Score/kills tracking across players
- [ ] Chat system
- [ ] Multiple game rooms/matchmaking
- [ ] Replay system

## API Reference

### GameContext Methods

```typescript
// Create a multiplayer lobby (host)
const sessionId = await gameContext.createMultiplayerLobby(username);

// Join an existing lobby (client)
const success = await gameContext.joinMultiplayerLobby(sessionId, username);

// Leave the current lobby
await gameContext.leaveLobby();

// Start the game (host only)
gameContext.hostStartGame();
```

### Game State

```typescript
gameContext.gameState = {
  isMultiplayerGame: boolean,      // Is in multiplayer mode?
  isHost: boolean,                  // Is this player the host?
  multiplayerSessionId: string,     // Current session ID
  lobbyPhaseActive: boolean,        // In lobby waiting room?
  connectedPlayers: Player[],       // List of connected players
  ablyChannelRef: RealtimeChannel,  // Ably channel reference
  username: string,                 // Local player username
  intendedGameMode: 'PvP' | 'Infinite'
}
```

## Network Messages

### playerSync

Sent by all players to sync position and state:

```typescript
{
  id: string,           // Player clientId
  x: number,            // X position
  y: number,            // Y position
  vx: number,           // X velocity
  vy: number,           // Y velocity
  health: number,       // Current HP
  maxHealth: number,    // Max HP
  animKey: string,      // Animation name
  animFrame: number,    // Animation frame
  facingRight: boolean, // Facing direction
  timestamp: number     // Message timestamp
}
```

### gameStart

Sent by host to start the game:

```typescript
{
  players: ConnectedPlayer[],  // All players in lobby
  startTime: number,            // Game start timestamp
  gameMode: string              // 'PvP'
}
```

### playerJoined

Sent by host when a player joins:

```typescript
{
  players: ConnectedPlayer[],   // Updated player list
  intendedGameMode: string       // Game mode
}
```

## Support

For issues or questions:
1. Check the browser console for errors
2. Verify Ably connection status
3. Review this guide's troubleshooting section
4. Check Ably dashboard for connection logs

## Credits

- **Ably**: Real-time messaging platform
- **Next.js**: React framework
- **TypeScript**: Type-safe JavaScript

---

**Last Updated**: October 17, 2025

