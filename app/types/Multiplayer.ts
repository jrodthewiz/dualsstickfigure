import type { RealtimeRoom } from "../utils/roomClient";

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
    reverseKick?: boolean;
    uppercut?: boolean;
    saltoKick?: boolean;
    jabHighDouble?: boolean;
    shoot?: boolean;
    slash?: boolean;
    block?: boolean;
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
    reverseKick?: boolean;
    uppercut?: boolean;
    saltoKick?: boolean;
    jabHighDouble?: boolean;
    shoot?: boolean;
    slash?: boolean;
    block?: boolean;
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
  roomChannel: RealtimeRoom | null;
  username: string;
  intendedGameMode: 'PvP' | 'Infinite';
  selectedMapId: string;
}

export interface NetworkMessage {
  type: string;
  data: any;
  timestamp: number;
}

export interface PlayerAttackMessage {
  playerId: string;
  attackType: string;
  position: { x: number; y: number };
  facingRight: boolean;
  timestamp: number;
}

export interface PlayerHitMessage {
  victimId: string;
  attackerId: string;
  damage: number;
  attackType: string;
  knockbackX: number;
  knockbackY: number;
  hitPosition: { x: number; y: number };
  cameraShake: number;
  hitStun: number;
  effectColor: string;
  effectIntensity: number;
  timestamp: number;
}

export interface BulletSyncMessage {
  shooterId: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  weaponType: string;
  damage: number;
  timestamp: number;
}

export interface FlameWeaponMessage {
  shooterId: string;
  action: 'start' | 'stop';
  position: { x: number; y: number };
  facingRight: boolean;
  timestamp: number;
}

export interface GameStartMessage {
  players: ConnectedPlayer[];
  startTime: number;
  gameMode: string;
}

export interface SyncUpdate {
  type: 'player' | 'attack' | 'hit' | 'gameState';
  id: string;
  data: any;
  timestamp: number;
}

export const SYNC_CONSTANTS = {
  PLAYER_SYNC_RATE: 50, // ms (20 Hz)
  POSITION_THRESHOLD: 0.01,
  MAX_LATENCY_COMPENSATION: 200, // ms
} as const;

