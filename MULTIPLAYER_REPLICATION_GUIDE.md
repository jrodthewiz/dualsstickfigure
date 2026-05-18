# Complete Multiplayer System Replication Guide
## Using Ably for Real-Time Multiplayer with Voice Chat

This guide provides everything you need to replicate the multiplayer system from this game in any other project. It includes Ably integration, lobby system, player sync, voice chat, and all supporting code.

---

## Table of Contents
1. [Prerequisites & Setup](#prerequisites--setup)
2. [Core Architecture](#core-architecture)
3. [Step-by-Step Implementation](#step-by-step-implementation)
4. [Code Examples](#code-examples)
5. [Testing & Troubleshooting](#testing--troubleshooting)

---

## Prerequisites & Setup

### 1. Install Dependencies

```bash
npm install ably simple-peer
npm install --save-dev @types/simple-peer
```

**Required packages:**
- `ably` (^2.14.0) - Real-time multiplayer messaging
- `simple-peer` (^9.11.1) - WebRTC peer-to-peer voice chat
- `@types/simple-peer` (^9.11.9) - TypeScript types

### 2. Environment Variables

Create `.env.local` in your project root:

```env
NEXT_PUBLIC_ABLY_API_KEY=your_ably_api_key_here
```

**Getting an Ably API Key:**
1. Go to [https://ably.com](https://ably.com) and sign up (free tier is fine)
2. Create a new app in the Ably dashboard
3. Go to "API Keys" tab
4. Copy the full API key (format: `appId.keyId:keySecret`)
5. Paste into `.env.local`

**Important:** The key must be prefixed with `NEXT_PUBLIC_` to be accessible in the browser (for Next.js). For other frameworks, follow their environment variable conventions.

---

## Core Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         ABLY SERVICE                         │
│              (Realtime messaging & presence)                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
┌───────▼────────┐ ┌───▼─────────┐ ┌──▼──────────┐
│   PLAYER 1     │ │  PLAYER 2   │ │  PLAYER N   │
│   (Host)       │ │  (Client)   │ │  (Client)   │
└────────────────┘ └─────────────┘ └─────────────┘
```

**Key Components:**
1. **AblyContext** - Initializes Ably client globally
2. **GameContext** - Manages multiplayer state and lobby operations
3. **useLobbyVoice Hook** - Handles WebRTC voice chat via Ably signaling
4. **Helper Utilities** - Safe channel operations
5. **Type Definitions** - TypeScript interfaces for all data structures

**Message Flow:**
1. Host creates lobby → generates sessionId
2. Clients join lobby → enter Ably channel presence
3. All players subscribe to game events (playerSync, gameStart, etc.)
4. During gameplay, each player publishes state at 20 Hz
5. Clients interpolate remote player positions for smooth rendering

---

## Step-by-Step Implementation

### Step 1: Ably Context Provider

Create `context/AblyContext.tsx`:

```typescript
"use client";

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import * as Ably from 'ably';

interface AblyContextType {
  client: Ably.Realtime | null;
}

const AblyContext = createContext<AblyContextType>({ client: null });

export function useAbly(): Ably.Realtime | null {
  const context = useContext(AblyContext);
  return context.client;
}

interface AblyProviderProps {
  children: ReactNode;
}

export function AblyContextProvider({ children }: AblyProviderProps) {
  const ablyClient = useMemo(() => {
    // Only initialize on client side
    if (typeof window === 'undefined') return null;
    
    // Reuse existing client if available (persists across HMR in dev)
    if ((window as any).__ablyClient) {
      return (window as any).__ablyClient as Ably.Realtime;
    }
    
    const key = process.env.NEXT_PUBLIC_ABLY_API_KEY;
    
    if (!key) {
      console.warn('NEXT_PUBLIC_ABLY_API_KEY not found. Multiplayer will not work.');
      return null;
    }
    
    // Generate stable clientId (persisted in sessionStorage)
    let clientIdToUse: string | null = null;
    try {
      clientIdToUse = window.sessionStorage.getItem('ablyClientId');
      if (!clientIdToUse) {
        clientIdToUse = `player-${Math.random().toString(36).substr(2, 9)}`;
        window.sessionStorage.setItem('ablyClientId', clientIdToUse);
      }
    } catch (err) {
      console.warn('Could not access sessionStorage, using random clientId');
      clientIdToUse = `player-${Math.random().toString(36).substr(2, 9)}`;
    }

    const options: Ably.ClientOptions = {
      key,
      closeOnUnload: true,
      echoMessages: false, // Don't receive our own messages
      autoConnect: true,
      ...(clientIdToUse ? { clientId: clientIdToUse } : {}),
    };

    const client = new Ably.Realtime(options);
    
    // Cache globally to persist across hot reloads
    (window as any).__ablyClient = client;
    
    // Log connection state changes
    client.connection.on('connected', () => {
      console.log('✅ Ably connected:', client.auth.clientId);
    });
    
    client.connection.on('disconnected', () => {
      console.log('❌ Ably disconnected');
    });
    
    client.connection.on('failed', (err) => {
      console.error('❌ Ably connection failed:', err);
    });
    
    return client;
  }, []);

  return (
    <AblyContext.Provider value={{ client: ablyClient }}>
      {children}
    </AblyContext.Provider>
  );
}
```

**Usage:** Wrap your app with `<AblyContextProvider>` at the root level (e.g., in `app/layout.tsx`).

---

### Step 2: Utility Helpers

Create `utils/ablyHelpers.ts`:

```typescript
// Safe Ably channel operation helpers

type RealtimeChannel = any; // Import from Ably if needed

/**
 * Safely publish a message to an Ably channel
 * Prevents errors from detached/failed channel states
 */
export function safeChannelPublish(
  channel: RealtimeChannel | null | undefined,
  eventName: string,
  data: any
): boolean {
  if (!channel) {
    console.warn('Cannot publish: channel is null/undefined');
    return false;
  }
  
  if (
    channel.state === 'detached' || 
    channel.state === 'detaching' || 
    channel.state === 'failed'
  ) {
    console.warn(`Channel is ${channel.state}, skipping message:`, eventName);
    return false;
  }
  
  try {
    channel.publish(eventName, data);
    return true;
  } catch (error) {
    console.warn(`Failed to publish ${eventName}:`, error);
    return false;
  }
}

/**
 * Safely subscribe to an Ably channel event
 * Returns cleanup function or null
 */
export function safeChannelSubscribe(
  channel: RealtimeChannel | null | undefined,
  eventName: string,
  handler: (message: any) => void
): (() => void) | null {
  if (!channel) {
    console.warn('Cannot subscribe: channel is null/undefined');
    return null;
  }
  
  if (
    channel.state === 'detached' || 
    channel.state === 'detaching' || 
    channel.state === 'failed'
  ) {
    console.warn(`Channel is ${channel.state}, cannot subscribe to:`, eventName);
    return null;
  }
  
  try {
    const safeHandler = (message: any) => {
      try {
        handler(message);
      } catch (error) {
        console.warn(`Error in ${eventName} handler:`, error);
      }
    };
    
    channel.subscribe(eventName, safeHandler);
    
    return () => {
      try {
        if (channel.state !== 'detached' && channel.state !== 'detaching') {
          channel.unsubscribe(eventName, safeHandler);
        }
      } catch (error) {
        console.warn(`Error unsubscribing from ${eventName}:`, error);
      }
    };
  } catch (error) {
    console.warn(`Failed to subscribe to ${eventName}:`, error);
    return null;
  }
}

/**
 * Check if channel is ready for operations
 */
export function isChannelReady(
  channel: RealtimeChannel | null | undefined
): boolean {
  if (!channel) return false;
  return channel.state === 'attached' || channel.state === 'attaching';
}

/**
 * Cleanup all subscriptions from a channel
 */
export function cleanupChannelSubscriptions(
  channel: RealtimeChannel | null | undefined,
  eventNames: string[]
): void {
  if (!channel) return;
  
  try {
    eventNames.forEach(eventName => {
      try {
        channel.unsubscribe(eventName);
      } catch (err) {
        console.warn(`Failed to unsubscribe from ${eventName}:`, err);
      }
    });
  } catch (err) {
    console.warn('Error during channel cleanup:', err);
  }
}
```

---

### Step 3: Type Definitions

Create `types/Multiplayer.ts`:

```typescript
// Multiplayer TypeScript types for Ably integration

export interface PlayerSyncData {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  health: number;
  maxHealth: number;
  animKey: string;
  animFrame: number;
  facingRight: boolean;
  inputs?: {
    punch?: boolean;
    kickHigh?: boolean;
    kickLow?: boolean;
    // Add your game's input types here
  };
  timestamp: number;
}

export interface RemotePlayer {
  id: string;
  username: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  radius?: number;
  health: number;
  maxHealth: number;
  animKey: string;
  animFrame: number;
  facingRight: boolean;
  lastUpdate: number;
  inputs: {
    punch?: boolean;
    kickHigh?: boolean;
    kickLow?: boolean;
    // Add your game's input types here
  };
  // Interpolation support for smooth movement
  interpolationBuffer: Array<{
    position: { x: number; y: number };
    timestamp: number;
  }>;
  renderPosition: { x: number; y: number };
}

export interface ConnectedPlayer {
  clientId: string;
  username: string;
  isReady?: boolean;
}

export type LobbyPhase = 'waiting' | 'map-selection' | 'ready-up';

export interface MultiplayerState {
  isMultiplayerGame: boolean;
  isHost: boolean;
  multiplayerSessionId: string | null;
  lobbyPhase: LobbyPhase | null; // null when not in lobby
  connectedPlayers: ConnectedPlayer[];
  ablyChannelRef: any | null; // RealtimeChannel type
  username: string;
  intendedGameMode: 'PvP' | 'Infinite' | string;
  selectedMapId: string;
}

export interface GameStartMessage {
  players: ConnectedPlayer[];
  startTime: number;
  gameMode: string;
  mapId?: string;
}

export const SYNC_CONSTANTS = {
  PLAYER_SYNC_RATE: 50, // ms (20 Hz)
  POSITION_THRESHOLD: 0.01,
  MAX_LATENCY_COMPENSATION: 200, // ms
} as const;
```

---

### Step 4: Game Context for Multiplayer State

Create `context/GameContext.tsx`:

```typescript
"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import * as Ably from 'ably';
import { useAbly } from './AblyContext';
import { safeChannelPublish, safeChannelSubscribe, cleanupChannelSubscriptions } from '../utils/ablyHelpers';
import type { ConnectedPlayer, MultiplayerState } from '../types/Multiplayer';

interface GameContextType {
  gameState: MultiplayerState;
  setGameState: React.Dispatch<React.SetStateAction<MultiplayerState>>;
  createMultiplayerLobby: (username: string) => Promise<string | null>;
  joinMultiplayerLobby: (sessionId: string, username: string) => Promise<boolean>;
  leaveLobby: () => Promise<void>;
  hostStartGame: () => void;
  selectMap: (mapId: string) => void;
}

const GameContext = createContext<GameContextType | null>(null);

export function useGameContext(): GameContextType {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGameContext must be used within GameProvider');
  }
  return context;
}

interface GameProviderProps {
  children: ReactNode;
}

export function GameProvider({ children }: GameProviderProps) {
  const ably = useAbly();
  
  const [gameState, setGameState] = useState<MultiplayerState>({
    isMultiplayerGame: false,
    isHost: false,
    multiplayerSessionId: null,
    lobbyPhase: null,
    connectedPlayers: [],
    ablyChannelRef: null,
    username: '',
    intendedGameMode: 'PvP',
    selectedMapId: 'default',
  });

  const getChannel = useCallback((sessionId: string): Ably.RealtimeChannel | null => {
    if (!ably) {
      console.warn('Ably client not initialized');
      return null;
    }
    return ably.channels.get(sessionId);
  }, [ably]);

  /**
   * Create a new multiplayer lobby (Host)
   */
  const createMultiplayerLobby = useCallback(async (username: string): Promise<string | null> => {
    if (!ably) {
      console.error('Ably client not available');
      return null;
    }

    try {
      // Wait for connection
      if (ably.connection.state !== 'connected') {
        console.log('Waiting for Ably connection...');
        await new Promise<void>((resolve) => {
          ably.connection.once('connected', () => resolve());
          setTimeout(() => resolve(), 5000);
        });
      }

      // Generate unique session ID
      const sessionId = `game-${Math.random().toString(36).substr(2, 9)}`;
      const channel = getChannel(sessionId);
      
      if (!channel) {
        console.error('Failed to get channel');
        return null;
      }

      const clientId = ably.auth.clientId || 'host';

      // Update state
      setGameState(prev => ({
        ...prev,
        isHost: true,
        multiplayerSessionId: sessionId,
        lobbyPhase: 'waiting',
        isMultiplayerGame: true,
        connectedPlayers: [{ clientId, username, isReady: false }],
        ablyChannelRef: channel,
        username,
      }));

      // Enter presence
      await channel.presence.enter({ username });

      // Subscribe to presence events
      channel.presence.subscribe('enter', (member: Ably.PresenceMessage) => {
        if (member.clientId !== clientId) {
          console.log('Player joined:', member.clientId);
          const newPlayer: ConnectedPlayer = {
            clientId: member.clientId,
            username: (member.data as any)?.username || 'Unknown',
            isReady: false,
          };

          setGameState(prev => {
            if (prev.connectedPlayers.some(p => p.clientId === member.clientId)) {
              return prev;
            }

            const updatedPlayers = [...prev.connectedPlayers, newPlayer];

            // Broadcast updated player list
            safeChannelPublish(channel, 'playerJoined', {
              players: updatedPlayers,
            });

            return { ...prev, connectedPlayers: updatedPlayers };
          });
        }
      });

      channel.presence.subscribe('leave', (member: Ably.PresenceMessage) => {
        if (member.clientId !== clientId) {
          console.log('Player left:', member.clientId);
          setGameState(prev => ({
            ...prev,
            connectedPlayers: prev.connectedPlayers.filter(
              p => p.clientId !== member.clientId
            ),
          }));
        }
      });

      console.log('✅ Lobby created:', sessionId);
      return sessionId;
    } catch (error) {
      console.error('Failed to create lobby:', error);
      return null;
    }
  }, [ably, getChannel]);

  /**
   * Join an existing multiplayer lobby (Client)
   */
  const joinMultiplayerLobby = useCallback(async (sessionId: string, username: string): Promise<boolean> => {
    if (!ably) {
      console.error('Ably client not available');
      return false;
    }

    try {
      // Wait for connection
      if (ably.connection.state !== 'connected') {
        console.log('Waiting for Ably connection...');
        await new Promise<void>((resolve) => {
          ably.connection.once('connected', () => resolve());
          setTimeout(() => resolve(), 5000);
        });
      }

      const channel = getChannel(sessionId);
      
      if (!channel) {
        console.error('Failed to get channel');
        return false;
      }

      // Check if lobby exists
      const members = await channel.presence.get();
      if (members.length === 0) {
        console.warn('No host found in lobby');
        return false;
      }

      const clientId = ably.auth.clientId || `player-${Math.random().toString(36).substr(2, 6)}`;

      // Build initial player list
      const initialPlayers: ConnectedPlayer[] = members.map(m => ({
        clientId: m.clientId,
        username: (m.data as any)?.username || 'Unknown',
        isReady: false,
      }));

      if (!initialPlayers.some(p => p.clientId === clientId)) {
        initialPlayers.push({ clientId, username, isReady: false });
      }

      // Update state
      setGameState(prev => ({
        ...prev,
        isHost: false,
        multiplayerSessionId: sessionId,
        lobbyPhase: 'waiting',
        isMultiplayerGame: true,
        connectedPlayers: initialPlayers,
        ablyChannelRef: channel,
        username,
      }));

      // Enter presence
      await channel.presence.enter({ username });

      // Subscribe to player joined events
      safeChannelSubscribe(channel, 'playerJoined', (message: any) => {
        if (message.data?.players) {
          setGameState(prev => ({
            ...prev,
            connectedPlayers: message.data.players,
          }));
        }
      });

      // Subscribe to presence leave
      channel.presence.subscribe('leave', (member: Ably.PresenceMessage) => {
        console.log('Player left:', member.clientId);
        setGameState(prev => ({
          ...prev,
          connectedPlayers: prev.connectedPlayers.filter(
            p => p.clientId !== member.clientId
          ),
        }));
      });

      console.log('✅ Joined lobby:', sessionId);
      return true;
    } catch (error) {
      console.error('Failed to join lobby:', error);
      return false;
    }
  }, [ably, getChannel]);

  /**
   * Leave the current lobby
   */
  const leaveLobby = useCallback(async () => {
    const channel = gameState.ablyChannelRef;
    
    if (channel) {
      try {
        await channel.presence.leave();
        cleanupChannelSubscriptions(channel, ['playerJoined', 'gameStart', 'playerSync']);
        await channel.detach();
      } catch (error) {
        console.warn('Error leaving lobby:', error);
      }
    }

    // Reset state
    setGameState({
      isMultiplayerGame: false,
      isHost: false,
      multiplayerSessionId: null,
      lobbyPhase: null,
      connectedPlayers: [],
      ablyChannelRef: null,
      username: '',
      intendedGameMode: 'PvP',
      selectedMapId: 'default',
    });
  }, [gameState.ablyChannelRef]);

  /**
   * Host starts the game from lobby
   */
  const hostStartGame = useCallback(() => {
    setGameState(prev => {
      if (!prev.isHost || !prev.ablyChannelRef) {
        console.warn('Only host can start the game');
        return prev;
      }

      // Broadcast game start
      safeChannelPublish(prev.ablyChannelRef, 'gameStart', {
        players: prev.connectedPlayers,
        startTime: Date.now(),
        gameMode: 'PvP',
        mapId: prev.selectedMapId,
      });

      // Update local state - exit lobby
      return {
        ...prev,
        lobbyPhase: null,
      };
    });
  }, []);

  /**
   * Select a map (host only)
   */
  const selectMap = useCallback((mapId: string) => {
    setGameState(prev => {
      if (!prev.isHost) {
        console.warn('Only host can select maps');
        return prev;
      }

      // Broadcast map selection
      if (prev.ablyChannelRef) {
        safeChannelPublish(prev.ablyChannelRef, 'mapSelected', { mapId });
      }

      return { ...prev, selectedMapId: mapId };
    });
  }, []);

  const value: GameContextType = {
    gameState,
    setGameState,
    createMultiplayerLobby,
    joinMultiplayerLobby,
    leaveLobby,
    hostStartGame,
    selectMap,
  };

  return (
    <GameContext.Provider value={value}>
      {children}
    </GameContext.Provider>
  );
}
```

---

### Step 5: Player Sync Implementation

**Sending Player Data (in your game loop/render function):**

```typescript
import { safeChannelPublish } from './utils/ablyHelpers';
import { SYNC_CONSTANTS } from './types/Multiplayer';

// In your game component
const lastSyncTime = useRef(0);
const localPlayerId = useRef<string | null>(null);

// Initialize local player ID
useEffect(() => {
  if (ably) {
    localPlayerId.current = ably.auth.clientId;
  }
}, [ably]);

// Sync function (call this in your game loop)
const syncPlayerToNetwork = () => {
  const mpState = gameContext.gameState;
  if (!mpState.isMultiplayerGame || !mpState.ablyChannelRef) return;
  
  const now = Date.now();
  const timeSinceLastSync = now - lastSyncTime.current;
  
  // Rate limit: 50ms minimum (20 Hz max)
  if (timeSinceLastSync < SYNC_CONSTANTS.PLAYER_SYNC_RATE) return;
  
  const syncData = {
    id: localPlayerId.current,
    x: player.position.x,
    y: player.position.y,
    vx: player.velocity.x,
    vy: player.velocity.y,
    health: player.health,
    maxHealth: player.maxHealth,
    animKey: player.currentAnimation,
    animFrame: player.currentFrame,
    facingRight: player.facingRight,
    inputs: {
      punch: player.isPunching,
      // Add other inputs as needed
    },
    timestamp: now
  };
  
  safeChannelPublish(mpState.ablyChannelRef, 'playerSync', syncData);
  lastSyncTime.current = now;
};
```

**Receiving Player Data:**

```typescript
import { safeChannelSubscribe } from './utils/ablyHelpers';
import type { RemotePlayer } from './types/Multiplayer';

// State to track remote players
const [remotePlayers, setRemotePlayers] = useState<Map<string, RemotePlayer>>(new Map());

// Subscribe to player sync messages
useEffect(() => {
  const channel = gameContext.gameState.ablyChannelRef;
  if (!channel || !gameContext.gameState.isMultiplayerGame) return;

  const handlePlayerSync = (message: any) => {
    const { id, x, y, vx, vy, health, maxHealth, animKey, animFrame, facingRight, timestamp } = message.data;
    
    // Ignore own sync messages
    if (id === localPlayerId.current) return;
    
    setRemotePlayers(prev => {
      const updated = new Map(prev);
      const existing = updated.get(id);
      
      // Reject out-of-order packets
      if (existing?.lastUpdate && timestamp < existing.lastUpdate) {
        return prev;
      }
      
      // Resolve username from lobby data
      const playerInfo = gameContext.gameState.connectedPlayers.find(p => p.clientId === id);
      const username = playerInfo?.username || 'Unknown';
      
      // Interpolation buffer for smooth movement
      const interpolationBuffer = existing?.interpolationBuffer || [];
      interpolationBuffer.push({
        position: { x, y },
        timestamp
      });
      if (interpolationBuffer.length > 3) {
        interpolationBuffer.shift();
      }
      
      updated.set(id, {
        id,
        username,
        position: { x, y },
        velocity: { x: vx || 0, y: vy || 0 },
        health,
        maxHealth,
        animKey,
        animFrame,
        facingRight,
        lastUpdate: timestamp,
        inputs: message.data.inputs || {},
        interpolationBuffer,
        renderPosition: existing?.renderPosition || { x, y },
      });
      
      return updated;
    });
  };

  const cleanup = safeChannelSubscribe(channel, 'playerSync', handlePlayerSync);
  
  return () => {
    if (cleanup) cleanup();
  };
}, [gameContext.gameState.ablyChannelRef, gameContext.gameState.isMultiplayerGame]);
```

**Interpolation for Smooth Movement:**

```typescript
// In your render loop, interpolate remote player positions
const interpolateRemotePlayers = () => {
  const now = Date.now();
  
  setRemotePlayers(prev => {
    const updated = new Map(prev);
    
    updated.forEach((player, id) => {
      const buffer = player.interpolationBuffer;
      if (buffer.length < 2) {
        // Not enough data, use current position
        player.renderPosition = { ...player.position };
        return;
      }
      
      // Interpolate between last two positions
      const renderTime = now - 100; // 100ms behind for smooth interpolation
      const from = buffer[buffer.length - 2];
      const to = buffer[buffer.length - 1];
      
      if (renderTime <= from.timestamp) {
        player.renderPosition = { ...from.position };
      } else if (renderTime >= to.timestamp) {
        player.renderPosition = { ...to.position };
      } else {
        // Linear interpolation
        const t = (renderTime - from.timestamp) / (to.timestamp - from.timestamp);
        player.renderPosition = {
          x: from.position.x + (to.position.x - from.position.x) * t,
          y: from.position.y + (to.position.y - from.position.y) * t,
        };
      }
    });
    
    return updated;
  });
};

// Call in your game loop
useEffect(() => {
  const intervalId = setInterval(interpolateRemotePlayers, 16); // ~60fps
  return () => clearInterval(intervalId);
}, []);
```

---

### Step 6: Voice Chat Implementation

Create `hooks/useLobbyVoice.ts`:

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import SimplePeer from 'simple-peer';
import type * as Ably from 'ably';
import { safeChannelPublish, safeChannelSubscribe } from '../utils/ablyHelpers';

interface VoicePeer {
  peer: SimplePeer.Instance;
  stream: MediaStream | null;
}

interface UseLobbyVoiceOptions {
  channel: Ably.RealtimeChannel | null;
  connectedPlayers: Array<{ clientId: string; username: string }>;
  localClientId: string | null;
  enabled: boolean;
}

export function useLobbyVoice(options: UseLobbyVoiceOptions) {
  const { channel, connectedPlayers, localClientId, enabled } = options;
  
  const [isActive, setIsActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, VoicePeer>>(new Map());
  const isCleaningUpRef = useRef(false);
  const signalSubscriptionRef = useRef<any>(null);

  const createPeerConnection = useCallback((remoteClientId: string, initialSignal?: any) => {
    if (!localClientId || !localStreamRef.current || isCleaningUpRef.current) {
      return;
    }

    // Avoid duplicate peers
    if (peersRef.current.has(remoteClientId)) {
      return;
    }

    console.log(`[Voice] Creating peer connection to ${remoteClientId}`);

    // Determine who initiates (lower clientId alphabetically to avoid duplicate connections)
    const shouldInitiate = localClientId < remoteClientId;

    try {
      const peer = new SimplePeer({
        initiator: shouldInitiate,
        stream: localStreamRef.current,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
          ]
        }
      });

      peersRef.current.set(remoteClientId, { peer, stream: null });

      // Handle signaling via Ably
      peer.on('signal', (signal: any) => {
        console.log(`[Voice] Sending signal to ${remoteClientId}`);
        safeChannelPublish(channel, 'voiceSignal', {
          from: localClientId,
          to: remoteClientId,
          signal
        });
      });

      // Handle incoming stream
      peer.on('stream', (stream: MediaStream) => {
        console.log(`[Voice] Received stream from ${remoteClientId}`);
        const peerData = peersRef.current.get(remoteClientId);
        if (peerData) {
          peerData.stream = stream;
          setRemoteStreams(prev => {
            const next = new Map(prev);
            next.set(remoteClientId, stream);
            return next;
          });
        }
      });

      // Handle connection events
      peer.on('connect', () => {
        console.log(`[Voice] Connected to ${remoteClientId}`);
      });

      peer.on('close', () => {
        console.log(`[Voice] Connection closed with ${remoteClientId}`);
        peersRef.current.delete(remoteClientId);
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.delete(remoteClientId);
          return next;
        });
      });

      peer.on('error', (err: Error) => {
        console.error(`[Voice] Peer error with ${remoteClientId}:`, err);
        peersRef.current.delete(remoteClientId);
      });

      // If we received an initial signal, process it
      if (initialSignal) {
        peer.signal(initialSignal);
      }

    } catch (error) {
      console.error(`[Voice] Failed to create peer for ${remoteClientId}:`, error);
    }
  }, [localClientId, channel]);

  const handleIncomingSignal = useCallback((message: any) => {
    const { from, to, signal } = message.data;

    // Only process signals meant for us
    if (to !== localClientId) {
      return;
    }

    console.log(`[Voice] Received signal from ${from}`);

    const peerData = peersRef.current.get(from);
    if (peerData) {
      // Peer exists, signal it
      try {
        peerData.peer.signal(signal);
      } catch (error) {
        console.error(`[Voice] Error signaling peer ${from}:`, error);
      }
    } else {
      // Peer doesn't exist, create it with the initial signal
      createPeerConnection(from, signal);
    }
  }, [localClientId, createPeerConnection]);

  const startVoice = useCallback(async () => {
    if (!channel || !localClientId || isActive) {
      return;
    }

    console.log('[Voice] Starting voice chat...');

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });

      localStreamRef.current = stream;
      setIsActive(true);
      setMicError(null);

      console.log('[Voice] Microphone acquired');

      // Subscribe to voice signals
      const unsubscribe = safeChannelSubscribe(channel, 'voiceSignal', handleIncomingSignal);
      signalSubscriptionRef.current = unsubscribe;

      // Create peer connections to all existing players
      const otherPlayers = connectedPlayers.filter(p => p.clientId !== localClientId);
      console.log(`[Voice] Creating connections to ${otherPlayers.length} players`);
      
      for (const player of otherPlayers) {
        createPeerConnection(player.clientId);
      }

    } catch (error: any) {
      console.error('[Voice] Failed to start voice:', error);
      setMicError(error.message || 'Could not access microphone');
      setIsActive(false);
    }
  }, [channel, localClientId, isActive, connectedPlayers, handleIncomingSignal, createPeerConnection]);

  const stopVoice = useCallback(() => {
    console.log('[Voice] Stopping voice chat...');
    isCleaningUpRef.current = true;

    // Destroy all peers
    peersRef.current.forEach((peerData, clientId) => {
      try {
        peerData.peer.destroy();
      } catch (error) {
        console.error(`[Voice] Error destroying peer ${clientId}:`, error);
      }
    });
    peersRef.current.clear();

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Unsubscribe from signals
    if (signalSubscriptionRef.current) {
      try {
        signalSubscriptionRef.current();
      } catch (error) {
        console.error('[Voice] Error unsubscribing:', error);
      }
      signalSubscriptionRef.current = null;
    }

    setRemoteStreams(new Map());
    setIsActive(false);
    isCleaningUpRef.current = false;
  }, []);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      const newMutedState = !isMuted;
      
      audioTracks.forEach(track => {
        track.enabled = !newMutedState;
      });

      setIsMuted(newMutedState);
      console.log(`[Voice] Muted: ${newMutedState}`);
    }
  }, [isMuted]);

  // Sync peer connections with connected players
  useEffect(() => {
    if (!isActive || !localClientId || isCleaningUpRef.current) {
      return;
    }

    const currentPlayerIds = new Set(connectedPlayers.map(p => p.clientId));
    const currentPeerIds = new Set(peersRef.current.keys());

    // Remove peers for disconnected players
    currentPeerIds.forEach(peerId => {
      if (!currentPlayerIds.has(peerId)) {
        const peerData = peersRef.current.get(peerId);
        if (peerData) {
          try {
            peerData.peer.destroy();
          } catch (error) {
            console.error(`[Voice] Error destroying peer ${peerId}:`, error);
          }
          peersRef.current.delete(peerId);
          setRemoteStreams(prev => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
        }
      }
    });

    // Add peers for new players
    currentPlayerIds.forEach(playerId => {
      if (playerId !== localClientId && !currentPeerIds.has(playerId)) {
        createPeerConnection(playerId);
      }
    });
  }, [isActive, localClientId, connectedPlayers, createPeerConnection]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isActive) {
        stopVoice();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isActive,
    isMuted,
    micError,
    remoteStreams,
    startVoice,
    stopVoice,
    toggleMute,
  };
}
```

**Using the Voice Chat Hook:**

```typescript
// In your lobby/game component
const voiceChat = useLobbyVoice({
  channel: gameContext.gameState.ablyChannelRef,
  connectedPlayers: gameContext.gameState.connectedPlayers,
  localClientId: ably?.auth.clientId || null,
  enabled: true,
});

// UI buttons
<button onClick={voiceChat.startVoice}>Start Voice</button>
<button onClick={voiceChat.stopVoice}>Stop Voice</button>
<button onClick={voiceChat.toggleMute}>
  {voiceChat.isMuted ? 'Unmute' : 'Mute'}
</button>

// Play remote audio streams
useEffect(() => {
  voiceChat.remoteStreams.forEach((stream, clientId) => {
    const audio = new Audio();
    audio.srcObject = stream;
    audio.play();
  });
}, [voiceChat.remoteStreams]);
```

---

### Step 7: Audio System Integration

**Loading and Playing Audio:**

```typescript
// Initialize Web Audio API
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function initAudio() {
  if (audioCtx) return;
  
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  
  audioCtx = new AC();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.5; // Master volume
  masterGain.connect(audioCtx.destination);
}

// Load audio file
async function loadAudioFile(url: string): Promise<AudioBuffer | null> {
  if (!audioCtx) return null;
  
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    return audioBuffer;
  } catch (error) {
    console.error('Failed to load audio:', error);
    return null;
  }
}

// Play audio
function playSound(audioBuffer: AudioBuffer) {
  if (!audioCtx || !masterGain) return;
  
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(masterGain);
  source.start();
}

// Example: Load sounds on mount
useEffect(() => {
  initAudio();
  
  loadAudioFile('/sounds/punch.mp3').then(buffer => {
    if (buffer) soundBuffers.punch = buffer;
  });
  
  loadAudioFile('/sounds/jump.mp3').then(buffer => {
    if (buffer) soundBuffers.jump = buffer;
  });
}, []);

// Play on action
function handlePunch() {
  if (soundBuffers.punch) {
    playSound(soundBuffers.punch);
  }
}
```

---

### Step 8: Rendering Remote Players

**In your game render loop:**

```typescript
function drawRemotePlayers(ctx: CanvasRenderingContext2D) {
  remotePlayers.forEach((remotePlayer) => {
    const { renderPosition, animKey, animFrame, facingRight, username } = remotePlayer;
    
    // Draw player sprite
    const sprite = sprites[animKey]; // Your sprite system
    if (sprite) {
      ctx.save();
      ctx.translate(renderPosition.x, renderPosition.y);
      ctx.scale(facingRight ? 1 : -1, 1);
      
      // Draw the sprite frame
      const frame = sprite.frames[Math.floor(animFrame)];
      ctx.drawImage(frame, -sprite.width / 2, -sprite.height / 2);
      
      ctx.restore();
    }
    
    // Draw username above player
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(username, renderPosition.x, renderPosition.y - 60);
    
    // Draw health bar
    const healthBarWidth = 50;
    const healthPercent = remotePlayer.health / remotePlayer.maxHealth;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(
      renderPosition.x - healthBarWidth / 2,
      renderPosition.y - 50,
      healthBarWidth,
      5
    );
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(
      renderPosition.x - healthBarWidth / 2,
      renderPosition.y - 50,
      healthBarWidth * healthPercent,
      5
    );
  });
}
```

---

## Code Examples

### Complete Game Loop Integration

```typescript
export default function GameComponent() {
  const gameContext = useGameContext();
  const ably = useAbly();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [remotePlayers, setRemotePlayers] = useState<Map<string, RemotePlayer>>(new Map());
  const lastSyncTime = useRef(0);
  const localPlayerId = useRef<string | null>(null);

  // Initialize
  useEffect(() => {
    if (ably) {
      localPlayerId.current = ably.auth.clientId;
    }
  }, [ably]);

  // Subscribe to game start
  useEffect(() => {
    const channel = gameContext.gameState.ablyChannelRef;
    if (!channel) return;

    const cleanup = safeChannelSubscribe(channel, 'gameStart', (message) => {
      const { players, startTime, mapId } = message.data;
      console.log('Game started!', players);
      // Start your game here
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, [gameContext.gameState.ablyChannelRef]);

  // Subscribe to player sync
  useEffect(() => {
    const channel = gameContext.gameState.ablyChannelRef;
    if (!channel || !gameContext.gameState.isMultiplayerGame) return;

    const handlePlayerSync = (message: any) => {
      const { id, x, y, health, animKey, animFrame, facingRight, timestamp } = message.data;
      
      if (id === localPlayerId.current) return;
      
      setRemotePlayers(prev => {
        const updated = new Map(prev);
        const existing = updated.get(id);
        
        if (existing?.lastUpdate && timestamp < existing.lastUpdate) {
          return prev;
        }
        
        const playerInfo = gameContext.gameState.connectedPlayers.find(p => p.clientId === id);
        const username = playerInfo?.username || 'Unknown';
        
        const interpolationBuffer = existing?.interpolationBuffer || [];
        interpolationBuffer.push({ position: { x, y }, timestamp });
        if (interpolationBuffer.length > 3) interpolationBuffer.shift();
        
        updated.set(id, {
          id,
          username,
          position: { x, y },
          velocity: { x: 0, y: 0 },
          health,
          maxHealth: message.data.maxHealth,
          animKey,
          animFrame,
          facingRight,
          lastUpdate: timestamp,
          inputs: {},
          interpolationBuffer,
          renderPosition: existing?.renderPosition || { x, y },
        });
        
        return updated;
      });
    };

    const cleanup = safeChannelSubscribe(channel, 'playerSync', handlePlayerSync);
    return () => { if (cleanup) cleanup(); };
  }, [gameContext.gameState.ablyChannelRef, gameContext.gameState.isMultiplayerGame]);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    
    const gameLoop = () => {
      // Update game state
      updatePlayer();
      
      // Sync to network
      if (gameContext.gameState.isMultiplayerGame) {
        syncPlayerToNetwork();
      }
      
      // Interpolate remote players
      interpolateRemotePlayers();
      
      // Render
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawLocalPlayer(ctx);
      drawRemotePlayers(ctx);
      
      animationId = requestAnimationFrame(gameLoop);
    };
    
    gameLoop();
    
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [gameContext.gameState.isMultiplayerGame]);

  // Sync function
  const syncPlayerToNetwork = () => {
    const mpState = gameContext.gameState;
    if (!mpState.isMultiplayerGame || !mpState.ablyChannelRef) return;
    
    const now = Date.now();
    if (now - lastSyncTime.current < 50) return;
    
    const syncData = {
      id: localPlayerId.current,
      x: player.x,
      y: player.y,
      health: player.health,
      maxHealth: player.maxHealth,
      animKey: player.currentAnimation,
      animFrame: player.currentFrame,
      facingRight: player.facingRight,
      timestamp: now
    };
    
    safeChannelPublish(mpState.ablyChannelRef, 'playerSync', syncData);
    lastSyncTime.current = now;
  };

  return (
    <div>
      <canvas ref={canvasRef} width={800} height={600} />
      {/* Your UI here */}
    </div>
  );
}
```

---

## Testing & Troubleshooting

### Testing Locally

**1. Open Multiple Browser Windows:**
- Open your game in 2+ browser tabs/windows
- Create a lobby in one tab (host)
- Copy the session ID
- Join the lobby in other tabs

**2. Check Browser Console:**
- Look for Ably connection messages: `✅ Ably connected: player-xxxxx`
- Verify player sync messages are being sent/received
- Check for any errors

**3. Test Voice Chat:**
- Start voice in lobby
- Check microphone permissions in browser
- Verify remote audio plays (check browser audio indicators)

### Common Issues

**Issue: "Ably client not available"**
- Solution: Ensure `AblyContextProvider` wraps your app
- Verify `.env.local` has `NEXT_PUBLIC_ABLY_API_KEY`
- Restart dev server after adding environment variables

**Issue: Players not seeing each other**
- Check both players are on the same session ID
- Verify Ably connection state: `ably.connection.state` should be `'connected'`
- Check browser console for sync messages
- Ensure `echoMessages: false` in Ably config

**Issue: Voice chat not working**
- Check microphone permissions in browser
- Verify WebRTC is supported (modern browser required)
- Check console for peer connection errors
- Try using HTTPS (required for getUserMedia in production)

**Issue: Laggy/jittery movement**
- Reduce sync rate if network is slow
- Increase interpolation buffer size (e.g., 5 positions instead of 3)
- Check network latency

**Issue: Session ID not copying**
- Ensure Clipboard API is available (HTTPS required in production)
- Fallback: manually type session ID

### Network Debugging

```typescript
// Add to your component to log network stats
useEffect(() => {
  const interval = setInterval(() => {
    if (ably) {
      console.log('Ably state:', ably.connection.state);
      console.log('Remote players:', remotePlayers.size);
    }
  }, 5000);
  
  return () => clearInterval(interval);
}, [ably, remotePlayers]);
```

### Ably Dashboard Monitoring

1. Go to [https://ably.com/accounts](https://ably.com/accounts)
2. Select your app
3. Go to "Live Stats" to see:
   - Active connections
   - Messages per second
   - Presence events

---

## Advanced Features

### Implement Combat Sync

```typescript
// Send attack event
const sendAttack = (attackType: string) => {
  if (!gameContext.gameState.ablyChannelRef) return;
  
  safeChannelPublish(gameContext.gameState.ablyChannelRef, 'playerAttack', {
    playerId: localPlayerId.current,
    attackType,
    position: { x: player.x, y: player.y },
    facingRight: player.facingRight,
    timestamp: Date.now(),
  });
};

// Receive attack events
safeChannelSubscribe(channel, 'playerAttack', (message) => {
  const { playerId, attackType, position, facingRight } = message.data;
  
  // Spawn attack visual effect at position
  spawnAttackEffect(attackType, position, facingRight);
  
  // Check if local player is hit
  if (isPlayerHit(player, position, attackType)) {
    applyDamage(calculateDamage(attackType));
  }
});
```

### Implement Host Authority

```typescript
// Host calculates hit detection
if (gameContext.gameState.isHost) {
  if (detectCollision(attack, remotePlayer)) {
    const damage = calculateDamage(attack.type);
    
    // Broadcast hit event
    safeChannelPublish(channel, 'playerHit', {
      victimId: remotePlayer.id,
      attackerId: localPlayerId.current,
      damage,
      timestamp: Date.now(),
    });
  }
}

// Clients apply damage from host
safeChannelSubscribe(channel, 'playerHit', (message) => {
  const { victimId, damage } = message.data;
  
  if (victimId === localPlayerId.current) {
    player.health -= damage;
  } else {
    // Update remote player health
    setRemotePlayers(prev => {
      const updated = new Map(prev);
      const victim = updated.get(victimId);
      if (victim) {
        victim.health -= damage;
      }
      return updated;
    });
  }
});
```

---

## Performance Optimization

### Reduce Network Bandwidth

```typescript
// Only sync when position/state changes significantly
const shouldSync = () => {
  const threshold = 0.5; // pixels
  const lastPos = lastSyncedPosition.current;
  
  return (
    Math.abs(player.x - lastPos.x) > threshold ||
    Math.abs(player.y - lastPos.y) > threshold ||
    player.currentAnimation !== lastSyncedAnimation.current
  );
};

if (shouldSync()) {
  syncPlayerToNetwork();
  lastSyncedPosition.current = { x: player.x, y: player.y };
  lastSyncedAnimation.current = player.currentAnimation;
}
```

### Delta Compression

```typescript
// Only send changed fields
const lastSyncData = useRef({});

const syncData = {
  id: localPlayerId.current,
  timestamp: Date.now(),
};

// Add only changed fields
if (player.x !== lastSyncData.current.x) syncData.x = player.x;
if (player.y !== lastSyncData.current.y) syncData.y = player.y;
if (player.health !== lastSyncData.current.health) syncData.health = player.health;

safeChannelPublish(channel, 'playerSync', syncData);
lastSyncData.current = { x: player.x, y: player.y, health: player.health };
```

---

## Summary

You now have a complete multiplayer system with:

✅ **Ably Integration** - Real-time messaging and presence
✅ **Lobby System** - Create/join lobbies with session IDs
✅ **Player Sync** - 20Hz position/state synchronization with interpolation
✅ **Voice Chat** - WebRTC peer-to-peer audio via Ably signaling
✅ **Audio System** - Web Audio API integration
✅ **TypeScript Types** - Full type safety
✅ **Safe Helpers** - Error-resilient channel operations

**Key Files to Implement:**
1. `context/AblyContext.tsx` - Ably client initialization
2. `context/GameContext.tsx` - Multiplayer state management
3. `utils/ablyHelpers.ts` - Safe channel operations
4. `types/Multiplayer.ts` - Type definitions
5. `hooks/useLobbyVoice.ts` - Voice chat hook
6. Your game loop with sync integration

**Next Steps:**
1. Copy the code into your project
2. Add Ably API key to `.env.local`
3. Wrap your app with `<AblyContextProvider>` and `<GameProvider>`
4. Integrate player sync in your game loop
5. Add lobby UI components
6. Test with multiple browser windows

**Resources:**
- [Ably Documentation](https://ably.com/docs)
- [SimplePeer Documentation](https://github.com/feross/simple-peer)
- [WebRTC Guide](https://webrtc.org/getting-started/overview)

---

**Happy coding! 🎮**

