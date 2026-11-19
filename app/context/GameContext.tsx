"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { RealtimeRoom, RoomMember } from '../utils/roomClient';
import { useRoomClient } from './RoomContext';
import { safeChannelPublish, safeChannelSubscribe, cleanupChannelSubscriptions } from '../utils/roomHelpers';
import type { ConnectedPlayer, MultiplayerState } from '../types/Multiplayer';
import { getDefaultMap } from '../types/Maps';

interface GameContextType {
  gameState: MultiplayerState;
  setGameState: React.Dispatch<React.SetStateAction<MultiplayerState>>;
  createMultiplayerLobby: (username: string) => Promise<string | null>;
  joinMultiplayerLobby: (sessionId: string, username: string) => Promise<boolean>;
  leaveLobby: () => Promise<void>;
  hostStartGame: () => void;
  hostEndGame: () => void;
  selectMap: (mapId: string) => void;
  startMapSelection: (botCount: number) => void;
  confirmMapSelection: () => void;
  toggleReady: () => void;
}

const GameContext = createContext<GameContextType | null>(null);

const debugLog = (...args: unknown[]) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage.getItem('platformerDebugLogs') === '1') {
      console.log(...args);
    }
  } catch {
    // Ignore storage access failures; debug logs are optional.
  }
};

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

function initialLobby(): MultiplayerState {
  return {
    isMultiplayerGame: false,
    isHost: false,
    multiplayerSessionId: null,
    lobbyPhase: null,
    connectedPlayers: [],
    roomChannel: null,
    username: '',
    intendedGameMode: 'Infinite',
    selectedMapId: getDefaultMap().id,
  };
}

export function GameProvider({ children }: GameProviderProps) {
  const roomClient = useRoomClient();

  const [gameState, setGameState] = useState<MultiplayerState>(initialLobby);

  const subscribeToRoomClose = useCallback((channel: RealtimeRoom) => {
    channel.subscribe('roomClosed', () => {
      setGameState(prev => prev.roomChannel === channel ? initialLobby() : prev);
    });
  }, []);

  const getChannel = useCallback((sessionId: string): RealtimeRoom | null => {
    if (!roomClient) {
      console.warn('room transport client not initialized');
      return null;
    }
    if (!/^pvp-[a-z0-9]{9}$/.test(sessionId)) return null;
    return roomClient.channels.get(sessionId);
  }, [roomClient]);

  /**
   * Create a new multiplayer lobby (Host)
   */
  const createMultiplayerLobby = useCallback(async (username: string): Promise<string | null> => {
    if (!roomClient) {
      console.error('room transport client not available');
      return null;
    }

    try {

      // Generate unique session ID
      const sessionId = `pvp-${crypto.randomUUID().replace(/-/g, '').slice(0, 9)}`;
      const channel = getChannel(sessionId);
      
      if (!channel) {
        console.error('Failed to get channel');
        return null;
      }

      const clientId = roomClient.auth.clientId || 'host';
      await channel.presence.enter({ username });
      subscribeToRoomClose(channel);

      // Update state first - start in waiting phase before map selection
      setGameState(prev => ({
        ...prev,
        isHost: true,
        multiplayerSessionId: sessionId,
        lobbyPhase: 'waiting',
        isMultiplayerGame: true,
        connectedPlayers: [{ clientId, username, isReady: false }],
        roomChannel: channel,
        username,
        intendedGameMode: 'PvP',
      }));

      // Subscribe to presence events
      channel.presence.subscribe('enter', (member: RoomMember) => {
        if (member.clientId !== clientId) {
          debugLog('Player joined:', member.clientId, member.data);
          const newPlayer: ConnectedPlayer = {
            clientId: member.clientId,
            username: (member.data as any)?.username || 'Unknown',
            isReady: false,
          };

          setGameState(prev => {
            // Check if player already in list
            if (prev.connectedPlayers.some(p => p.clientId === member.clientId)) {
              return prev;
            }

            const updatedPlayers = [...prev.connectedPlayers, newPlayer];

            // Broadcast updated player list with current lobby state
            safeChannelPublish(channel, 'playerJoined', {
              players: updatedPlayers,
              intendedGameMode: 'PvP',
              lobbyPhase: prev.lobbyPhase,
              selectedMapId: prev.selectedMapId,
            });

            return { ...prev, connectedPlayers: updatedPlayers };
          });
        }
      });

      channel.presence.subscribe('leave', (member: RoomMember) => {
        if (member.clientId !== clientId) {
          debugLog('Player left:', member.clientId);
          setGameState(prev => ({
            ...prev,
            connectedPlayers: prev.connectedPlayers.filter(
              p => p.clientId !== member.clientId
            ),
          }));
        }
      });

      // Subscribe to map selection changes (host needs to receive their own events for consistency)
      safeChannelSubscribe(channel, 'mapSelected', (message: any) => {
        if (message.data?.mapId) {
          setGameState(prev => ({
            ...prev,
            selectedMapId: message.data.mapId,
          }));
        }
      });

      // Subscribe to phase changes (host receives confirmation of their own phase changes)
      safeChannelSubscribe(channel, 'phaseChange', (message: any) => {
        if (message.data?.phase) {
          setGameState(prev => ({
            ...prev,
            lobbyPhase: message.data.phase,
            connectedPlayers: Array.isArray(message.data.players)
              ? message.data.players
              : prev.connectedPlayers,
            selectedMapId: message.data.selectedMapId || prev.selectedMapId,
          }));
        }
      });

      // Subscribe to player ready state changes
      safeChannelSubscribe(channel, 'playerReady', (message: any) => {
        if (message.data?.clientId !== undefined) {
          debugLog('Host received ready state change:', message.data.clientId, message.data.isReady);
          setGameState(prev => ({
            ...prev,
            connectedPlayers: prev.connectedPlayers.map(p =>
              p.clientId === message.data.clientId
                ? { ...p, isReady: message.data.isReady }
                : p
            ),
          }));
        }
      });

      debugLog('Lobby created:', sessionId);
      return sessionId;
    } catch (error) {
      console.error('Failed to create lobby:', error);
      return null;
    }
  }, [roomClient, getChannel, subscribeToRoomClose]);

  /**
   * Join an existing multiplayer lobby (Client)
   */
  const joinMultiplayerLobby = useCallback(async (sessionId: string, username: string): Promise<boolean> => {
    if (!roomClient) {
      console.error('room transport client not available');
      return false;
    }

    try {
      const previousChannel = gameState.roomChannel;
      if (previousChannel?.name === sessionId) return true;
      const channel = getChannel(sessionId);
      
      if (!channel) {
        console.error('Failed to get channel');
        return false;
      }


      // Check if lobby exists (verify presence)
      const members = await channel.presence.get();
      if (members.length === 0) {
        console.warn('No host found in lobby');
        return false;
      }

      const clientId = roomClient.auth.clientId || `player-${Math.random().toString(36).substr(2, 6)}`;

      // Build initial player list from presence
      const initialPlayers: ConnectedPlayer[] = members.map(m => ({
        clientId: m.clientId,
        username: (m.data as any)?.username || 'Unknown',
        isReady: false,
      }));

      // Add self if not already in list
      if (!initialPlayers.some(p => p.clientId === clientId)) {
        initialPlayers.push({ clientId, username, isReady: false });
      }

      // Update state - will receive phase from host
      setGameState(prev => ({
        ...prev,
        isHost: false,
        multiplayerSessionId: sessionId,
        lobbyPhase: 'waiting',
        isMultiplayerGame: true,
        connectedPlayers: initialPlayers,
        roomChannel: channel,
        username,
        intendedGameMode: 'PvP',
      }));

      // Subscribe to player joined events
      safeChannelSubscribe(channel, 'playerJoined', (message: any) => {
        if (message.data?.players) {
          setGameState(prev => ({
            ...prev,
            connectedPlayers: message.data.players,
            lobbyPhase: message.data.lobbyPhase || prev.lobbyPhase,
            selectedMapId: message.data.selectedMapId || prev.selectedMapId,
          }));
        }
      });

      // Subscribe to map selection changes
      safeChannelSubscribe(channel, 'mapSelected', (message: any) => {
        if (message.data?.mapId) {
          debugLog('Map selected:', message.data.mapId);
          setGameState(prev => ({
            ...prev,
            selectedMapId: message.data.mapId,
          }));
        }
      });

      // Subscribe to phase changes
      safeChannelSubscribe(channel, 'phaseChange', (message: any) => {
        if (message.data?.phase) {
          debugLog('Client received phase change:', message.data.phase, 'Map:', message.data.selectedMapId);
          
          // Show notification if host ended the match
          if (message.data.reason === 'host-ended-match' && message.data.phase === 'map-selection') {
            debugLog('Host ended the match - returning to map selection');
          }
          
          setGameState(prev => ({
            ...prev,
            lobbyPhase: message.data.phase,
            connectedPlayers: Array.isArray(message.data.players)
              ? message.data.players
              : prev.connectedPlayers,
            selectedMapId: message.data.selectedMapId || prev.selectedMapId,
          }));
        }
      });

      // Subscribe to player ready state changes
      safeChannelSubscribe(channel, 'playerReady', (message: any) => {
        if (message.data?.clientId !== undefined) {
          debugLog('Client received ready state change:', message.data.clientId, message.data.isReady);
          setGameState(prev => ({
            ...prev,
            connectedPlayers: prev.connectedPlayers.map(p =>
              p.clientId === message.data.clientId
                ? { ...p, isReady: message.data.isReady }
                : p
            ),
          }));
        }
      });

      // Subscribe to presence leave
      channel.presence.subscribe('leave', (member: RoomMember) => {
        debugLog('Player left:', member.clientId);
        
        setGameState(prev => {
          const updated = prev.connectedPlayers.filter(
            p => p.clientId !== member.clientId
          );
          
          return { ...prev, connectedPlayers: updated };
        });
      });

      try {
        await channel.presence.enter({ username });
        subscribeToRoomClose(channel);
        if (previousChannel) void previousChannel.presence.leave().catch(() => undefined);
      } catch (error) {
        channel.unsubscribe();
        channel.presence.unsubscribe();
        await channel.detach().catch(() => undefined);
        setGameState(prev => ({
          ...prev,
          isMultiplayerGame: false,
          multiplayerSessionId: null,
          lobbyPhase: null,
          connectedPlayers: [],
          roomChannel: null,
          username: '',
          intendedGameMode: 'Infinite',
          selectedMapId: getDefaultMap().id,
        }));
        throw error;
      }

      debugLog('Joined lobby:', sessionId);
      return true;
    } catch (error) {
      console.error('Failed to join lobby:', error);
      return false;
    }
  }, [roomClient, getChannel, gameState.roomChannel, subscribeToRoomClose]);

  /**
   * Leave the current lobby
   */
  const leaveLobby = useCallback(async () => {
    const channel = gameState.roomChannel;
    
    if (channel) {
      try {
        // Leave presence
        await channel.presence.leave();
        
        // Cleanup subscriptions
        cleanupChannelSubscriptions(channel, ['playerJoined', 'gameStart', 'playerSync', 'playerAttack', 'playerHit', 'mapSelected', 'phaseChange', 'playerReady']);
        channel.presence.unsubscribe();
        
        // Detach channel
        await channel.detach();
      } catch (error) {
        console.warn('Error leaving lobby:', error);
      }
    }

    setGameState(initialLobby());
  }, [gameState.roomChannel]);

  /**
   * Host starts the game from lobby
   */
  const hostStartGame = useCallback(() => {
    setGameState(prev => {
      if (!prev.isHost || !prev.roomChannel) {
        console.warn('Only host can start the game');
        return prev;
      }

      // Broadcast game start with selected map
      safeChannelPublish(prev.roomChannel, 'gameStart', {
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
   * Host ends the game and returns to map selection
   * This properly exits the game for all players and brings them back to lobby
   */
  const hostEndGame = useCallback(() => {
    setGameState(prev => {
      if (!prev.isHost) {
        console.warn('Only host can end the game');
        return prev;
      }

      debugLog('Host ending match - returning all players to map selection');
      
      // Reset all player ready states for fresh map selection
      const resetPlayers = prev.connectedPlayers.map(p => ({ ...p, isReady: false }));

      // Broadcast phase change to ALL players (including host via their own subscription)
      if (prev.roomChannel) {
        safeChannelPublish(prev.roomChannel, 'phaseChange', {
          phase: 'map-selection',
          players: resetPlayers,
          selectedMapId: prev.selectedMapId,
          reason: 'host-ended-match', // For client notification
        });
      }

      return {
        ...prev,
        lobbyPhase: 'map-selection',
        connectedPlayers: resetPlayers,
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

      debugLog('Host selecting map:', mapId);

      // Broadcast map selection to all clients
      if (prev.roomChannel) {
        safeChannelPublish(prev.roomChannel, 'mapSelected', {
          mapId,
        });
      }

      return {
        ...prev,
        selectedMapId: mapId,
      };
    });
  }, []);

  /**
   * Start map selection phase (host only)
   */
  const startMapSelection = useCallback((botCount: number) => {
    setGameState(prev => {
      if (!prev.isHost) {
        console.warn('Only host can start map selection');
        return prev;
      }

      if (prev.connectedPlayers.length + botCount < 2) {
        console.warn('Need at least 2 players in the lobby');
        return prev;
      }

      const resetPlayers = prev.connectedPlayers.map(p => ({ ...p, isReady: false }));

      if (prev.roomChannel) {
        safeChannelPublish(prev.roomChannel, 'phaseChange', {
          phase: 'map-selection',
          players: resetPlayers,
          selectedMapId: prev.selectedMapId,
        });
      }

      return {
        ...prev,
        lobbyPhase: 'map-selection',
        connectedPlayers: resetPlayers,
      };
    });
  }, []);

  /**
   * Confirm map selection and move to ready-up phase (host only)
   */
  const confirmMapSelection = useCallback(() => {
    setGameState(prev => {
      if (!prev.isHost) {
        console.warn('Only host can confirm map selection');
        return prev;
      }

      const updatedPlayers = prev.connectedPlayers.map(p => ({ ...p, isReady: false }));

      if (prev.roomChannel) {
        safeChannelPublish(prev.roomChannel, 'phaseChange', {
          phase: 'ready-up',
          players: updatedPlayers,
          selectedMapId: prev.selectedMapId,
        });
      }

      return {
        ...prev,
        lobbyPhase: 'ready-up',
        connectedPlayers: updatedPlayers,
      };
    });
  }, []);

  /**
   * Toggle ready state for current player
   */
  const toggleReady = useCallback(() => {
    setGameState(prev => {
      if (!prev.roomChannel) {
        console.warn('Not in a lobby');
        return prev;
      }

      const resolvedClientId =
        (roomClient && roomClient.auth.clientId)
          ? roomClient.auth.clientId
          : prev.connectedPlayers.find(p => p.username === prev.username)?.clientId || '';

      if (!resolvedClientId) {
        console.warn('Unable to resolve client id for ready toggle');
        return prev;
      }

      const playerEntry = prev.connectedPlayers.find(p => p.clientId === resolvedClientId);
      if (!playerEntry) {
        console.warn('Ready toggle failed: player not found', resolvedClientId);
        return prev;
      }

      if (prev.lobbyPhase !== 'ready-up') {
        // Ignore ready toggles during other phases to avoid desync
        console.warn('Ready toggle ignored: not in ready-up phase. Current phase:', prev.lobbyPhase);
        return prev;
      }

      const nextReady = !playerEntry.isReady;

      debugLog('Toggling ready state for', resolvedClientId, 'to', nextReady);

      if (prev.roomChannel) {
        safeChannelPublish(prev.roomChannel, 'playerReady', {
          clientId: resolvedClientId,
          isReady: nextReady,
        });
      }

      return {
        ...prev,
        connectedPlayers: prev.connectedPlayers.map(p =>
          p.clientId === resolvedClientId ? { ...p, isReady: nextReady } : p
        ),
      };
    });
  }, [roomClient]);

  const value: GameContextType = {
    gameState,
    setGameState,
    createMultiplayerLobby,
    joinMultiplayerLobby,
    leaveLobby,
    hostStartGame,
    hostEndGame,
    selectMap,
    startMapSelection,
    confirmMapSelection,
    toggleReady,
  };

  return (
    <GameContext.Provider value={value}>
      {children}
    </GameContext.Provider>
  );
}
