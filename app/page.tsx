"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Head from 'next/head';
import Stats from 'stats.js';
import * as Proton from 'proton-engine';
import { createCharacterInput, resetCharacterInput, updateAttackEdgeFlags } from "./game/characterShared";
import type { CharacterInput } from "./game/characterShared";

import { applyDecisionToInput, stepEnemyStateMachine } from "./game/ai/stateMachine";
import type { EnemyAttackName } from "./game/ai/stateMachine";

import { useGameContext } from "./context/GameContext";
import { useRoomClient } from "./context/RoomContext";
import { safeChannelPublish, safeChannelSubscribe } from "./utils/roomHelpers";
import { gameImagePath, gamePath, getInvitedRoom } from "./utils/gamePath";
import type { RemotePlayer } from "./types/Multiplayer";
import { AVAILABLE_MAPS, getMapById } from "./types/Maps";
import type { MapConfig, RooftopPlatformData, RooftopBuildingDefinition, RooftopFeatureDefinition, RooftopBuildingStyle } from "./types/Maps";
import { MapSelectionScreen } from "./components/multiplayer/MapSelectionScreen";
import { ReadyUpScreen } from "./components/multiplayer/ReadyUpScreen";
import { Dialog } from "./components/ui/Dialog";
import { PromptDialog } from "./components/ui/PromptDialog";
import { VoiceChat } from "./components/voice/VoiceChat";
import * as SuburbiaMap from "./game/maps/suburbia";
import type { SuburbiaState, SuburbiaHoverMotion, SuburbiaHoverPatternSlot } from "./game/maps/suburbia";
import * as MetropolisMap from "./game/maps/metropolis";
import type { MetropolisState } from "./game/maps/metropolis";
import * as RooftopsMap from "./game/maps/rooftops";
import type { RooftopsState } from "./game/maps/rooftops";
import { SKY_GRADIENTS, NATURE_COLORS } from "./theme/mapThemes";
import * as ParticleEffects from "./game/particleEffects";
import * as CollisionUtils from "./game/collisionUtils";
import type { AttackHitbox as ImportedAttackHitbox, CollisionSettings, DebugSettings } from "./game/collisionUtils";
import { SpatialHashGrid } from "./game/spatialHash";
import { isInViewport } from "./game/viewportCulling";
import { PlatformCacheManager, createOffscreenCanvas, canvasToImageBitmap } from "./game/platformCache";

// ========== Perlin Noise (1D) ==========
class Perlin1D {
  private permutation: number[];
  private grad: number[];

  constructor(seed = 1337) {
    let x = seed >>> 0;
    const rand = () => (x = (1664525 * x + 1013904223) >>> 0) / 0xffffffff;

    const p: number[] = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.permutation = new Array(512);
    for (let i = 0; i < 512; i++) this.permutation[i] = p[i & 255];

    this.grad = new Array(512);
    for (let i = 0; i < 512; i++) this.grad[i] = (this.permutation[i] & 1) === 0 ? 1 : -1;
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  noise(x: number): number {
    const xi = Math.floor(x) & 255;
    const xf = x - Math.floor(x);

    const g0 = this.grad[xi];
    const g1 = this.grad[xi + 1];

    const d0 = g0 * xf;
    const d1 = g1 * (xf - 1);

    const u = this.fade(xf);
    return this.lerp(d0, d1, u) * 0.5 + 0.5; // [0,1]
  }
}

// ========== Types ==========

type Vector = { x: number; y: number };

type KeyAction =
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'run'
  | 'primaryAttack'
  | 'secondaryAttack'
  | 'kickLow'
  | 'reverseKick'
  | 'uppercut'
  | 'saltoKick'
  | 'jabHighDouble'
  | 'toggleHelp'
  | 'togglePause'
  | 'restart'
  | 'start'
  | 'weaponModeUnarmed'
  | 'weaponModeGun'
  | 'weaponModeSword'
  | 'weaponSlot0'
  | 'weaponSlot1'
  | 'weaponSlot2'
  | 'weaponSlot3'
  | 'weaponSlot4'
  | 'weaponSlot5'
  | 'weaponSlot6';

type KeyBindingMap = Record<KeyAction, string[]>;

const DEFAULT_KEY_BINDINGS: KeyBindingMap = {
  moveLeft: ['ArrowLeft', 'KeyA'],
  moveRight: ['ArrowRight', 'KeyD'],
  jump: ['ArrowUp', 'KeyW', 'Space'],
  run: ['ShiftLeft', 'ShiftRight'],
  primaryAttack: ['KeyZ'],
  secondaryAttack: ['KeyX'],
  kickLow: ['KeyC'],
  reverseKick: ['KeyV'],
  uppercut: ['KeyQ'],
  saltoKick: ['KeyE'],
  jabHighDouble: ['KeyF'],
  toggleHelp: ['KeyH'],
  togglePause: ['KeyP'],
  restart: ['KeyR'],
  start: ['Enter', 'Space', 'KeyP'],
  weaponModeUnarmed: ['Digit1'],
  weaponModeGun: ['Digit2'],
  weaponModeSword: ['Digit3'],
  weaponSlot0: ['Digit4'],
  weaponSlot1: ['Digit5'],
  weaponSlot2: ['Digit6'],
  weaponSlot3: ['Digit7'],
  weaponSlot4: ['Digit8'],
  weaponSlot5: ['Digit9'],
  weaponSlot6: ['Digit0'],
};

const KEYBIND_STORAGE_KEY = 'hvai_platformer_keybindings_v1';
const MAX_BINDINGS_PER_ACTION = 2;

const KEY_ACTION_INFO: Record<KeyAction, { label: string; description?: string; category: 'Movement' | 'Combat' | 'Weapons' | 'System' }> = {
  moveLeft: { label: 'Move Left', category: 'Movement' },
  moveRight: { label: 'Move Right', category: 'Movement' },
  jump: { label: 'Jump', category: 'Movement' },
  run: { label: 'Run / Sprint', category: 'Movement' },
  primaryAttack: { label: 'Primary Attack', description: 'Punch / Shoot / Slash', category: 'Combat' },
  secondaryAttack: { label: 'Secondary Attack', description: 'Kick High / Block', category: 'Combat' },
  kickLow: { label: 'Low Kick', category: 'Combat' },
  reverseKick: { label: 'Reverse Kick', category: 'Combat' },
  uppercut: { label: 'Uppercut', category: 'Combat' },
  saltoKick: { label: 'Salto Kick', category: 'Combat' },
  jabHighDouble: { label: 'Jab High Double', category: 'Combat' },
  toggleHelp: { label: 'Toggle Help Overlay', category: 'System' },
  togglePause: { label: 'Pause / Resume', category: 'System' },
  restart: { label: 'Restart Run', category: 'System' },
  start: { label: 'Start Game', category: 'System' },
  weaponModeUnarmed: { label: 'Stance: Unarmed', category: 'Weapons' },
  weaponModeGun: { label: 'Stance: Gun', category: 'Weapons' },
  weaponModeSword: { label: 'Stance: Sword', category: 'Weapons' },
  weaponSlot0: { label: 'Weapon Slot 1', description: 'Pistol slot', category: 'Weapons' },
  weaponSlot1: { label: 'Weapon Slot 2', category: 'Weapons' },
  weaponSlot2: { label: 'Weapon Slot 3', category: 'Weapons' },
  weaponSlot3: { label: 'Weapon Slot 4', category: 'Weapons' },
  weaponSlot4: { label: 'Weapon Slot 5', category: 'Weapons' },
  weaponSlot5: { label: 'Weapon Slot 6', category: 'Weapons' },
  weaponSlot6: { label: 'Weapon Slot 7', category: 'Weapons' },
};

const KEYBIND_SECTIONS: { title: string; actions: KeyAction[] }[] = [
  { title: 'Movement', actions: ['moveLeft', 'moveRight', 'jump', 'run'] },
  { title: 'Combat', actions: ['primaryAttack', 'secondaryAttack', 'kickLow', 'reverseKick', 'uppercut', 'saltoKick', 'jabHighDouble'] },
  { title: 'Weapons', actions: ['weaponModeUnarmed', 'weaponModeGun', 'weaponModeSword', 'weaponSlot0', 'weaponSlot1', 'weaponSlot2', 'weaponSlot3', 'weaponSlot4', 'weaponSlot5', 'weaponSlot6'] },
  { title: 'System', actions: ['start', 'togglePause', 'restart', 'toggleHelp'] },
];

const KEY_CODE_LABEL_OVERRIDES: Record<string, string> = {
  ArrowLeft: 'Arrow Left',
  ArrowRight: 'Arrow Right',
  ArrowUp: 'Arrow Up',
  ArrowDown: 'Arrow Down',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  Space: 'Space',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Escape: 'Escape',
  CapsLock: 'Caps Lock',
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
};

function prettyKeyLabel(code: string): string {
  if (!code) return 'Unassigned';
  if (KEY_CODE_LABEL_OVERRIDES[code]) return KEY_CODE_LABEL_OVERRIDES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Bracket')) return code.replace('Bracket', '');
  if (code.startsWith('Slash')) return '/';
  if (code.startsWith('Backslash')) return '\\';
  if (code.startsWith('Minus')) return '-';
  if (code.startsWith('Equal')) return '=';
  if (code === 'Semicolon') return ';';
  if (code === 'Quote') return `'`;
  if (code === 'Comma') return ',';
  if (code === 'Period') return '.';
  if (code === 'Backquote') return '`';
  return code;
}

function cloneBindings(map: KeyBindingMap): KeyBindingMap {
  const next = {} as KeyBindingMap;
  (Object.keys(map) as KeyAction[]).forEach((action) => {
    next[action] = [...map[action]];
  });
  return next;
}

function sanitizeBindings(raw: unknown): KeyBindingMap {
  const base = cloneBindings(DEFAULT_KEY_BINDINGS);
  if (!raw || typeof raw !== 'object') return base;
  (Object.keys(base) as KeyAction[]).forEach((action) => {
    const value = (raw as Record<string, unknown>)[action];
    if (Array.isArray(value)) {
      const filtered = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
      base[action] = filtered.slice(0, MAX_BINDINGS_PER_ACTION);
    }
  });
  return base;
}

type Bullet = {
  position: Vector;
  velocity: Vector;
  lifeMs: number;
  damage: number;
  radius: number; // visual radius; rockets/grenades use as explosion radius on impact
  from: "player" | "enemy";
  type: WeaponType | "enemy_bullet";
  gravity?: number; // for arcing projectiles like grenades
  pierce?: number; // number of enemies it can pierce before despawn
  boomerang?: boolean; // if true, will return to player
  boomerangPhase?: 'out' | 'return';
  startPos?: Vector; // for boomerang max range
  maxRange?: number; // for boomerang range before return
  hitIds?: Set<number>; // track enemies hit to avoid multi-hit in same frame
  // simple trail throttling (ms accumulator)
  trailMs?: number;
};

type Particle = {
  position: Vector;
  velocity: Vector;
  lifeMs: number;
  size: number;
  color: string;
  gravity: number;
  fade: number; // alpha fade per ms
};

type PlatformKind = 'track' | 'hover' | 'tower' | 'brutalist';
type PlatformFeatureType = 'jumpPad' | 'dashPad' | 'fragile' | 'boost' | 'mine' | 'watertower' | 'acunit';
type PlatformMotion = {
  axis: 'x' | 'y';
  amplitude: number;
  speed: number;
  phase: number;
  baseX: number;
  baseY: number;
};
type Platform = {
  id?: number | string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind?: PlatformKind;
  lane?: number;
  seed?: number;
  chunkId?: number;
  baseX?: number;
  baseY?: number;
  motion?: PlatformMotion;
  featureType?: PlatformFeatureType;
  featureOffset?: number;
  featureWidth?: number;
  featureStrength?: number;
  featureDir?: number;
  featureCooldownMs?: number;
  featureTimerMs?: number;
  // Rooftop-specific properties
  rooftopKey?: string;
  rooftopStyle?: RooftopBuildingStyle;
  sourceBuildingId?: string;
  sourceFeatureId?: string;
  buildingHeight?: number;
  buildingStyle?: number;
  isRooftopFeature?: boolean;
  isRooftop?: boolean;
  featureHeight?: number;
  rooftopHeight?: number;
  fragileState?: 'ready'|'breaking'|'gone';
  fragileTimerMs?: number;
  fragileTriggerMs?: number;
  fragileRespawnMs?: number;
  silhouette?: number;
  hueShift?: number;
  active?: boolean;
  hasThrusters?: boolean;
}; // top-only collider

type WeaponType = "pistol" | "shotgun" | "rifle" | "rocket" | "minigun" | "railgun" | "flame" | "grenade" | "ice" | "laser" | "plasma" | "bow" | "crossbow" | "boomerang" | "wand" | "bomb" | "axe" | "spear" | "chainsaw" | "beam" | "lightning" | "cluster";

type Weapon = {
  type: WeaponType;
  fireRateMs: number;
  projectileSpeed: number;
  spreadDeg: number;
  projectilesPerShot: number;
  damage: number;
  recoil: number;
};

type SynthLayer = {
  type?: OscillatorType;
  freq?: number;
  sweepTo?: number;
  sweepMs?: number;
  freqVariance?: number;
  durationMs: number;
  volume: number;
  attackMs?: number;
  releaseMs?: number;
  delayMs?: number;
  noise?: boolean;
  filterType?: BiquadFilterType;
  filterFreq?: number;
  filterQ?: number;
  distortion?: number;
  phaserRateHz?: number;
  phaserDepth?: number;
  phaserStages?: number;
  phaserBaseFreq?: number;
  pan?: number;
  panVariance?: number;
  sustainLevel?: number;
  sustainHoldMs?: number;
};
type SynthPreset = SynthLayer[];

// ========== Stickman Animation System ==========
type StickmanAnimDef = { path: string; frames: number; fps: number; loop: boolean };
type StickmanFrameOverride = { animName?: string; framePad?: 0 | 2; soundFrames?: number[] };
type StickmanClip = { images: (HTMLImageElement | ImageBitmap)[]; fps: number; loop: boolean };

const STICKMAN_ANIMS: Record<string, StickmanAnimDef> = {
  // UNARMED - Movement
  unarmed_idle: { path: "/models/Stickfigure Player/idle", frames: 16, fps: 10, loop: true },
  unarmed_walk: { path: "/models/Stickfigure Player/walk normal", frames: 22, fps: 12, loop: true },
  unarmed_run: { path: "/models/Stickfigure Player/run", frames: 16, fps: 14, loop: true },
  unarmed_run_stop: { path: "/models/Stickfigure Player/run stop", frames: 14, fps: 14, loop: false },
  unarmed_jump: { path: "/models/Stickfigure Player/jump A", frames: 6, fps: 14, loop: false },
  
  // UNARMED - Attacks - Punches
  unarmed_jab_single: { path: "/models/Stickfigure Player/jab single", frames: 6, fps: 18, loop: false },
  unarmed_jab_high_double: { path: "/models/Stickfigure Player/jab high double", frames: 11, fps: 18, loop: false },
  unarmed_uppercut: { path: "/models/Stickfigure Player/uppercut", frames: 9, fps: 18, loop: false },
  
  // UNARMED - Attacks - Kicks
  unarmed_kick_high: { path: "/models/Stickfigure Player/kick high", frames: 12, fps: 16, loop: false },
  unarmed_kick_low: { path: "/models/Stickfigure Player/kick low", frames: 12, fps: 16, loop: false },
  unarmed_reverse_kick: { path: "/models/Stickfigure Player/reverse kick", frames: 12, fps: 16, loop: false },
  unarmed_salto_kick: { path: "/models/Stickfigure Player/salto kick", frames: 16, fps: 16, loop: false },
  
  // UNARMED - Damage
  unarmed_hurt: { path: "/models/Stickfigure Player/hurt center", frames: 8, fps: 14, loop: false },
  unarmed_die: { path: "/models/Stickfigure Player/die A", frames: 16, fps: 14, loop: false },
  
  // PISTOL - Movement
  pistol_idle: { path: "/models/Stickfigure Player/2_Pistol/idle", frames: 16, fps: 10, loop: true },
  pistol_idle_active: { path: "/models/Stickfigure Player/2_Pistol/idle active", frames: 16, fps: 10, loop: true },
  pistol_idle_fight: { path: "/models/Stickfigure Player/2_Pistol/idle fight pose", frames: 16, fps: 10, loop: true },
  pistol_walk: { path: "/models/Stickfigure Player/2_Pistol/walk normal", frames: 22, fps: 12, loop: true },
  pistol_walk_fight: { path: "/models/Stickfigure Player/2_Pistol/walk fight pose", frames: 22, fps: 12, loop: true },
  pistol_walk_shoot: { path: "/models/Stickfigure Player/2_Pistol/walk shoot", frames: 22, fps: 12, loop: true },
  pistol_run: { path: "/models/Stickfigure Player/2_Pistol/run", frames: 16, fps: 14, loop: true },
  pistol_run_shoot: { path: "/models/Stickfigure Player/2_Pistol/run shoot", frames: 16, fps: 14, loop: true },
  pistol_run_stop: { path: "/models/Stickfigure Player/2_Pistol/run stop", frames: 14, fps: 14, loop: false },
  pistol_jump: { path: "/models/Stickfigure Player/2_Pistol/jump A", frames: 6, fps: 14, loop: false },
  
  // PISTOL - Attack
  pistol_shoot: { path: "/models/Stickfigure Player/2_Pistol/shoot", frames: 5, fps: 18, loop: false },
  
  // PISTOL - Damage
  pistol_hurt_center: { path: "/models/Stickfigure Player/2_Pistol/hurt center", frames: 8, fps: 14, loop: false },
  pistol_die: { path: "/models/Stickfigure Player/2_Pistol/die A", frames: 16, fps: 14, loop: false },
  
  // SWORD - Movement
  sword_idle: { path: "/models/Stickfigure Player/1_Sword/idle", frames: 16, fps: 10, loop: true },
  sword_idle_active: { path: "/models/Stickfigure Player/1_Sword/idle active", frames: 16, fps: 10, loop: true },
  sword_idle_fight: { path: "/models/Stickfigure Player/1_Sword/idle fight pose", frames: 16, fps: 10, loop: true },
  sword_walk: { path: "/models/Stickfigure Player/1_Sword/walk normal", frames: 22, fps: 12, loop: true },
  sword_walk_fight: { path: "/models/Stickfigure Player/1_Sword/walk fight pose", frames: 22, fps: 12, loop: true },
  sword_run: { path: "/models/Stickfigure Player/1_Sword/run", frames: 16, fps: 14, loop: true },
  sword_run_stop: { path: "/models/Stickfigure Player/1_Sword/run stop", frames: 14, fps: 14, loop: false },
  sword_jump: { path: "/models/Stickfigure Player/1_Sword/jump A", frames: 6, fps: 14, loop: false },
  
  // SWORD - Attack & Block
  sword_slash: { path: "/models/Stickfigure Player/1_Sword/slash", frames: 16, fps: 18, loop: false },
  sword_block_center: { path: "/models/Stickfigure Player/1_Sword/block center", frames: 9, fps: 14, loop: false },
  sword_block_top: { path: "/models/Stickfigure Player/1_Sword/block top", frames: 9, fps: 14, loop: false },
  sword_block_bottom: { path: "/models/Stickfigure Player/1_Sword/block bottom", frames: 9, fps: 14, loop: false },
  
  // SWORD - Damage
  sword_hurt_center: { path: "/models/Stickfigure Player/1_Sword/hurt center", frames: 8, fps: 14, loop: false },
  sword_die: { path: "/models/Stickfigure Player/1_Sword/die A", frames: 16, fps: 14, loop: false },
};

const STICKMAN_FRAME_OVERRIDES: Record<string, StickmanFrameOverride> = {
  unarmed_jab_single: { framePad: 0, soundFrames: [2] },
  unarmed_jab_high_double: { soundFrames: [2, 7] },
  unarmed_uppercut: { framePad: 0 },
  unarmed_kick_high: { soundFrames: [4] },
  unarmed_kick_low: { soundFrames: [4] },
  unarmed_reverse_kick: { soundFrames: [8] },
  unarmed_hurt: { framePad: 0 },
  pistol_idle_fight: { animName: 'idle active fight pose' },
  pistol_run_stop: { soundFrames: [3] },
  pistol_jump: { framePad: 0 },
  pistol_shoot: { framePad: 0 },
  pistol_hurt_center: { framePad: 0 },
  sword_run_stop: { soundFrames: [3] },
  sword_jump: { framePad: 0 },
  sword_slash: { soundFrames: [5] },
  sword_block_center: { framePad: 0 },
  sword_block_top: { framePad: 0 },
  sword_block_bottom: { framePad: 0 },
  sword_hurt_center: { framePad: 0 },
};

const getStickmanFrameUrl = (key: string, def: StickmanAnimDef, frameIndex: number): string => {
  const override = STICKMAN_FRAME_OVERRIDES[key];
  const isPistol = def.path.includes('2_Pistol');
  const isSword = def.path.includes('1_Sword');
  const baseName = isPistol ? 'stickman fighter-black-3_Pistol-' : isSword ? 'stickman fighter-black-2_Sword-' : 'stickman fighter-black-1_-';
  const animName = override?.animName ?? def.path.split('/').pop() ?? '';
  const framePad = override?.framePad ?? 2;
  const frameId = framePad === 2 ? frameIndex.toString().padStart(2, '0') : frameIndex.toString();
  const soundSuffix = override?.soundFrames?.includes(frameIndex) ? '_play_sound' : '';

  return gameImagePath(`${def.path}/${baseName}${animName}_${frameId}${soundSuffix}.png`.replace(/ /g, '%20'));
};

const globalClips = {
  clips: {} as Record<string, StickmanClip>,
  ready: false,
};

const STICKMAN_BOUNDS = { width: 1242, height: 1087, centerX: 481, bottom: 913, visibleHeight: 509 };
const DEFAULT_PLAYER_RADIUS = 22;
const BASE_SPRITE_SCALE = (DEFAULT_PLAYER_RADIUS * 7.8) / STICKMAN_BOUNDS.visibleHeight;
const BASE_OFFSET_X = STICKMAN_BOUNDS.centerX * BASE_SPRITE_SCALE;
const BASE_OFFSET_Y = STICKMAN_BOUNDS.bottom * BASE_SPRITE_SCALE;

type SpriteAnchor = { u: number; v: number };
type SpriteAnchors = { muzzle: SpriteAnchor; grip: SpriteAnchor };

const SPRITE_WEAPON_ANCHORS: Partial<Record<'pistol' | 'sword', SpriteAnchors>> = {
  // Approximate anchors derived from default stickman pistol pose
  pistol: {
    grip: { u: 0.64, v: 0.66 },
    muzzle: { u: 0.86, v: 0.60 },
  },
};

// ========== ENHANCED HITBOX SYSTEM ==========
// Use imported types from collisionUtils
type AttackHitbox = ImportedAttackHitbox;

type MeleeAttackData = {
  hitboxes: AttackHitbox[];
  totalFrames: number;
  fps: number;
  kickback: number; // player recoil
  soundType: 'punch' | 'kick' | 'sword';
  audioTriggerFrame?: number; // frame index to fire swing audio (defaults to 1)
  audioTriggerFrames?: number[]; // optional additional frames to fire swing audio
};
const MELEE_ATTACK_DATA: Record<string, MeleeAttackData> = {
  // PUNCHES - Fast, close range
  'unarmed_jab_single': {
    totalFrames: 6,
    fps: 18,
    kickback: 180, // Increased // Increased from 80
    soundType: 'punch',
    audioTriggerFrame: 3,
    hitboxes: [{
      shape: 'rectangle',
      offsetX: 20, // Reduced for close-range hits
      offsetY: -12,
      width: 70, // Increased to compensate
      height: 42, // Increased from 28
      damage: 18,
      knockback: 180,
      activeFrameStart: 1,
      activeFrameEnd: 2.5,
      hitStun: 30,
      cameraShake: 50, // Increased // Increased // Increased
      invulnFrames: 80, // Reduced from 200 for more responsive hits
      effectColor: '#6dd6ff',
      effectIntensity: 1.5,
    }]
  },
  
  'unarmed_jab_high_double': {
    totalFrames: 11,
    fps: 18,
    kickback: 225, // Increased // Increased
    soundType: 'punch',
    audioTriggerFrame: 3,
    audioTriggerFrames: [3, 8],
    hitboxes: [
      {
        // First jab
        shape: 'rectangle',
        offsetX: 15, // Reduced for close-range hits
        offsetY: -18,
        width: 65, // Increased to compensate
        height: 40, // Increased from 26
        damage: 15,
        knockback: 150,
        activeFrameStart: 3,
        activeFrameEnd: 4.5,
        hitStun: 25,
        cameraShake: 15, // Increased
        invulnFrames: 15, // Very short invuln to allow second punch to land
        effectColor: '#6dd6ff',
        effectIntensity: 1.6,
      },
      {
        // Second jab
        shape: 'rectangle',
        offsetX: 20, // Reduced for close-range hits
        offsetY: -18,
        width: 70, // Increased to compensate
        height: 42, // Increased from 28
        damage: 20,
        knockback: 330, // Increased
        activeFrameStart: 8,
        activeFrameEnd: 9.5,
        hitStun: 40,
        cameraShake: 42, // Increased // Increased
        invulnFrames: 90, // Longer invuln after second punch completes
        effectColor: '#9f7aff',
        effectIntensity: 2.2,
      }
    ]
  },
  
  'unarmed_uppercut': {
    totalFrames: 9,
    fps: 18,
    kickback: 200, // Increased
    soundType: 'punch',
    audioTriggerFrame: 2,
    hitboxes: [{
      shape: 'rectangle',
      offsetX: 15, // Reduced for close-range hits
      offsetY: -20,
      width: 75, // Increased to compensate
      height: 70, // Increased from 50
      damage: 35,
      knockback: 570, // Increased
      knockbackAngle: -Math.PI / 3, // strong upward launch
      activeFrameStart: 2,
      activeFrameEnd: 4,
      hitStun: 60,
      cameraShake: 60, // Increased // Increased
      invulnFrames: 100, // Reduced from 250
      effectColor: '#7f5bff',
      effectIntensity: 2.5,
    }]
  },
  
  // KICKS - Longer range, more damage, arc hitboxes
  'unarmed_kick_high': {
    totalFrames: 12,
    fps: 16,
    kickback: 225, // Increased // Increased
    soundType: 'kick',
    audioTriggerFrame: 3,
    hitboxes: [{
      shape: 'arc',
      arcRadius: 85, // Increased from 65
      arcStartAngle: -Math.PI / 6,
      arcEndAngle: Math.PI / 3,
      offsetX: 0, // Start from player center
      offsetY: -25,
      damage: 32,
      knockback: 320,
      activeFrameStart: 3,
      activeFrameEnd: 6,
      hitStun: 50,
      cameraShake: 50, // Increased // Increased
      invulnFrames: 90, // Reduced from 220
      effectColor: '#8aa2ff',
      effectIntensity: 2.2,
    }]
  },
  
  'unarmed_kick_low': {
    totalFrames: 12,
    fps: 16,
    kickback: 135, // Increased
    soundType: 'kick',
    audioTriggerFrame: 3,
    hitboxes: [{
      shape: 'rectangle',
      offsetX: 20, // Reduced for close-range hits
      offsetY: 5,
      width: 80, // Increased to compensate
      height: 48, // Increased from 32
      damage: 28,
      knockback: 630, // Increased // Increased
      knockbackAngle: Math.PI / 6, // slightly upward
      activeFrameStart: 3,
      activeFrameEnd: 6,
      hitStun: 45,
      cameraShake: 28, // Increased
      invulnFrames: 85, // Reduced from 210
      effectColor: '#6fb4ff',
      effectIntensity: 2,
    }]
  },
  
  'unarmed_reverse_kick': {
    totalFrames: 12,
    fps: 16,
    kickback: 180, // Increased
    soundType: 'kick',
    audioTriggerFrame: 4,
    hitboxes: [{
      shape: 'arc',
      arcRadius: 90, // Increased from 70
      arcStartAngle: Math.PI / 4,
      arcEndAngle: Math.PI * 0.7,
      offsetX: 0, // Start from player center
      offsetY: -18,
      damage: 38,
      knockback: 630, // Increased
      activeFrameStart: 4,
      activeFrameEnd: 7,
      hitStun: 70,
      cameraShake: 42, // Increased
      invulnFrames: 100, // Reduced from 250
      effectColor: '#9b85ff',
      effectIntensity: 2.4,
    }]
  },
  
  'unarmed_salto_kick': {
    totalFrames: 16,
    fps: 16,
    kickback: 225, // Increased
    soundType: 'kick',
    audioTriggerFrame: 5,
    hitboxes: [{
      shape: 'arc',
      arcRadius: 95, // Increased from 75
      arcStartAngle: -Math.PI / 3,
      arcEndAngle: Math.PI / 2,
      offsetX: 0, // Start from player center
      offsetY: -30,
      damage: 45,
      knockback: 750, // Increased
      knockbackAngle: -Math.PI / 4, // strong upward diagonal
      activeFrameStart: 5,
      activeFrameEnd: 9,
      hitStun: 90,
      cameraShake: 50, // Increased
      invulnFrames: 110, // Reduced from 280
      effectColor: '#c3a3ff',
      effectIntensity: 2.8,
    }]
  },
  // SWORD - High damage, extended range
  'sword_slash': {
    totalFrames: 16,
    fps: 18,
    kickback: 390, // Increased
    soundType: 'sword',
    audioTriggerFrame: 2,
    hitboxes: [{
      shape: 'arc',
      arcRadius: 120, // Increased for more consistent hits
      arcStartAngle: -Math.PI / 2.5, // Wider forward-facing arc
      arcEndAngle: Math.PI / 2.5, // Wider forward-facing arc
      offsetX: 0, // Start from player center for close-range hits
      offsetY: -10, // Adjust vertical position
      damage: 55,
      knockback: 720, // Increased
      activeFrameStart: 2,
      activeFrameEnd: 6,
      hitStun: 100,
      cameraShake: 60, // Increased
      invulnFrames: 120, // Reduced from 300
      effectColor: '#ff0000',
      effectIntensity: 3,
    }]
  },
};

const WEAPON_SYNTH_PRESETS: Record<WeaponType, SynthPreset> = {
  pistol: [
    { type: 'square', freq: 520, sweepTo: 360, sweepMs: 120, durationMs: 140, volume: 0.26, attackMs: 5, releaseMs: 140, filterType: 'highpass', filterFreq: 240, distortion: 22, panVariance: 0.18 },
  ],
  shotgun: [
    { type: 'sawtooth', freq: 220, sweepTo: 120, sweepMs: 140, durationMs: 170, volume: 0.33, attackMs: 2, releaseMs: 220, filterType: 'bandpass', filterFreq: 260, filterQ: 1.2, distortion: 38, phaserDepth: 260, phaserRateHz: 0.7, phaserStages: 3 },
    { noise: true, durationMs: 260, volume: 0.26, attackMs: 4, releaseMs: 260, freq: 240, filterQ: 0.9, distortion: 28, panVariance: 0.2 },
  ],
  rifle: [
    { type: 'square', freq: 660, sweepTo: 520, sweepMs: 140, durationMs: 150, volume: 0.24, attackMs: 5, releaseMs: 150, filterType: 'bandpass', filterFreq: 820, filterQ: 0.7, distortion: 24, panVariance: 0.12 },
  ],
  rocket: [
    { type: 'sawtooth', freq: 180, sweepTo: 440, sweepMs: 280, durationMs: 280, volume: 0.28, attackMs: 12, releaseMs: 320, filterType: 'lowpass', filterFreq: 900, distortion: 30, phaserDepth: 180, phaserRateHz: 0.45, phaserStages: 4 },
  ],
  minigun: [
    { type: 'square', freq: 780, freqVariance: 120, durationMs: 70, volume: 0.18, attackMs: 2, releaseMs: 90, filterType: 'highpass', filterFreq: 460, distortion: 26, panVariance: 0.35 },
  ],
  railgun: [
    { type: 'triangle', freq: 1700, sweepTo: 420, sweepMs: 360, durationMs: 320, volume: 0.3, attackMs: 3, releaseMs: 260, filterType: 'bandpass', filterFreq: 1100, filterQ: 1.6, distortion: 40, phaserDepth: 320, phaserRateHz: 1.2, phaserStages: 4 },
  ],
  flame: [
    { noise: true, durationMs: 180, volume: 0.18, attackMs: 2, releaseMs: 200, freq: 380, filterQ: 0.7, distortion: 20, phaserDepth: 150, phaserRateHz: 2.2, phaserStages: 3 },
    { type: 'sawtooth', freq: 320, freqVariance: 60, durationMs: 200, volume: 0.14, attackMs: 2, releaseMs: 200, filterType: 'lowpass', filterFreq: 900, phaserDepth: 140, phaserRateHz: 1.8 },
  ],
  grenade: [
    { type: 'square', freq: 260, sweepTo: 100, sweepMs: 220, durationMs: 220, volume: 0.24, attackMs: 6, releaseMs: 240, filterType: 'bandpass', filterFreq: 300, filterQ: 1.1, distortion: 28, phaserDepth: 200, phaserRateHz: 0.9 },
  ],
  ice: [
    { type: 'triangle', freq: 940, sweepTo: 520, sweepMs: 220, durationMs: 200, volume: 0.2, attackMs: 6, releaseMs: 200, filterType: 'bandpass', filterFreq: 1200, filterQ: 1.5, phaserDepth: 180, phaserRateHz: 1.5 },
    { noise: true, durationMs: 160, volume: 0.12, attackMs: 4, releaseMs: 180, freq: 520, filterQ: 1.2, panVariance: 0.2 },
  ],
  laser: [
    { type: 'sawtooth', freq: 1440, sweepTo: 1180, sweepMs: 90, durationMs: 140, volume: 0.22, attackMs: 1, releaseMs: 140, filterType: 'highpass', filterFreq: 600, distortion: 24, phaserDepth: 140, phaserRateHz: 2.4, panVariance: 0.35 },
  ],
  plasma: [
    { type: 'square', freq: 680, sweepTo: 440, sweepMs: 220, durationMs: 240, volume: 0.22, attackMs: 4, releaseMs: 220, filterType: 'bandpass', filterFreq: 760, filterQ: 0.9, distortion: 26, phaserDepth: 200, phaserRateHz: 0.9 },
    { type: 'sine', freq: 180, sweepTo: 240, sweepMs: 240, durationMs: 240, volume: 0.12, attackMs: 6, releaseMs: 240, filterType: 'lowpass', filterFreq: 500, phaserDepth: 110, phaserRateHz: 0.6, panVariance: 0.25 },
  ],
  bow: [
    { type: 'triangle', freq: 520, sweepTo: 300, sweepMs: 200, durationMs: 200, volume: 0.18, attackMs: 20, releaseMs: 180, filterType: 'bandpass', filterFreq: 640, filterQ: 1.4, phaserDepth: 160, phaserRateHz: 1.2, panVariance: 0.2 },
  ],
  crossbow: [
    { type: 'square', freq: 460, sweepTo: 340, sweepMs: 120, durationMs: 160, volume: 0.18, attackMs: 8, releaseMs: 180, filterType: 'highpass', filterFreq: 280, distortion: 18, phaserDepth: 140, phaserRateHz: 1.4 },
  ],
  boomerang: [
    { type: 'sine', freq: 340, sweepTo: 260, sweepMs: 260, durationMs: 280, volume: 0.16, attackMs: 18, releaseMs: 200, filterType: 'bandpass', filterFreq: 420, filterQ: 1.2, phaserDepth: 220, phaserRateHz: 0.5, phaserStages: 2 },
  ],
  wand: [
    { type: 'triangle', freq: 880, freqVariance: 60, durationMs: 220, volume: 0.16, attackMs: 6, releaseMs: 220, filterType: 'bandpass', filterFreq: 1000, filterQ: 1.3, phaserDepth: 200, phaserRateHz: 1.6 },
    { type: 'sine', freq: 1320, freqVariance: 40, durationMs: 240, volume: 0.12, attackMs: 6, releaseMs: 220, filterType: 'highpass', filterFreq: 700, phaserDepth: 160, phaserRateHz: 1.9, panVariance: 0.3 },
  ],
  bomb: [
    { type: 'square', freq: 200, sweepTo: 80, sweepMs: 340, durationMs: 320, volume: 0.3, attackMs: 10, releaseMs: 320, filterType: 'lowpass', filterFreq: 640, distortion: 34, phaserDepth: 240, phaserRateHz: 0.5, phaserStages: 4 },
    { noise: true, durationMs: 320, volume: 0.2, attackMs: 6, releaseMs: 280, freq: 200, filterQ: 0.9, distortion: 26 },
  ],
  axe: [
    { type: 'square', freq: 300, sweepTo: 170, sweepMs: 170, durationMs: 150, volume: 0.22, attackMs: 8, releaseMs: 170, filterType: 'bandpass', filterFreq: 360, filterQ: 1.0, distortion: 24, phaserDepth: 160, phaserRateHz: 0.9 },
  ],
  spear: [
    { type: 'triangle', freq: 560, sweepTo: 420, sweepMs: 140, durationMs: 170, volume: 0.18, attackMs: 6, releaseMs: 170, filterType: 'bandpass', filterFreq: 720, filterQ: 1.1, phaserDepth: 180, phaserRateHz: 1.1 },
  ],
  chainsaw: [
    { type: 'sawtooth', freq: 520, freqVariance: 140, durationMs: 260, volume: 0.16, attackMs: 4, releaseMs: 240, filterType: 'highpass', filterFreq: 520, distortion: 32, phaserDepth: 280, phaserRateHz: 3.6, phaserStages: 4, panVariance: 0.4 },
  ],
  beam: [
    { type: 'sawtooth', freq: 760, sweepTo: 1240, sweepMs: 200, durationMs: 240, volume: 0.22, attackMs: 4, releaseMs: 220, filterType: 'bandpass', filterFreq: 900, filterQ: 1.0, distortion: 28, phaserDepth: 210, phaserRateHz: 1.5, panVariance: 0.3 },
  ],
  lightning: [
    { type: 'square', freq: 1400, freqVariance: 200, durationMs: 180, volume: 0.26, attackMs: 1, releaseMs: 200, filterType: 'highpass', filterFreq: 780, distortion: 34, phaserDepth: 280, phaserRateHz: 2.6, phaserStages: 3 },
    { noise: true, durationMs: 200, volume: 0.2, attackMs: 2, releaseMs: 220, freq: 900, filterQ: 1.4, distortion: 24, panVariance: 0.25 },
  ],
  cluster: [
    { type: 'square', freq: 420, sweepTo: 640, sweepMs: 170, durationMs: 220, volume: 0.24, attackMs: 6, releaseMs: 220, filterType: 'bandpass', filterFreq: 480, filterQ: 1.0, distortion: 30, phaserDepth: 210, phaserRateHz: 1.4 },
    { noise: true, durationMs: 200, volume: 0.18, attackMs: 6, releaseMs: 220, freq: 240, filterQ: 0.8, distortion: 24, panVariance: 0.2 },
  ],
};

import { theme } from './theme/tokens';
const HUD_MONO_THEME = theme.hud;
// Add a color for weapon-highlight use
const WEAPON_COLOR: Record<string, string> = {
  pistol: HUD_MONO_THEME.accent,
  shotgun: '#e6e6e6',
  rifle: '#d9d9d9',
  rocket: '#cccccc',
  minigun: '#c0c0c0',
  railgun: '#ffffff',
  flame: '#d1d1d1',
  grenade: '#c7c7c7',
  ice: '#dedede',
  laser: '#eeeeee',
  plasma: '#e5e5e5',
  bow: '#bfbfbf',
  crossbow: '#b5b5b5',
  boomerang: '#cbcbcb',
  wand: '#d3d3d3',
  bomb: '#c9c9c9',
  axe: '#a8a8a8',
  spear: '#bcbcbc',
  beam: '#ebebeb',
  lightning: '#f0f0f0',
  cluster: '#cecece',
};

type EnemyType = "grunt" | "ranger" | "brute" | "boss" | "duelist";

type EnemyCombatState = 'neutral' | 'approach' | 'pressure' | 'spacing' | 'combo' | 'retreat' | 'engage';

type Character = {
  id?: number;
  name: string;
  position: Vector;
  velocity: Vector;
  radius: number;
  facing: number;
  onGround: boolean;
  canDoubleJump: boolean;
  shootCooldownMs: number;
  hp: number;
  maxHp: number;
  invulnMs: number;
  currentWeapon: number;
  weapons: Weapon[];
  score: number;
  kills: number;
  animKey: string;
  animFrame: number;
  animHoldUntilEnd: boolean;
  smoothedVelocityX: number;
  previousVelocityX: number;
  wasRunning: boolean;
  currentMotionState: 'idle' | 'walk' | 'run';
  animWeapon: 'unarmed' | 'pistol' | 'sword';
  attackCooldown: number;
  jabPressed: boolean;
  kickHighPressed: boolean;
  kickLowPressed: boolean;
  reverseKickPressed: boolean;
  uppercutPressed: boolean;
  saltoKickPressed: boolean;
  jabHighDoublePressed: boolean;
  ammo: number;
  maxAmmo: number;
  shootPressed: boolean;
  slashPressed: boolean;
  blockPressed: boolean;
  bloodOverlay: number;
  input?: CharacterInput;
  isPlayer?: boolean;
  // AI-specific fields
  aiType?: EnemyType;
  aiState?: "wander" | "chase" | "attack" | "melee" | "retreat";
  flashMs?: number;
  aiCooldownMs?: number;
  preferredRange?: number;
  meleeRange?: number;
  strafeDir?: number;
  strafeTimerMs?: number;
  strafePauseMs?: number;
  strafeDurationMs?: number;
  burstSize?: number;
  burstShotsRemaining?: number;
  nextMeleeMs?: number;
  waveTag?: number;
  weaponSwitchCooldown?: number;
  aiData?: {
    state: EnemyCombatState;
    stateTimer: number;
    actionCooldown: number;
    movePattern: string;
    moveTimer: number;
    lastAttackTime: number;
    comboCount: number;
    circleDirection: number;
    approachStyle: 'direct' | 'zigzag' | 'jump' | 'cautious';
    playerVelocityHistory: number[];
    reactionDelay: number;
    decisionCooldown: number;
    commitTimer: number;
    jumpCooldownMs?: number;
    shootHoldMs: number;
    burstCooldownMs: number;
    rangedCooldownMs?: number;
    comboPattern?: EnemyAttackName[];
    comboStep: number;
    debugLines?: string[];
    lastState?: EnemyCombatState;
    lastStateReason?: string;
    lastPlayerDir: number;
    stuckTimer: number;
    nextActionTime?: number;
    retreatAfterCombo?: boolean;
    lastDecision?: 'approach' | 'shoot' | 'melee' | 'fallback' | 'wander'; // Keep for compatibility
    decisionMs?: number;
    strafePhaseMs?: number;
    strafeDir: number;
    burstShotsLeft?: number;
    commitDir?: number;
    dirChangeMs?: number;
    engageWarmupMs?: number;
    aimTimerMs?: number;
    isAiming?: boolean;
    lastRangedIntent?: boolean;
    playerVisible?: boolean;
    horizontalGap?: number;
  };
};

type Enemy = Character;
// Stickman animation logic will be imported from finalized module

// ========== Constants ==========

const ENEMY_NAMES = [
  "Axiom", "Nebula", "Vortex", "Specter", "Cipher", "Quark", "Pulse",
  "Vector", "Nova", "Echo", "Warden", "Proxy", "Glitch", "Nyx",
];

const WEAPONS: Record<WeaponType, Weapon> = {
  pistol: { type: "pistol", fireRateMs: 240, projectileSpeed: 900, spreadDeg: 0, projectilesPerShot: 1, damage: 20, recoil: 80 },
  shotgun: { type: "shotgun", fireRateMs: 700, projectileSpeed: 800, spreadDeg: 12, projectilesPerShot: 6, damage: 12, recoil: 220 },
  rifle: { type: "rifle", fireRateMs: 120, projectileSpeed: 1200, spreadDeg: 1.5, projectilesPerShot: 1, damage: 16, recoil: 60 },
  rocket: { type: "rocket", fireRateMs: 900, projectileSpeed: 700, spreadDeg: 0, projectilesPerShot: 1, damage: 35, recoil: 380 },
  minigun: { type: "minigun", fireRateMs: 50, projectileSpeed: 1000, spreadDeg: 5, projectilesPerShot: 1, damage: 6, recoil: 30 },
  railgun: { type: "railgun", fireRateMs: 800, projectileSpeed: 4000, spreadDeg: 0, projectilesPerShot: 1, damage: 60, recoil: 200 },
  flame: { type: "flame", fireRateMs: 40, projectileSpeed: 500, spreadDeg: 20, projectilesPerShot: 2, damage: 3, recoil: 0 },
  grenade: { type: "grenade", fireRateMs: 700, projectileSpeed: 700, spreadDeg: 6, projectilesPerShot: 1, damage: 25, recoil: 120 },
  ice: { type: "ice", fireRateMs: 200, projectileSpeed: 900, spreadDeg: 2, projectilesPerShot: 1, damage: 12, recoil: 50 },
  laser: { type: "laser", fireRateMs: 160, projectileSpeed: 1800, spreadDeg: 0, projectilesPerShot: 1, damage: 14, recoil: 40 },
  plasma: { type: "plasma", fireRateMs: 260, projectileSpeed: 1100, spreadDeg: 4, projectilesPerShot: 1, damage: 22, recoil: 70 },
  bow: { type: "bow", fireRateMs: 400, projectileSpeed: 1000, spreadDeg: 0, projectilesPerShot: 1, damage: 18, recoil: 40 },
  crossbow: { type: "crossbow", fireRateMs: 500, projectileSpeed: 1200, spreadDeg: 0, projectilesPerShot: 1, damage: 26, recoil: 60 },
  boomerang: { type: "boomerang", fireRateMs: 600, projectileSpeed: 800, spreadDeg: 0, projectilesPerShot: 1, damage: 20, recoil: 40 },
  wand: { type: "wand", fireRateMs: 300, projectileSpeed: 900, spreadDeg: 8, projectilesPerShot: 1, damage: 16, recoil: 20 },
  bomb: { type: "bomb", fireRateMs: 900, projectileSpeed: 700, spreadDeg: 0, projectilesPerShot: 1, damage: 32, recoil: 200 },
  axe: { type: "axe", fireRateMs: 550, projectileSpeed: 850, spreadDeg: 2, projectilesPerShot: 1, damage: 22, recoil: 60 },
  spear: { type: "spear", fireRateMs: 420, projectileSpeed: 1100, spreadDeg: 0, projectilesPerShot: 1, damage: 20, recoil: 50 },
  chainsaw: { type: "chainsaw", fireRateMs: 60, projectileSpeed: 700, spreadDeg: 15, projectilesPerShot: 1, damage: 5, recoil: 10 },
  beam: { type: "beam", fireRateMs: 220, projectileSpeed: 0, spreadDeg: 0, projectilesPerShot: 1, damage: 28, recoil: 30 },
  lightning: { type: "lightning", fireRateMs: 300, projectileSpeed: 0, spreadDeg: 0, projectilesPerShot: 1, damage: 24, recoil: 10 },
  cluster: { type: "cluster", fireRateMs: 700, projectileSpeed: 800, spreadDeg: 2, projectilesPerShot: 1, damage: 26, recoil: 180 },
};
// ========== Component ==========

export default function PlatformerPage(): JSX.Element {
  // ========== CINEMATIC INTRO CONFIG (Easy to customize!) ==========
  const INTRO_CONFIG = {
    // Timing
    duration: 7000, // Total duration in milliseconds (7 seconds = 7000ms)
    
    // Layout
    letterboxHeight: '20%', // Height of top/bottom black bars (classic movie look)
    imageMaxWidth: '90%', // How wide the fight image can be
    imageMaxHeight: '70%', // How tall the fight image can be
    
    // Visual styling
    backdropBlur: 8, // Blur amount for map behind (px)
    backdropBrightness: 0.3, // Brightness of map behind (0 = black, 1 = normal)
    filmGrainOpacity: 0.05, // Subtle film grain effect (0 = none, 0.1 = heavy)
  };
  // =================================================================

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wheelRef = useRef<{ open: boolean; hoverIndex: number }>({ open: false, hoverIndex: 0 });
  const perfRef = useRef({ avgFps: 60, lastNow: 0, degraded1: false, degraded2: false });

  // Multiplayer hooks
  const gameContext = useGameContext();
  const roomClient = useRoomClient();
  const [remotePlayers, setRemotePlayers] = useState<Map<string, RemotePlayer>>(new Map());
  const lastSyncTime = useRef(0);
  const localPlayerId = useRef<string>('');
  
  // Refs to access latest multiplayer state from canvas closure
  const multiplayerStateRef = useRef(gameContext.gameState);
  const remotePlayersRef = useRef(remotePlayers);
  
  // Keep refs updated
  useEffect(() => {
    multiplayerStateRef.current = gameContext.gameState;
  }, [gameContext.gameState]);
  
  useEffect(() => {
    remotePlayersRef.current = remotePlayers;
  }, [remotePlayers]);

  // Set local player ID from room transport
  useEffect(() => {
    if (roomClient && roomClient.auth && roomClient.auth.clientId) {
      localPlayerId.current = roomClient.auth.clientId;
    }
  }, [roomClient]);

  // ===== Multiplayer: Player Position Sync with Interpolation =====
  // Receives network updates (20Hz) and buffers positions for smooth interpolation
  useEffect(() => {
    const channel = gameContext.gameState.roomChannel;
    if (!channel || !gameContext.gameState.isMultiplayerGame) return;

    const handlePlayerSync = (message: any) => {
      const { id, x, y, vx, vy, health, maxHealth, animKey, animFrame, facingRight, timestamp } = message.data;
      
      // Ignore own sync messages (we're authoritative for local player)
      if (id === localPlayerId.current) return;
      
      setRemotePlayers(prev => {
        const updated = new Map(prev);
        const existing = updated.get(id);
        
        // Reject out-of-order packets (network can deliver messages non-sequentially)
        if (existing?.lastUpdate && timestamp < existing.lastUpdate) {
          return prev;
        }
        
        // Resolve username from lobby data
        const playerInfo = gameContext.gameState.connectedPlayers.find(p => p.clientId === id);
        const username = playerInfo?.username || 'Unknown';
        
        // ===== Interpolation Buffer Management =====
        // Store last 3 network positions with timestamps for smooth interpolation
        // This eliminates visual jitter from 20Hz network updates
        const interpolationBuffer = existing?.interpolationBuffer || [];
        interpolationBuffer.push({
          position: { x, y },
          timestamp
        });
        // Maintain sliding window of 3 positions (150ms of history at 20Hz)
        if (interpolationBuffer.length > 3) {
          interpolationBuffer.shift();
        }
        
        updated.set(id, {
          id,
          username,
          position: { x, y },                          // Latest authoritative position
          velocity: { x: vx || 0, y: vy || 0 },
          health,
          maxHealth,
          animKey,
          animFrame,
          facingRight,
          lastUpdate: timestamp,
          inputs: message.data.inputs || {},           // Store input state for replication
          interpolationBuffer,                          // Buffered positions for interpolation
          renderPosition: existing?.renderPosition || { x, y } // Interpolated position for rendering
        });
        
        return updated;
      });
    };

    const unsubscribe = safeChannelSubscribe(channel, 'playerSync', handlePlayerSync);
    
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [gameContext.gameState.roomChannel, gameContext.gameState.isMultiplayerGame, gameContext.gameState.connectedPlayers]);

  // ===== Multiplayer: PvP Hit Event Reception =====
  // Processes combat hits from attackers with full effect data
  useEffect(() => {
    const channel = gameContext.gameState.roomChannel;
    if (!channel || !gameContext.gameState.isMultiplayerGame) return;

    const handlePlayerHit = (message: any) => {
      const { victimId, attackerId, damage, knockbackX, knockbackY, cameraShake, hitStun, effectColor, effectIntensity, timestamp } = message.data;
      
      // Apply damage if local player is the victim
      if (victimId === localPlayerId.current) {
        const canvas = canvasRef.current as any;
        if (canvas && canvas._applyPvPDamage) {
          // Trigger full damage response with visual/audio effects
          canvas._applyPvPDamage(damage, knockbackX, knockbackY, {
            cameraShake: cameraShake || 200,  // Fallback if old client
            hitStun: hitStun || 0,
            effectColor: effectColor || '#ff0000',
            effectIntensity: effectIntensity || 1
          });
        }
      }
      
      // Update health bars for spectators (not attacker, they already updated locally)
      // Skip if we're the attacker (we already applied the damage immediately at frame crossing)
      if (attackerId !== localPlayerId.current) {
        setRemotePlayers(prev => {
          const updated = new Map(prev);
          const victim = updated.get(victimId);
          if (victim) {
            victim.health = Math.max(0, victim.health - damage);
            updated.set(victimId, victim);
          }
          return updated;
        });
      }
    };

    const unsubscribe = safeChannelSubscribe(channel, 'playerHit', handlePlayerHit);
    
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [gameContext.gameState.roomChannel, gameContext.gameState.isMultiplayerGame]);

  // ===== Multiplayer: Bullet Synchronization =====
  // Receives bullet creation events from remote players for visual feedback
  useEffect(() => {
    const channel = gameContext.gameState.roomChannel;
    if (!channel || !gameContext.gameState.isMultiplayerGame) return;

    const handleBulletSync = (message: any) => {
      const { shooterId, position, velocity, weaponType, damage } = message.data;
      
      // Ignore own bullets (we already have them locally)
      if (shooterId === localPlayerId.current) return;
      
      // Spawn visual bullet
      const canvas = canvasRef.current as any;
      if (canvas && canvas._spawnRemoteBullet) {
        canvas._spawnRemoteBullet(position, velocity, weaponType, damage);
      }
    };

    const unsubscribe = safeChannelSubscribe(channel, 'bulletSync', handleBulletSync);
    
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [gameContext.gameState.roomChannel, gameContext.gameState.isMultiplayerGame]);


  // UI/State
  // helpRef controls help overlay
  const [playerName, setPlayerName] = useState("");
  const [showIntro, setShowIntro] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const SHOW_TITLE_TUNING = false;
  const [titleOffset, setTitleOffset] = useState(0);
  const [titleYOffset, setTitleYOffset] = useState(0);
  const [contentLift, setContentLift] = useState(0);
  const forceRerender = useState(0)[1];
  const hasShownIntro = useRef(false);

  // Show intro screen when game starts for the first time
  useEffect(() => {
    if (gameStarted && !hasShownIntro.current) {
      hasShownIntro.current = true;
      setShowIntro(true);
      const timer = setTimeout(() => {
        setShowIntro(false);
      }, INTRO_CONFIG.duration);
      return () => clearTimeout(timer);
    }
  }, [gameStarted, INTRO_CONFIG.duration]);

  // Return to the lobby when the host ends the match or closes the room.
  const previousRoomRef = useRef(gameContext.gameState.roomChannel);
  useEffect(() => {
    const room = gameContext.gameState.roomChannel;
    const roomClosed = previousRoomRef.current && !room;
    previousRoomRef.current = room;
    if (gameStarted && (roomClosed || (room && gameContext.gameState.lobbyPhase === 'map-selection'))) {
      (canvasRef.current as any)?._resetToLobby?.();
      setGameStarted(false);
      setIsPaused(false);
    }
  }, [gameContext.gameState.lobbyPhase, gameContext.gameState.roomChannel, gameStarted]);

  // Runtime-tweakable visual settings
  const settingsRef = useRef({
    retro: {
      pixelate: false,
      pixelScale: 2,
      crtScanlineAlpha: 0.3,
      vignetteAlpha: 0.5,
    },
    visual: {
      stars: true,
      clouds: true,
      skyline: true,
      rain: true,
      chromaticAberration: false,
      aberrationPx: 0,
      grainAlpha: 0,
      characterStyle: 'stick' as 'emoji'|'stick'|'sprite',
      enemyStyle: 'enemyStick' as 'enemyStick',
      bloom: true,
      bloomRadius: 6,
      bloomAlpha: 0.55,
      aiEnabled: true,
    },
    audio: {
      musicVolume: 0.4,
      sfxVolume: 0.3,
      muted: false,
    },
    debug: {
      renderSky: true,
      renderCityscape: true,
      renderStars: true,
      renderClouds: true,
      renderGround: true,
      renderPlatforms: true,
      renderPlayer: true,
      renderEnemies: true,
      renderBullets: true,
      renderParticles: true,
      renderEffects: true,
      renderRain: true,
      renderCRT: true,
      renderHUD: true,
      renderBloom: true,
      showCollisionBoxes: false,
      collisionSizeMultiplier: 1.5, // Multiplier for collision box sizes
    },
  });

  // Collision box settings (loaded from JSON)
  const collisionSettingsRef = useRef({
    player: { width: 35, height: 80, offsetX: 0, offsetY: 0 },
    enemy: { width: 35, height: 80, offsetX: 0, offsetY: 0 }
  });

  const [keyBindings, setKeyBindings] = useState<KeyBindingMap>(() => {
    if (typeof window === 'undefined') return cloneBindings(DEFAULT_KEY_BINDINGS);
    try {
      const stored = localStorage.getItem(KEYBIND_STORAGE_KEY);
      if (stored) {
        return sanitizeBindings(JSON.parse(stored));
      }
    } catch {}
    return cloneBindings(DEFAULT_KEY_BINDINGS);
  });

  const [keybindModalOpen, setKeybindModalOpen] = useState(false);
  const [editingAction, setEditingAction] = useState<KeyAction | null>(null);
  const [editingSlot, setEditingSlot] = useState<number>(0);
  const [listeningForKey, setListeningForKey] = useState(false);
  
  const [dialogMessage, setDialogMessage] = useState<{ title: string; message: string; type?: 'info' | 'warning' | 'error' } | null>(null);
  const [showJoinPrompt, setShowJoinPrompt] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(keyBindings));
    } catch {}
  }, [keyBindings]);

  // Keybinding editor keyboard capture
  useEffect(() => {
    if (!listeningForKey || !editingAction) return;
    
    const handleKeyCapture = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Escape cancels
      if (e.code === 'Escape') {
        setListeningForKey(false);
        setEditingAction(null);
        return;
      }
      
      // Update the binding
      const newBindings = cloneBindings(keyBindings);
      const currentBindings = [...newBindings[editingAction]];
      
      // Replace or add at the specified slot
      if (editingSlot < currentBindings.length) {
        currentBindings[editingSlot] = e.code;
      } else {
        currentBindings.push(e.code);
      }
      
      newBindings[editingAction] = currentBindings.slice(0, MAX_BINDINGS_PER_ACTION);
      setKeyBindings(newBindings);
      setListeningForKey(false);
      setEditingAction(null);
    };
    
    window.addEventListener('keydown', handleKeyCapture, true);
    return () => window.removeEventListener('keydown', handleKeyCapture, true);
  }, [listeningForKey, editingAction, editingSlot, keyBindings]);

  // UI overlay data polled from the game loop
  const [ui, setUi] = useState({
    hp: 100,
    maxHp: 100,
    shield: 0,
    overdriveMs: 0,
    combo: 0,
    comboTimerMs: 0,
    weapon: "pistol",
    kills: 0,
    wave: 1,
    waveInProgress: true,
    waveTimerMs: 0,
    score: 0,
    highScore: 0,
    playerName: "",
    lives: 3,
    ammo: 60,
    maxAmmo: 120,
  });

  // Persisted audio preferences helpers
  const saveAudioPrefs = () => {
    try {
      localStorage.setItem('hvai_platformer_audio', JSON.stringify(settingsRef.current.audio));
    } catch {}
  };

useEffect(() => {
    // Load audio settings on mount
    try {
      const s = localStorage.getItem('hvai_platformer_audio');
      if (s) {
        const parsed = JSON.parse(s);
        settingsRef.current.audio = {
          musicVolume: typeof parsed.musicVolume === 'number' ? parsed.musicVolume : settingsRef.current.audio.musicVolume,
          sfxVolume: typeof parsed.sfxVolume === 'number' ? parsed.sfxVolume : settingsRef.current.audio.sfxVolume,
          muted: typeof parsed.muted === 'boolean' ? parsed.muted : settingsRef.current.audio.muted,
        };
        forceRerender((n) => n + 1);
      }
    } catch {}
  }, []);

  // Menu state: difficulty + mode
  // PvP Match Setup
  type PlayerSlot = { type: 'empty' | 'player' | 'bot'; name: string; id: string; color: string };
  const [matchPlayers, setMatchPlayers] = useState<PlayerSlot[]>([
    { type: 'player', name: 'Player 1', id: 'p1', color: '#00ff88' },
    { type: 'empty', name: '', id: 's2', color: '#ff0066' },
    { type: 'empty', name: '', id: 's3', color: '#ffaa00' },
    { type: 'empty', name: '', id: 's4', color: '#00aaff' },
  ]);
  const [autoLobbyReady, setAutoLobbyReady] = useState(false);
  const [matchStocks, setMatchStocks] = useState(3);
  const [matchTimeLimit, setMatchTimeLimit] = useState(0); // 0 = no limit
  const gameConfigRef = useRef({ difficulty: 'Normal' as 'Easy'|'Normal'|'Hard', mode: 'Infinite' as 'Infinite'|'PvP' });
  const currentMapRef = useRef(AVAILABLE_MAPS[0]);

  // Visitors without an invite get a room they can share from the main menu.
  const attemptedAutoHost = useRef(false);
  useEffect(() => {
    if (attemptedAutoHost.current || !roomClient || getInvitedRoom(new URLSearchParams(window.location.search))) return;
    attemptedAutoHost.current = true;
    void gameContext.createMultiplayerLobby(playerName || 'Player 1').finally(() => setAutoLobbyReady(true));
  }, [gameContext.createMultiplayerLobby, playerName, roomClient]);

  // Update player slots when remote players join/leave
  React.useEffect(() => {
    const colors = ['#00ff88', '#ff0066', '#ffaa00', '#00aaff'];
    const localClientId = roomClient?.auth?.clientId || localPlayerId.current || null;
    const connectedPlayers = gameContext.gameState.connectedPlayers;
    const remotePlayers = connectedPlayers.filter(player => player.clientId !== localClientId);
    
    setMatchPlayers(prev => {
      const newSlots = [...prev];
      
      // Slot 0 is always local player
      newSlots[0] = { type: 'player', name: playerName || 'Player 1', id: 'p1', color: colors[0] };
      
      // Fill next slots with remote players (excluding local client)
      remotePlayers.forEach((remotePlayer, idx) => {
        const slotIndex = idx + 1;
        if (slotIndex < newSlots.length) {
          newSlots[slotIndex] = { 
            type: 'player', 
            name: remotePlayer.username, 
            id: remotePlayer.clientId, 
            color: colors[slotIndex] || '#ffffff'
          };
        }
      });
      
      // Clear any leftover slots that previously held remote players
      for (let i = remotePlayers.length + 1; i < newSlots.length; i++) {
        if (newSlots[i].type === 'player' && newSlots[i].id !== 'p1') {
          newSlots[i] = { type: 'empty', name: '', id: `s${i + 1}`, color: colors[i] || '#ffffff' };
        }
      }
      
      return newSlots;
    });
  }, [roomClient, gameContext.gameState.connectedPlayers, playerName]);

  // Subscribe to game start event (for clients)
  useEffect(() => {
    const channel = gameContext.gameState.roomChannel;
    if (!channel || gameContext.gameState.isHost) return;

    const handleGameStart = (message: any) => {
      console.log('Game starting:', message.data);
      const canvas = canvasRef.current as any;
      if (canvas && canvas._startGameWithName) {
        canvas._startGameWithName(playerName || "Player", { 
          difficulty: 'Normal', 
          mode: 'PvP',
          mapId: message.data?.mapId || gameContext.gameState.selectedMapId
        });
      }
      setGameStarted(true);
    };

    const unsubscribe = safeChannelSubscribe(channel, 'gameStart', handleGameStart);
    
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [gameContext.gameState.roomChannel, gameContext.gameState.isHost, playerName]);

  // Refs for loop flags
  const runningRef = useRef(true);
  const helpRef = useRef(true);
  const startedRef = useRef(false);

  const UI_WEAPON_EMOJI: Record<string, string> = {
    pistol: '??', shotgun: '??', rifle: '??', rocket: '??', minigun: '???', railgun: '?', flame: '??', grenade: '??', ice: '??',
    laser: '??', plasma: '??', bow: '??', crossbow: '??', boomerang: '??', wand: '??', bomb: '??', axe: '??', spear: '??', chainsaw: '??',
    beam: '??', lightning: '???', cluster: '??'
  };
const ENEMY_GLOW: Record<EnemyType, string> = { grunt: '#ff6666', ranger: '#ff9933', brute: '#ffb347', boss: '#ff4d6d', duelist: '#d45bff' };
  const BULLET_EMOJI: Record<string, string> = {
    pistol: '??', rifle: '??', shotgun: '??', rocket: '??', minigun: '???', railgun: '?', flame: '??', grenade: '??', ice: '??', laser: '??', plasma: '??', bow: '??', crossbow: '??', boomerang: '??', wand: '??', bomb: '??', axe: '??', spear: '??', chainsaw: '??', beam: '??', lightning: '???', cluster: '??', enemy_bullet: '??', default: '??'
  };

type BulletImpactProfile = {
  shock: number;
  knock: number;
  shake: number;
  hitBonus?: number;
};
const DEFAULT_BULLET_IMPACT: BulletImpactProfile = { shock: 12, knock: 520, shake: 110, hitBonus: 0 };
const BULLET_IMPACT_PROFILES: Record<string, BulletImpactProfile> = {
  pistol: { shock: 14, knock: 560, shake: 120, hitBonus: 4 },
  rifle: { shock: 18, knock: 690, shake: 150, hitBonus: 6 },
  shotgun: { shock: 26, knock: 1180, shake: 260, hitBonus: 8 },
  railgun: { shock: 34, knock: 1500, shake: 320, hitBonus: 6 },
  minigun: { shock: 16, knock: 420, shake: 130, hitBonus: 8 },
  flame: { shock: 18, knock: 380, shake: 120, hitBonus: 10 },
  ice: { shock: 18, knock: 420, shake: 140, hitBonus: 8 },
  laser: { shock: 22, knock: 820, shake: 220, hitBonus: 6 },
  plasma: { shock: 24, knock: 960, shake: 240, hitBonus: 8 },
  bow: { shock: 20, knock: 760, shake: 170, hitBonus: 6 },
  crossbow: { shock: 22, knock: 880, shake: 190, hitBonus: 6 },
  spear: { shock: 24, knock: 960, shake: 210, hitBonus: 6 },
  boomerang: { shock: 20, knock: 820, shake: 160, hitBonus: 8 },
  axe: { shock: 24, knock: 960, shake: 220, hitBonus: 8 },
  chainsaw: { shock: 18, knock: 620, shake: 150, hitBonus: 10 },
  wand: { shock: 18, knock: 580, shake: 140, hitBonus: 8 },
  beam: { shock: 28, knock: 1180, shake: 260, hitBonus: 6 },
  lightning: { shock: 26, knock: 1100, shake: 240, hitBonus: 6 },
  cluster: { shock: 20, knock: 860, shake: 200, hitBonus: 6 },
  rocket: { shock: 30, knock: 1300, shake: 280, hitBonus: 10 },
  grenade: { shock: 22, knock: 900, shake: 200, hitBonus: 8 },
  bomb: { shock: 26, knock: 1200, shake: 240, hitBonus: 10 },
  enemy_bullet: { shock: 16, knock: 360, shake: 90, hitBonus: 4 },
};
  // Use weapon FX from imported module
  const WEAPON_FX = ParticleEffects.WEAPON_FX;

  const WEAPON_OFFSETS: Record<WeaponType, { grip: number; muzzle: number }> = {
    pistol: { grip: 10, muzzle: 24 },
    shotgun: { grip: 12, muzzle: 28 },
    rifle: { grip: 12, muzzle: 30 },
    rocket: { grip: 16, muzzle: 34 },
    minigun: { grip: 12, muzzle: 26 },
    railgun: { grip: 15, muzzle: 32 },
    flame: { grip: 10, muzzle: 22 },
    grenade: { grip: 11, muzzle: 24 },
    ice: { grip: 11, muzzle: 24 },
    laser: { grip: 13, muzzle: 30 },
    plasma: { grip: 12, muzzle: 28 },
    bow: { grip: 14, muzzle: 34 },
    crossbow: { grip: 14, muzzle: 32 },
    boomerang: { grip: 12, muzzle: 26 },
    wand: { grip: 11, muzzle: 24 },
    bomb: { grip: 15, muzzle: 32 },
    axe: { grip: 12, muzzle: 26 },
    spear: { grip: 14, muzzle: 34 },
    chainsaw: { grip: 12, muzzle: 26 },
    beam: { grip: 13, muzzle: 32 },
    lightning: { grip: 13, muzzle: 30 },
    cluster: { grip: 13, muzzle: 30 },
  };
  const getWeaponOffsets = (weapon?: WeaponType) => WEAPON_OFFSETS[weapon ?? "pistol"] || WEAPON_OFFSETS.pistol;
  const protonCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Load collision settings from JSON
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch(gamePath('/collision-settings.json?t=' + Date.now())); // Cache busting
        if (!response.ok) {
          console.warn('Collision settings file not found, using defaults');
          return;
        }
        const data = await response.json();
        console.log('Loaded collision settings:', data);
        collisionSettingsRef.current = data;
        forceRerender((n: number) => n + 1);
      } catch (err) {
        console.warn('Failed to load collision settings:', err);
      }
    };
    loadSettings();
  }, []);

  // Save collision settings to JSON
  const saveCollisionSettings = async () => {
    console.log('Saving collision settings:', collisionSettingsRef.current);
    
    try {
      const response = await fetch(gamePath('/api/save-collision-settings/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collisionSettingsRef.current)
      });
      
      const result = await response.json();
      
      if (response.ok) {
        alert('✅ Collision settings saved successfully!\n\nSettings:\n' + JSON.stringify(collisionSettingsRef.current, null, 2));
        // Reload settings to confirm
        setTimeout(() => window.location.reload(), 1000);
      } else {
        console.error('Save failed:', result);
        // Fallback: copy to clipboard
        const json = JSON.stringify(collisionSettingsRef.current, null, 2);
        await navigator.clipboard.writeText(json);
        alert('⚠️ API save failed. Settings copied to clipboard!\n\nManually paste into public/collision-settings.json:\n\n' + json);
      }
    } catch (err) {
      console.error('Save error:', err);
      // Fallback: copy to clipboard
      const json = JSON.stringify(collisionSettingsRef.current, null, 2);
      try {
        await navigator.clipboard.writeText(json);
        alert('⚠️ Save failed. Settings copied to clipboard!\n\nManually paste into public/collision-settings.json:\n\n' + json);
      } catch (clipErr) {
        alert('⚠️ Save failed and clipboard unavailable.\n\nManually copy these settings to public/collision-settings.json:\n\n' + json);
      }
    }
  };

  useEffect(() => {
      const canvas = canvasRef.current as HTMLCanvasElement | null;
      const protonCanvas = protonCanvasRef.current as HTMLCanvasElement | null;
      if (!canvas) return;
      if (!protonCanvas) return;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
      if (!ctx) return;
      const protonCtx = protonCanvas.getContext("2d") as CanvasRenderingContext2D | null;
      if (!protonCtx) return;

      // Guard against duplicate initialization (e.g., React StrictMode dev double-invoke)
      if ((canvas as any)._hvaiGameInit) return;
      (canvas as any)._hvaiGameInit = true;

      // Optimize canvas for sprite rendering once up-front
      ctx.imageSmoothingEnabled = false;
      (ctx as any).webkitImageSmoothingEnabled = false;
      (ctx as any).mozImageSmoothingEnabled = false;
      (ctx as any).msImageSmoothingEnabled = false;

      // Load stickman animations from deterministic asset URLs.
      const loadAnimations = async () => {
        const t0 = performance.now();
        console.log('[Platformer] Loading animations...');
        const useBitmap = 'createImageBitmap' in window;

        const fastLoad = async (url: string) => {
          if (useBitmap) {
            const r = await fetch(url, { cache: 'force-cache' });
            if (!r.ok) {
              throw new Error(`Failed to load ${url}: ${r.status}`);
            }
            return createImageBitmap(await r.blob());
          }
          const img = new Image();
          img.src = url;
          await img.decode();
          return img;
        };

        const animKeys = Object.keys(STICKMAN_ANIMS);
        const framesByAnim: Record<string, (HTMLImageElement | ImageBitmap)[]> = {};
        for (const key of animKeys) framesByAnim[key] = [];
        const loadFrame = async (key: string, def: StickmanAnimDef, frameIndex: number): Promise<boolean> => {
          const url = getStickmanFrameUrl(key, def, frameIndex);
          try {
            framesByAnim[key][frameIndex] = await fastLoad(url);
            return true;
          } catch (err) {
            console.warn(`[Animation] Missing frame ${key}[${frameIndex}] at ${url}`, err);
            return false;
          }
        };

        // CRITICAL animations (must load before game starts)
        const critical = ['unarmed_idle', 'unarmed_walk', 'unarmed_run', 'unarmed_jump', 'pistol_idle', 'pistol_shoot', 'pistol_walk', 'pistol_run', 'pistol_run_shoot'];
        
        console.log('[Platformer] Phase 1: Loading critical animations...');
        let phase1Done = 0;
        const phase1Total = critical.reduce((sum, k) => sum + (STICKMAN_ANIMS[k]?.frames || 0), 0);

        await Promise.all(critical.map(async (key) => {
          const def = STICKMAN_ANIMS[key];
          if (!def) return;
          const loadCriticalFrame = async (i: number) => {
            await loadFrame(key, def, i);
            phase1Done++;
          };
          
          // Load 100 frames in parallel
          for (let batch = 0; batch < def.frames; batch += 100) {
            await Promise.all(
              Array.from({ length: Math.min(100, def.frames - batch) }, (_, i) => loadCriticalFrame(batch + i))
            );
          }
        }));

        // Register loaded animations and mark ready
        for (const key of animKeys) {
          const def = STICKMAN_ANIMS[key];
          globalClips.clips[key] = {
            images: framesByAnim[key].filter(Boolean),
            fps: def.fps,
            loop: def.loop
          };
        }
        globalClips.ready = true;
        const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
        console.log(`[Platformer] Game ready! (${phase1Done}/${phase1Total} critical frames in ${elapsed}s)`);
        // PHASE 2: Background load remaining animations (non-blocking)
        const remaining = animKeys.filter(k => !critical.includes(k) && STICKMAN_ANIMS[k]);
        if (remaining.length > 0) {
          const bgTotal = remaining.reduce((sum, k) => sum + STICKMAN_ANIMS[k].frames, 0);
          console.log(`[Platformer] Phase 2: Loading ${bgTotal} background frames...`);
          
          setTimeout(async () => {
            let bgDone = 0;
            await Promise.all(remaining.map(async (key) => {
              const def = STICKMAN_ANIMS[key];
              await Promise.all(Array.from({ length: def.frames }, async (_, i) => {
                await loadFrame(key, def, i);
                bgDone++;
                if (bgDone % 100 === 0) console.log(`[Platformer] Background: ${bgDone}/${bgTotal}`);
              }));
              
              globalClips.clips[key].images = framesByAnim[key].filter(Boolean);
            }));
            
            const totalTime = ((performance.now() - t0) / 1000).toFixed(1);
            console.log(`[Platformer] All animations loaded! (${totalTime}s total)`);
          }, 100);
        }
      };

      loadAnimations().catch(err => console.error('[Platformer] Animation load error:', err));

    // Stats.js FPS overlay (dev only) - positioned bottom right
    const enableStats = process.env.NODE_ENV !== 'production';
    const stats = enableStats ? new Stats() : null;
    if (stats) {
      stats.showPanel(0);
      stats.dom.style.position = 'fixed';
      stats.dom.style.right = '8px';
      stats.dom.style.bottom = '8px';
      stats.dom.style.left = 'auto';
      stats.dom.style.top = 'auto';
      document.body.appendChild(stats.dom);
    }

    // Post-process buffers (settings via settingsRef)
    const post = document.createElement('canvas');
    const postCtx = post.getContext('2d') as CanvasRenderingContext2D;
    const post2 = document.createElement('canvas');
    const post2Ctx = post2.getContext('2d') as CanvasRenderingContext2D;
    const noise = document.createElement('canvas');
    const noiseCtx = noise.getContext('2d') as CanvasRenderingContext2D;
    const emojiTintCanvas = document.createElement('canvas');
    const emojiTintCtx = emojiTintCanvas.getContext('2d');

    // Weapon wheel state
    const wheel = wheelRef.current;
    const WEAPON_LIST: WeaponType[] = ['pistol','shotgun','rifle','rocket','minigun','railgun','flame','grenade','ice'];
    const WEAPON_EMOJI: Record<WeaponType, string> = {
      pistol: '??',
      shotgun: '??',
      rifle: '??',
      rocket: '??',
      minigun: '???',
      railgun: '?',
      flame: '??',
      grenade: '??',
      ice: '??',
      laser: '??',
      plasma: '??',
      bow: '??',
      crossbow: '??',
      boomerang: '??',
      wand: '??',
      bomb: '??',
      axe: '??',
      spear: '??',
      chainsaw: '??',
      beam: '??',
      lightning: '???',
      cluster: '??'
    };
    // transient FX for weapon recoil and muzzle
    let weaponKickMs = 0;
    let muzzleFxMs = 0;
    function drawEmojiSprite(text: string, x: number, y: number, size: number, tint = HUD_MONO_THEME.foreground) {
      if (!emojiTintCtx) {
      const prevFont = ctx.font;
        const prevFill = ctx.fillStyle;
      ctx.font = `${Math.floor(size)}px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, emoji, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
        ctx.fillStyle = tint;
      ctx.fillText(text, x, y);
        ctx.fillStyle = prevFill;
      ctx.font = prevFont;
        return;
      }

      const deviceRatio = typeof window !== 'undefined' ? Math.max(1, Math.min(3, window.devicePixelRatio || 1)) : 1;
      const bufferSize = Math.min(512, Math.max(32, Math.ceil(size * deviceRatio * 1.25)));

      if (emojiTintCanvas.width !== bufferSize || emojiTintCanvas.height !== bufferSize) {
        emojiTintCanvas.width = bufferSize;
        emojiTintCanvas.height = bufferSize;
      }

      emojiTintCtx.setTransform(1, 0, 0, 1, 0, 0);
      emojiTintCtx.clearRect(0, 0, bufferSize, bufferSize);
      emojiTintCtx.textAlign = 'center';
      emojiTintCtx.textBaseline = 'middle';
      const fontSize = Math.floor(bufferSize * 0.82);
      emojiTintCtx.font = `${fontSize}px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, emoji, sans-serif`;
      emojiTintCtx.fillStyle = '#ffffff';
      emojiTintCtx.globalAlpha = 1;
      emojiTintCtx.fillText(text, bufferSize / 2, bufferSize / 2 + bufferSize * 0.02);

      const prevComposite = emojiTintCtx.globalCompositeOperation;
      emojiTintCtx.globalCompositeOperation = 'source-in';
      emojiTintCtx.fillStyle = tint;
      emojiTintCtx.fillRect(0, 0, bufferSize, bufferSize);
      emojiTintCtx.globalCompositeOperation = prevComposite;

      ctx.drawImage(emojiTintCanvas, x - size / 2, y - size / 2, size, size);
    }
    function openWheel() { 
      // Only open wheel in gun mode
      if (player.animWeapon !== 'pistol') return;
      wheel.open = true; 
      wheel.hoverIndex = player.currentWeapon; 
    }
    function closeWheel(select = true) {
      if (wheel.open && select && player.weapons.length > 0) {
        // Only select from first 7 weapons (mapped to keys 4-0)
        const availableCount = Math.min(7, player.weapons.length);
        player.currentWeapon = Math.min(wheel.hoverIndex, availableCount - 1);
      }
      wheel.open = false;
    }
    function updateWheelHover(mx: number, my: number) {
      if (!wheel.open || player.weapons.length === 0) return;
      const cx = canvas.clientWidth / 2;
      const cy = canvas.clientHeight / 2;
      const ang = Math.atan2(my - cy, mx - cx);
      // Offset by -90 degrees to match our drawing (starts at top)
      let a = (ang + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
      // Only show first 7 weapons (mapped to keys 4-0)
      const availableCount = Math.min(7, player.weapons.length);
      const slice = (Math.PI * 2) / availableCount;
      const idx = Math.floor(a / slice);
      wheel.hoverIndex = idx % availableCount;
    }

    // Lightweight audio system (WebAudio + HTMLAudio for bgm)
    let audioCtx: AudioContext | null = null;
    let masterGain: GainNode | null = null;
    let musicEl: HTMLAudioElement | null = null;
    let fistPunchBuffer: AudioBuffer | null = null;
    let swordSliceBuffer: AudioBuffer | null = null;
    let gunShotBuffer: AudioBuffer | null = null;
    let plasmaGunBuffer: AudioBuffer | null = null;
    let explosionBuffer: AudioBuffer | null = null;
    let hitEffectBuffer: AudioBuffer | null = null;
    const weaponSoundLastPlay: Record<string, number> = {};
    type WeaponSoundEntry = { source: AudioBufferSourceNode; gain: GainNode; timeoutId: ReturnType<typeof setTimeout> | null };
    const weaponSoundPools: Record<string, WeaponSoundEntry[]> = {};
    function initAudio() {
      if (audioCtx) return;
      const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
      masterGain = (audioCtx as AudioContext).createGain();
      // Respect settings for sfx master (music handled separately on element)
      const sfxVol = settingsRef.current.audio.muted ? 0 : settingsRef.current.audio.sfxVolume;
      masterGain.gain.value = Math.max(0, Math.min(1, sfxVol));
      masterGain.connect((audioCtx as AudioContext).destination);
      // Background music disabled per request; leave element null to keep game silent.
      musicEl = null;
      // Load all weapon audio files
      const loadAudioFile = async (filename: string, bufferName: string) => {
        try {
          const audioPath = gamePath(`/models/Stickfigure%20Player/audio/${filename}`);
          console.log(`[Audio] Loading ${bufferName} from:`, audioPath);
          const response = await fetch(audioPath);
          if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          const decodedBuffer = await audioCtx!.decodeAudioData(arrayBuffer);
          console.log(`[Audio] ${bufferName} loaded successfully, duration:`, decodedBuffer.duration);
          return decodedBuffer;
        } catch (e) {
          console.error(`[Audio] Error loading ${bufferName}:`, e);
          return null;
        }
      };
      
      // Load all audio files in parallel
      Promise.all([
        loadAudioFile('sword_slice.mp3', 'sword slice').then(buf => { swordSliceBuffer = buf; }),
        loadAudioFile('gun shot sound.wav', 'gun shot').then(buf => { gunShotBuffer = buf; }),
        loadAudioFile('plasma gun shot.wav', 'plasma gun').then(buf => { plasmaGunBuffer = buf; }),
        loadAudioFile('explosion.mp3', 'explosion').then(buf => { explosionBuffer = buf; }),
        loadAudioFile('fist punch sound.mp3', 'fist punch').then(buf => { fistPunchBuffer = buf; }),
        loadAudioFile('hit_effect.wav', 'hit effect').then(buf => { hitEffectBuffer = buf; }),
      ]).then(() => {
        console.log('[Audio] All weapon sounds loaded successfully');
      });
    }
    const audioNow = () => (audioCtx ? audioCtx.currentTime : 0);
    const scheduleGainEnvelope = (gain: GainNode, now: number, peak: number, attackMs = 0, releaseMs = 120, durationMs = 120, sustainLevel?: number, sustainHoldMs?: number) => {
      const attack = Math.max(0, attackMs) / 1000;
      const release = Math.max(0, releaseMs) / 1000;
      const sustain = Math.max(0, sustainLevel ?? peak);
      const hold = Math.max(0, sustainHoldMs ?? 0) / 1000;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0.0001, now);
      const peakTime = now + attack;
      if (attack > 0) {
        gain.gain.exponentialRampToValueAtTime(Math.max(1e-4, peak), peakTime);
      } else {
        gain.gain.setValueAtTime(Math.max(1e-4, peak), now);
      }
      const sustainStart = peakTime + hold;
      const sustainDuration = Math.max(0, durationMs) / 1000;
      const sustainEnd = sustainStart + Math.max(0, sustainDuration - attack - hold);
      gain.gain.setValueAtTime(Math.max(1e-4, sustain), sustainStart);
      if (release > 0) {
        gain.gain.exponentialRampToValueAtTime(0.0001, sustainEnd + release);
      } else {
        gain.gain.setValueAtTime(0.0001, sustainEnd);
      }
    };
    const createDistortionCurve = (amount = 32) => {
      const k = Math.max(0, amount);
      const samples = 44100;
      const curve = new Float32Array(samples);
      const deg = Math.PI / 180;
      for (let i = 0; i < samples; ++i) {
        const x = (i * 2) / samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
      }
      return curve;
    };
    const playSynthPreset = (preset: SynthPreset) => {
      if (!audioCtx || !masterGain) return;
      if (settingsRef.current.audio.muted) return;
      const sfxScale = Math.max(0, Math.min(1, settingsRef.current.audio.sfxVolume));
      const now = audioNow();
      preset.forEach((layer) => {
        const startTime = now + (layer.delayMs ?? 0) / 1000;
        const duration = Math.max(10, layer.durationMs);
        const gainNode = audioCtx!.createGain();
        const peak = (layer.volume ?? 0.2) * sfxScale;
        scheduleGainEnvelope(gainNode, startTime, peak, layer.attackMs, layer.releaseMs, duration, layer.sustainLevel, layer.sustainHoldMs);

        if (layer.noise) {
          const bufferSize = Math.floor(0.5 * audioCtx!.sampleRate);
          const noiseBuffer = audioCtx!.createBuffer(1, bufferSize, audioCtx!.sampleRate);
          const output = noiseBuffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
          const src = audioCtx!.createBufferSource();
          src.buffer = noiseBuffer;
          const filter = audioCtx!.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.value = Math.max(100, layer.freq ?? 400);
          filter.Q.value = 0.6;
          src.connect(filter);
          filter.connect(gainNode);
          src.start(startTime);
          src.stop(startTime + duration / 1000);
          return;
        }

        const osc = audioCtx!.createOscillator();
        osc.type = layer.type ?? 'square';
        const baseFreq = layer.freq ?? 440;
        const variance = layer.freqVariance ?? 0;
        const freq = baseFreq + (variance ? (Math.random() * 2 - 1) * variance : 0);
        osc.frequency.setValueAtTime(Math.max(20, freq), startTime);
        if (layer.sweepTo !== undefined && layer.sweepMs !== undefined) {
          const sweepTarget = Math.max(20, layer.sweepTo);
          osc.frequency.exponentialRampToValueAtTime(sweepTarget, startTime + layer.sweepMs / 1000);
        }
        osc.connect(gainNode);
        osc.start(startTime);
        osc.stop(startTime + duration / 1000);

        let tailNode: AudioNode = gainNode;
        if (layer.distortion) {
          const dist = audioCtx!.createWaveShaper();
          dist.curve = createDistortionCurve(layer.distortion);
          dist.oversample = '4x';
          tailNode.connect(dist);
          tailNode = dist;
        }
        if (layer.phaserDepth || layer.phaserRateHz) {
          const phaserFilter = audioCtx!.createBiquadFilter();
          phaserFilter.type = 'allpass';
          const base = Math.max(40, layer.phaserBaseFreq ?? 700);
          phaserFilter.frequency.setValueAtTime(base, startTime);
          phaserFilter.Q.setValueAtTime(0.9, startTime);
          const lfo = audioCtx!.createOscillator();
          const lfoGain = audioCtx!.createGain();
          lfo.frequency.setValueAtTime(Math.max(0.05, layer.phaserRateHz ?? 0.6), startTime);
          lfoGain.gain.setValueAtTime(Math.max(0, layer.phaserDepth ?? 400), startTime);
          lfo.connect(lfoGain);
          lfoGain.connect(phaserFilter.frequency);
          lfo.start(startTime);
          lfo.stop(startTime + duration / 1000);
          tailNode.connect(phaserFilter);
          tailNode = phaserFilter;
        }
        if (layer.filterType) {
          const filter = audioCtx!.createBiquadFilter();
          filter.type = layer.filterType;
          filter.frequency.value = Math.max(40, layer.filterFreq ?? 800);
          if (layer.filterQ !== undefined) filter.Q.value = layer.filterQ;
          tailNode.connect(filter);
          tailNode = filter;
        }
        if (layer.pan !== undefined || layer.panVariance) {
          const panner = audioCtx!.createStereoPanner();
          const panValue = (layer.pan ?? 0) + (layer.panVariance ? (Math.random() * 2 - 1) * layer.panVariance : 0);
          panner.pan.value = Math.max(-1, Math.min(1, panValue));
          tailNode.connect(panner);
          tailNode = panner;
        }
        tailNode.connect(masterGain!);
      });
    };
    function playSynthWeapon(weapon: WeaponType) {
      const preset = WEAPON_SYNTH_PRESETS[weapon];
      if (!preset || preset.length === 0) return;
      playSynthPreset(preset);
    }
    const punchPreset: SynthPreset = [
      { type: 'square', freq: 280, sweepTo: 140, sweepMs: 120, durationMs: 180, volume: 0.28, attackMs: 2, releaseMs: 180, filterType: 'lowpass', filterFreq: 420, filterQ: 0.8, distortion: 38, sustainLevel: 0.18, sustainHoldMs: 30 },
      { noise: true, durationMs: 140, volume: 0.16, attackMs: 3, releaseMs: 160, freq: 240, filterQ: 0.9, panVariance: 0.15, distortion: 28 },
    ];
    const damagePreset: SynthPreset = [
      { type: 'square', freq: 320, sweepTo: 180, sweepMs: 200, durationMs: 220, volume: 0.24, attackMs: 8, releaseMs: 220, filterType: 'bandpass', filterFreq: 280, filterQ: 1.1, distortion: 26, sustainLevel: 0.16, sustainHoldMs: 40 },
      { noise: true, durationMs: 160, volume: 0.12, attackMs: 6, releaseMs: 180, freq: 360, filterQ: 0.8, panVariance: 0.2 },
    ];
    const powerPreset: SynthPreset = [
      { type: 'triangle', freq: 660, sweepTo: 880, sweepMs: 240, durationMs: 260, volume: 0.22, attackMs: 10, releaseMs: 220, filterType: 'bandpass', filterFreq: 820, filterQ: 1.2, phaserDepth: 220, phaserRateHz: 1.4, sustainLevel: 0.16, sustainHoldMs: 60 },
      { type: 'sine', freq: 1320, durationMs: 260, volume: 0.16, attackMs: 12, releaseMs: 240, filterType: 'highpass', filterFreq: 700, phaserDepth: 180, phaserRateHz: 1.8, panVariance: 0.25, delayMs: 60 },
    ];
    const coinPreset: SynthPreset = [
      { type: 'sine', freq: 880, sweepTo: 1320, sweepMs: 120, durationMs: 150, volume: 0.18, attackMs: 2, releaseMs: 120, filterType: 'highpass', filterFreq: 600, filterQ: 0.8 },
      { type: 'triangle', freq: 1760, durationMs: 140, volume: 0.12, attackMs: 3, releaseMs: 110, delayMs: 20 },
    ];
    function playWeaponAudio(weapon: WeaponType) {
      if (settingsRef.current.audio.muted) return;

      if (!audioCtx || !masterGain) {
        initAudio();
      }
      if (!audioCtx || !masterGain) return;

      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      
      const nowMs = audioCtx.currentTime * 1000;
      
      type WeaponAudioConfig = {
        key: string;
        buffer: AudioBuffer | null;
        volume: number;
        pitchMin: number;
        pitchMax: number;
        minIntervalMs?: number;
        maxDurationMs?: number;
        maxSimultaneous?: number;
      };
      
      const pickConfig = (w: WeaponType): WeaponAudioConfig | null => {
        switch (w) {
          case 'pistol':
          case 'bow':
          case 'crossbow':
            return { key: 'ballistic_light', buffer: gunShotBuffer, volume: 0.38, pitchMin: 0.95, pitchMax: 1.05, minIntervalMs: 130, maxDurationMs: 220, maxSimultaneous: 3 };
          case 'rifle':
            return { key: 'rifle', buffer: gunShotBuffer, volume: 0.35, pitchMin: 1.05, pitchMax: 1.15, minIntervalMs: 150, maxDurationMs: 240, maxSimultaneous: 3 };
          case 'shotgun':
            return { key: 'shotgun', buffer: gunShotBuffer, volume: 0.52, pitchMin: 0.85, pitchMax: 0.85, minIntervalMs: 320, maxDurationMs: 320, maxSimultaneous: 3 };
          case 'railgun':
            return { key: 'railgun', buffer: gunShotBuffer, volume: 0.45, pitchMin: 1.2, pitchMax: 1.2, minIntervalMs: 420, maxDurationMs: 360, maxSimultaneous: 2 };
          case 'minigun':
            return { key: 'minigun', buffer: gunShotBuffer, volume: 0.28, pitchMin: 0.94, pitchMax: 1.08, minIntervalMs: 60, maxDurationMs: 140, maxSimultaneous: 4 };
          case 'flame':
            return { key: 'flamethrower', buffer: plasmaGunBuffer, volume: 0.22, pitchMin: 0.88, pitchMax: 0.98, minIntervalMs: 30, maxDurationMs: 120, maxSimultaneous: 8 };
          case 'plasma':
          case 'ice':
          case 'wand':
            return { key: 'plasma', buffer: plasmaGunBuffer, volume: 0.38, pitchMin: 0.95, pitchMax: 1.05, minIntervalMs: 180, maxDurationMs: 260, maxSimultaneous: 3 };
          case 'laser':
            return { key: 'laser', buffer: plasmaGunBuffer, volume: 0.32, pitchMin: 1.1, pitchMax: 1.2, minIntervalMs: 120, maxDurationMs: 220, maxSimultaneous: 4 };
          case 'beam':
          case 'lightning':
            return { key: 'beam', buffer: plasmaGunBuffer, volume: 0.42, pitchMin: 0.8, pitchMax: 0.95, minIntervalMs: 200, maxDurationMs: 300, maxSimultaneous: 3 };
          case 'rocket':
            return { key: 'rocket', buffer: explosionBuffer, volume: 0.48, pitchMin: 0.9, pitchMax: 0.95, minIntervalMs: 400, maxDurationMs: 450, maxSimultaneous: 3 };
          case 'grenade':
            return { key: 'grenade', buffer: explosionBuffer, volume: 0.46, pitchMin: 0.88, pitchMax: 0.96, minIntervalMs: 420, maxDurationMs: 420, maxSimultaneous: 3 };
          case 'bomb':
            return { key: 'bomb', buffer: explosionBuffer, volume: 0.5, pitchMin: 0.8, pitchMax: 0.9, minIntervalMs: 500, maxDurationMs: 500, maxSimultaneous: 2 };
          case 'cluster':
            return { key: 'cluster', buffer: explosionBuffer, volume: 0.44, pitchMin: 0.9, pitchMax: 1.0, minIntervalMs: 280, maxDurationMs: 320, maxSimultaneous: 4 };
          default:
            return null;
        }
      };
      
      const config = pickConfig(weapon);
      if (!config) {
        playSynthWeapon(weapon);
        return;
      }
      if (!config.buffer) {
        playSynthWeapon(weapon);
        return;
      }
      
      if (config.minIntervalMs) {
        const lastTime = weaponSoundLastPlay[config.key];
        if (lastTime !== undefined && nowMs - lastTime < config.minIntervalMs) return;
      }

      const poolKey = config.key;
      const pool = (weaponSoundPools[poolKey] = weaponSoundPools[poolKey] || []);
      const maxSimultaneous = config.maxSimultaneous ?? 3;

      if (pool.length >= maxSimultaneous) {
        const oldest = pool.shift();
        if (oldest) {
          if (oldest.timeoutId) clearTimeout(oldest.timeoutId);
          try {
            oldest.source.stop();
          } catch (err) {
            console.warn('[Audio] Failed to stop oldest weapon sound', err);
          }
        }
      }
      
      try {
        const source = audioCtx.createBufferSource();
        source.buffer = config.buffer;
        const pitch = config.pitchMin === config.pitchMax
          ? config.pitchMin
          : config.pitchMin + Math.random() * (config.pitchMax - config.pitchMin);
        source.playbackRate.value = pitch;
        
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = config.volume;
        
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const entry = { source, gain: gainNode, timeoutId: null as ReturnType<typeof setTimeout> | null };

        source.onended = () => {
          if (entry.timeoutId) {
            clearTimeout(entry.timeoutId);
            entry.timeoutId = null;
          }
          const arr = weaponSoundPools[poolKey];
          if (arr) {
            const idx = arr.findIndex((item) => item.source === source);
          if (idx >= 0) arr.splice(idx, 1);
          }
          try { source.disconnect(); } catch {}
          try { gainNode.disconnect(); } catch {}
        };

        source.connect(gainNode);
        gainNode.connect(masterGain);

        const startTime = audioCtx.currentTime;
        const totalDuration = config.maxDurationMs ? Math.min(config.buffer.duration, config.maxDurationMs / 1000) : config.buffer.duration;
        const loopOffset = poolKey === 'flamethrower' ? Math.random() * Math.max(0, config.buffer.duration - totalDuration) : 0;

        if (config.maxDurationMs) {
          source.start(startTime, loopOffset, totalDuration);
          timeoutId = setTimeout(() => {
              try {
                source.stop();
              } catch (err) {
                console.warn('[Audio] Error stopping weapon sound source', err);
            }
          }, config.maxDurationMs + 20);
          entry.timeoutId = timeoutId;
        } else {
          source.start(startTime, loopOffset);
        }

        weaponSoundLastPlay[poolKey] = nowMs;
        pool.push(entry);
      } catch (e) {
        console.error('[Audio] Error playing weapon audio:', e);
      }
    }
    
    function playShoot(weapon: WeaponType) {
      playWeaponAudio(weapon);
    }
    function playPunch() {
      if (!audioCtx || !masterGain) {
      playSynthPreset(punchPreset);
        return;
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      if (!fistPunchBuffer) {
        playSynthPreset(punchPreset);
        return;
      }
      try {
        const source = audioCtx.createBufferSource();
        source.buffer = fistPunchBuffer;
        source.playbackRate.value = 0.95 + Math.random() * 0.1;
        const gainNode = audioCtx.createGain();
        const sfxScale = Math.max(0, Math.min(1, settingsRef.current.audio.sfxVolume));
        gainNode.gain.value = 0.48 * sfxScale;
        const panner = audioCtx.createStereoPanner();
        panner.pan.value = Math.random() * 0.2 - 0.1;
        source.connect(panner);
        panner.connect(gainNode);
        gainNode.connect(masterGain);
        source.start(audioCtx.currentTime);
      } catch (err) {
        console.warn('[Audio] Falling back to synth punch', err);
        playSynthPreset(punchPreset);
      }
    }
    function playMeleeImpact() {
      if (!audioCtx || !masterGain) return;
      if (settingsRef.current.audio.muted) return;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      if (!fistPunchBuffer) return;
      try {
        const sfxScale = Math.max(0, Math.min(1, settingsRef.current.audio.sfxVolume));
        const source = audioCtx.createBufferSource();
        source.buffer = fistPunchBuffer;
        // Slower playback for heavier impact
        source.playbackRate.value = 0.7 + Math.random() * 0.15;
        
        // Create distortion for impact
        const distortion = audioCtx.createWaveShaper();
        distortion.curve = createDistortionCurve(80);
        distortion.oversample = '4x';
        
        // Add some compression for punch
        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -20;
        compressor.knee.value = 10;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.001;
        compressor.release.value = 0.05;
        
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.6 * sfxScale;
        
        const panner = audioCtx.createStereoPanner();
        panner.pan.value = (Math.random() - 0.5) * 0.3;
        
        source.connect(distortion);
        distortion.connect(compressor);
        compressor.connect(panner);
        panner.connect(gainNode);
        gainNode.connect(masterGain);
        source.start(audioCtx.currentTime);
      } catch (err) {
        console.warn('[Audio] Error playing melee impact:', err);
      }
    }
    function playSwordSlice() {
      console.log('[Audio] playSwordSlice called, audioCtx:', !!audioCtx, 'buffer:', !!swordSliceBuffer, 'masterGain:', !!masterGain);
      if (audioCtx && swordSliceBuffer && masterGain) {
        try {
          const source = audioCtx.createBufferSource();
          source.buffer = swordSliceBuffer;
          source.connect(masterGain);
          source.start(audioCtx.currentTime);
          console.log('[Audio] Sword slice playing at time:', audioCtx.currentTime);
        } catch (e) {
          console.error('[Audio] Error playing sword slice:', e);
        }
      } else {
        console.warn('[Audio] Cannot play sword slice - missing requirements');
      }
    }
    function playMeleeSwingSound(type: 'punch' | 'kick' | 'sword') {
      if (type === 'sword') {
        playSwordSlice();
      } else {
        playPunch();
      }
    }
    function playDamage() {
      playSynthPreset(damagePreset);
    }
    function playPowerUp() {
      playSynthPreset(powerPreset);
    }
    function playCoin() {
      playSynthPreset(coinPreset);
    }
    function playExplosion(vol = 0.35) {
      if (!audioCtx || !masterGain) return;
      if (settingsRef.current.audio.muted) return;
      const sfxScale = Math.max(0, Math.min(1, settingsRef.current.audio.sfxVolume));
      const now = audioNow();
      const peak = Math.max(0.01, vol) * sfxScale;

      const mainGain = audioCtx.createGain();
      mainGain.connect(masterGain);
      scheduleGainEnvelope(mainGain, now, peak, 10, 540, 640, peak * 0.6, 120);

      const bufferSize = Math.floor(0.7 * audioCtx.sampleRate);
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        const t = i / bufferSize;
        const decay = Math.pow(1 - t, 1.4);
        noiseData[i] = (Math.random() * 2 - 1) * decay;
      }

      const noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      const bandPass = audioCtx.createBiquadFilter();
      bandPass.type = 'bandpass';
      bandPass.frequency.setValueAtTime(360, now);
      bandPass.Q.setValueAtTime(0.8, now);

      const waveShaper = audioCtx.createWaveShaper();
      waveShaper.curve = createDistortionCurve(48);
      waveShaper.oversample = '4x';

      const phaser = audioCtx.createBiquadFilter();
      phaser.type = 'allpass';
      phaser.frequency.setValueAtTime(520, now);
      const phaserLfo = audioCtx.createOscillator();
      const phaserDepth = audioCtx.createGain();
      phaserLfo.frequency.setValueAtTime(1.4, now);
      phaserDepth.gain.setValueAtTime(320, now);
      phaserLfo.connect(phaserDepth);
      phaserDepth.connect(phaser.frequency);
      phaserLfo.start(now);
      phaserLfo.stop(now + 0.8);

      const lowPass = audioCtx.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.frequency.setValueAtTime(2600, now);

      const tremolo = audioCtx.createGain();
      const tremoloLfo = audioCtx.createOscillator();
      tremolo.gain.setValueAtTime(1, now);
      tremoloLfo.frequency.setValueAtTime(8.5, now);
      const tremoloDepth = audioCtx.createGain();
      tremoloDepth.gain.setValueAtTime(0.55, now);
      tremoloLfo.connect(tremoloDepth);
      tremoloDepth.connect(tremolo.gain);
      tremoloLfo.start(now);
      tremoloLfo.stop(now + 0.8);

      noiseSource.connect(bandPass);
      bandPass.connect(waveShaper);
      waveShaper.connect(phaser);
      phaser.connect(lowPass);
      lowPass.connect(tremolo);
      tremolo.connect(mainGain);

      noiseSource.start(now);
      noiseSource.stop(now + 0.7);

      const subOsc = audioCtx.createOscillator();
      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(70, now);
      subOsc.frequency.exponentialRampToValueAtTime(42, now + 0.6);
      const subGain = audioCtx.createGain();
      subGain.connect(masterGain);
      scheduleGainEnvelope(subGain, now, peak * 0.8, 12, 620, 520, peak * 0.45, 140);
      subOsc.connect(subGain);
      subOsc.start(now);
      subOsc.stop(now + 0.65);
      const crackle = audioCtx.createOscillator();
      crackle.type = 'square';
      crackle.frequency.setValueAtTime(360, now);
      crackle.frequency.exponentialRampToValueAtTime(620, now + 0.25);
      const crackleGain = audioCtx.createGain();
      crackleGain.connect(masterGain);
      scheduleGainEnvelope(crackleGain, now, peak * 0.18, 4, 300, 240, peak * 0.1, 40);
      crackle.connect(crackleGain);
      crackle.start(now);
      crackle.stop(now + 0.3);
    }
    function playHitEffect() {
      if (!audioCtx || !masterGain) return;
      if (settingsRef.current.audio.muted) return;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      if (!hitEffectBuffer) {
        return;
      }
      try {
        const sfxScale = Math.max(0, Math.min(1, settingsRef.current.audio.sfxVolume));
        const source = audioCtx.createBufferSource();
        source.buffer = hitEffectBuffer;
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.5 * sfxScale;
        source.connect(gainNode);
        gainNode.connect(masterGain);
        source.start(audioNow());
      } catch (err) {
        console.warn('[Audio] Error playing hit effect:', err);
      }
    }

    // DPR-aware sizing
    const resize = () => {
      const dpr = Math.max(1, Math.min(2, (window.devicePixelRatio || 1)));
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Post-process buffer sizes
      const retro = settingsRef.current.retro;
      post.width = Math.max(1, Math.floor(canvas.width / retro.pixelScale));
      post.height = Math.max(1, Math.floor(canvas.height / retro.pixelScale));
      post2.width = post.width;
      post2.height = post.height;
    };
    resize();
    window.addEventListener("resize", resize);

    // World & Systems
    const perlin = new Perlin1D(20250502);

    const world = {
      gravity: 2200,
      moveSpeed: 400,        // Base move speed (simplified from acceleration system)
      runMultiplier: 1.5,    // Run speed multiplier when shift is held
      jumpVelocity: -920,
      noiseScale: 0.0008,
      terrainAmplitude: 25, // Reduced from 80 to not block cityscape
      baseGroundY: 680, // Raised from 850 to prevent bottom HUD from covering walkable area
    };
    // Hysteresis thresholds for smooth state transitions (prevents flickering)
    const WALK_ENTER = 30;    // Start walking at this speed
    const WALK_EXIT = 10;     // Stop walking below this speed
    const RUN_ENTER = 180;    // Start running at this speed
    const RUN_EXIT = 140;     // Stop running below this speed
    // Difficulty tuning
    const diff = gameConfigRef.current.difficulty;
    const diffMul = diff === 'Easy' ? { enemyHp: 0.85, enemyDmg: 0.85, spawn: 1.15, playerMaxHp: 120 } : diff === 'Hard' ? { enemyHp: 1.3, enemyDmg: 1.3, spawn: 0.9, playerMaxHp: 90 } : { enemyHp: 1.0, enemyDmg: 1.0, spawn: 1.0, playerMaxHp: 100 };
    // Camera (offset to match spawn position to avoid black square rendering bug)
    const initialCameraX = currentMapRef.current.id === 'rooftop-sunset' && currentMapRef.current.spawnPoints?.[0] 
      ? currentMapRef.current.spawnPoints[0].x - 200
      : 1720;
    const camera = { x: initialCameraX, y: 0, lerp: 0.12 };
    const cameraShake = { ms: 0, magnitude: 0 };
    let hitPause = { ms: 0, totalMs: 0 }; // Hit pause for impact
    let screenFlash = { alpha: 0, color: '#ffffff' }; // Screen flash on hit
    let zoomEffect = { scale: 1.0, targetScale: 1.0 }; // Dynamic zoom
    let damageEdgePulse = { alpha: 0, maxAlpha: 0 }; // Red edge pulse when damaged
    
    // Player
    const player: Character = {
      name: "",
      position: { x: 0, y: 0 } as Vector,
      velocity: { x: 0, y: 0 } as Vector,
      radius: 22,
      facing: 1,
      onGround: false,
      canDoubleJump: false,
      shootCooldownMs: 0,
      hp: diffMul.playerMaxHp,
      maxHp: diffMul.playerMaxHp,
      invulnMs: 0,
      currentWeapon: 0,
      weapons: [
        WEAPONS.pistol, WEAPONS.shotgun, WEAPONS.rifle, WEAPONS.rocket, WEAPONS.minigun, WEAPONS.railgun,
        WEAPONS.flame, WEAPONS.grenade, WEAPONS.ice, WEAPONS.laser, WEAPONS.plasma, WEAPONS.bow,
        WEAPONS.crossbow, WEAPONS.boomerang, WEAPONS.wand, WEAPONS.bomb, WEAPONS.axe, WEAPONS.spear
      ] as Weapon[],
      score: 0,
      kills: 0,
      
      // Animation state
      animKey: "unarmed_idle",
      animFrame: 0,
      animHoldUntilEnd: false,
      smoothedVelocityX: 0,
      previousVelocityX: 0,
      wasRunning: false,
      currentMotionState: 'idle' as 'idle' | 'walk' | 'run',
      animWeapon: 'unarmed' as 'unarmed' | 'pistol' | 'sword',
      // Attack state tracking
      attackCooldown: 0,
      jabPressed: false,
      kickHighPressed: false,
      kickLowPressed: false,
      reverseKickPressed: false,
      uppercutPressed: false,
      saltoKickPressed: false,
      jabHighDoublePressed: false,
      ammo: 60,
      maxAmmo: 120,
      shootPressed: false,
      slashPressed: false,
      blockPressed: false,
      bloodOverlay: 0,
      isPlayer: true,
    };

    // Systems
    const input: CharacterInput = createCharacterInput();
    // Removed debug preview cycling to keep production clean
    const MAX_PARTICLES = 1600;
    const MAX_BULLETS = 900;
    const MAX_DYNAMIC_LIGHTS = 120;
    const SPAWN_OFFSET_X = 1920; // Offset spawn position to avoid black square issue at x=0
    const MAX_SCORCH_DECALS = 140;
    const MAX_AFTERIMAGES = 90;
    const MAX_LIGHTNING_ARCS = 80;
    const bullets: Bullet[] = [];
    const particles: Particle[] = [];
    const platforms: Platform[] = [];
    
    // ===== PERFORMANCE: Spatial Hash Grids for Collision Detection =====
    const enemyGrid = new SpatialHashGrid<Enemy>(200);
    const platformGrid = new SpatialHashGrid<Platform>(300);
    
    // ===== PERFORMANCE: Platform ImageBitmap Caching System =====
    const platformCacheManager = new PlatformCacheManager(240);
    const clearPlatformRenderCache = () => {
      platformCacheManager.clear();
    };
    
    const enemies: Enemy[] = [];
    const pickups: { type: 'medkit' | 'shield' | 'overdrive' | 'ammo' | 'coin'; x: number; y: number; value?: number }[] = [];
    
    // Map-specific state
    let suburbiaState: SuburbiaState | null = null;
    let metropolisState: MetropolisState | null = null;
    let rooftopsState: RooftopsState | null = null;
    type WaveSpawnEntry = { type?: EnemyType; delayMs: number };
    // Waves and score/combo
    let wave = 1;
    let waveTimerMs = 0;
    let waveInProgress = true;
    let waveNeedsSetup = true;
    let waveSpawnQueue: WaveSpawnEntry[] = [];
    let waveMaxConcurrent = 2; // Start with 1-2 enemies at a time
    let waveInitialCount = 0;
    let combo = 0;
    let comboTimerMs = 0;
    // Progressive spawning based on player movement
    let lastSpawnX = SPAWN_OFFSET_X;
    let progressionDistance = 800; // Distance player needs to move forward to trigger new spawns
    // Movement state tracking (for run-stop detection and smooth transitions)
    let previousVelocityX = 0;
    let smoothedVelocityX = 0;
    let wasShiftHeld = false; // Track if shift was held while running
    let currentMotionState: 'idle' | 'walk' | 'run' = 'idle';

    // Shields/overdrive
    let playerShield = 0; // temporary shield points
    let overdriveMs = 0; // boosts fire rate/damage for a short time
    let hitstopMs = 0;   // brief slow-mo on impactful events
    let totalTimeMs = 0; // for sky cycles and bob
    let lives = 3; // player lives for health system
    // Jetpack removed

    // Jump assist (coyote time + jump buffer)
    const coyoteTimeWindowMs = 110;
    const jumpBufferWindowMs = 140;
    let coyoteMs = 0;
    let jumpBufferedMs = 0;

    // World deco and FX state
    const stars = Array.from({ length: 140 }, () => ({
      x: Math.random(), // screen-space normalized; parallax applied
      y: Math.random(),
      a: 0.6 + Math.random() * 0.4,
      s: Math.random() * 1.2 + 0.3,
    }));
    const rainDrops: { x: number; y: number; vy: number }[] = [];
    function ensureRain() {
      if (!settingsRef.current.visual.rain) return;
      while (rainDrops.length < 220) {
        rainDrops.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, vy: 900 + Math.random() * 600 });
      }
    }
    const floatingTexts: { x: number; y: number; vx: number; vy: number; life: number; text: string; color: string; size?: number }[] = [];
    function spawnText(x: number, y: number, text: string, color = '#ff9966', size = 12) {
      floatingTexts.push({ x, y, vx: (Math.random() - 0.5) * 40, vy: -120 - Math.random() * 60, life: 900, text, color, size });
    }

    // Minimap canvas buffer
    const mini = document.createElement('canvas');
    const miniCtx = mini.getContext('2d') as CanvasRenderingContext2D;
    mini.width = 180;
    mini.height = 120;

    // FX and meta
    const shockwaves: { x: number; y: number; r: number; lifeMs: number; thickness: number; color: string }[] = [];
    const railBeams: { x1: number; y1: number; x2: number; y2: number; lifeMs: number }[] = [];
    const scorchDecals: { x: number; y: number; r: number; a: number }[] = [];
    const dynamicLights: { x: number; y: number; r: number; color: string; a: number; decay: number }[] = [];
    const casings: { x: number; y: number; vx: number; vy: number; rot: number; vr: number; life: number; size: number; color: string }[] = [];
    const afterimages: { x: number; y: number; age: number; max: number }[] = [];
    let afterimageTimerMs = 0;
    const lightningArcs: { points: number[]; lifeMs: number }[] = [];
    // cityscapeCache moved to rooftops.ts (module-level cache)
    const skyGradientCache = { key: '', gradient: null as CanvasGradient | null };

    const pushParticle = (p: Particle) => {
      particles.push(p);
      if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    };

    const pushDynamicLight = (l: { x: number; y: number; r: number; color: string; a: number; decay: number }) => {
      dynamicLights.push(l);
      if (dynamicLights.length > MAX_DYNAMIC_LIGHTS) dynamicLights.splice(0, dynamicLights.length - MAX_DYNAMIC_LIGHTS);
    };

    const pushLightningArc = (arc: { points: number[]; lifeMs: number }) => {
      lightningArcs.push(arc);
      if (lightningArcs.length > MAX_LIGHTNING_ARCS) lightningArcs.splice(0, lightningArcs.length - MAX_LIGHTNING_ARCS);
    };

    // ========== Proton.js Particle System ==========
    const proton = new Proton.default();
    const protonRenderer = new Proton.CanvasRenderer(protonCanvas);
    proton.addRenderer(protonRenderer);

    // Helper to create hit impact burst emitter
    const createArcaneBurst = (x: number, y: number, intensity: number = 1) => {
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(new Proton.Span(24 * intensity, 36 * intensity), new Proton.Span(0.01));
      emitter.addInitialize(new Proton.Mass(1));
      emitter.addInitialize(new Proton.Life(0.45, 0.7));
      emitter.addInitialize(new Proton.Body(new Proton.CircleZone(2, 4)));
      emitter.addInitialize(new Proton.Radius(2.5, 6 * intensity));
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(220 * intensity, 360 * intensity), new Proton.Span(0, 360), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(1, 0));
      emitter.addBehaviour(new Proton.Scale(1.3, 0.1));
      emitter.addBehaviour(new Proton.Color(['#6dd6ff', '#7f5bff', '#ffffff']));
      emitter.addBehaviour(new Proton.RandomDrift(18, 18, 0.08));
      emitter.addBehaviour(new Proton.Attraction(new Proton.Vector2D(x, y - 40), 4, 120));
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => proton.removeEmitter(emitter), 1000);
    };

    // Helper for directional arcane slash trail
    const createArcaneSlashTrail = (x: number, y: number, angle: number, length: number) => {
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(new Proton.Span(30, 40), new Proton.Span(0.05));
      emitter.addInitialize(new Proton.Mass(1));
      emitter.addInitialize(new Proton.Life(0.25, 0.45));
      emitter.addInitialize(new Proton.Body(new Proton.CircleZone(1, 2)));
      emitter.addInitialize(new Proton.Radius(3, 7));
      const angleMin = (angle * 180 / Math.PI) - 30;
      const angleMax = (angle * 180 / Math.PI) + 30;
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(300, 500), new Proton.Span(angleMin, angleMax), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(1, 0));
      emitter.addBehaviour(new Proton.Scale(1.5, 0.2));
      emitter.addBehaviour(new Proton.Color(['#b9a9ff', '#6dd6ff', '#ffffff']));
      emitter.addBehaviour(new Proton.RandomDrift(12, 12, 0.06));
      emitter.addBehaviour(new Proton.Attraction(new Proton.Vector2D(x + Math.cos(angle) * length * 0.6, y + Math.sin(angle) * length * 0.6), 3, length));
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => proton.removeEmitter(emitter), 800);
    };

    // Helper for sparks (metal impacts)
    const createSparks = (x: number, y: number, direction: number) => {
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(new Proton.Span(15, 25), new Proton.Span(0.01));
      emitter.addInitialize(new Proton.Mass(1));
      emitter.addInitialize(new Proton.Life(0.4, 0.7));
      emitter.addInitialize(new Proton.Body(new Proton.CircleZone(1, 1)));
      emitter.addInitialize(new Proton.Radius(1.5, 3));
      const angleMin = (direction * 180 / Math.PI) - 45;
      const angleMax = (direction * 180 / Math.PI) + 45;
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(250, 450), new Proton.Span(angleMin, angleMax), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(1, 0));
      emitter.addBehaviour(new Proton.Color('#ff4444', '#cc2222'));
      emitter.addBehaviour(new Proton.Gravity(800));
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => proton.removeEmitter(emitter), 1000);
    };
    // Helper for blood spray
    const createBloodSpray = (x: number, y: number, direction: number) => {
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(new Proton.Span(10, 18), new Proton.Span(0.01));
      emitter.addInitialize(new Proton.Mass(1));
      emitter.addInitialize(new Proton.Life(0.5, 0.9));
      emitter.addInitialize(new Proton.Body(new Proton.CircleZone(2, 3)));
      emitter.addInitialize(new Proton.Radius(2, 4));
      const angleMin = (direction * 180 / Math.PI) - 40;
      const angleMax = (direction * 180 / Math.PI) + 40;
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(150, 300), new Proton.Span(angleMin, angleMax), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(0.9, 0));
      emitter.addBehaviour(new Proton.Scale(1, 0.3));
      emitter.addBehaviour(new Proton.Color('#8b0000', '#4a0000'));
      emitter.addBehaviour(new Proton.Gravity(1200));
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => proton.removeEmitter(emitter), 1200);
    };
    // Advanced: Explosion with shockwave particles
    const createExplosionBurst = (x: number, y: number, radius: number, color1: string, color2: string) => {
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(new Proton.Span(60, 80), new Proton.Span(0.01));
      emitter.addInitialize(new Proton.Mass(1));
      emitter.addInitialize(new Proton.Life(0.4, 0.9));
      emitter.addInitialize(new Proton.Body(new Proton.CircleZone(3, 6)));
      emitter.addInitialize(new Proton.Radius(2, 5));
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(300, 600), new Proton.Span(0, 360), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(1, 0));
      emitter.addBehaviour(new Proton.Scale(1.5, 0.1));
      emitter.addBehaviour(new Proton.Color(color1, color2));
      emitter.addBehaviour(new Proton.Gravity(1500));
      emitter.addBehaviour(new Proton.RandomDrift(20, 20, 0.1));
      // Add repulsion from center for more dynamic spread
      const repulsionPoint = new Proton.Vector2D(x, y);
      emitter.addBehaviour(new Proton.Repulsion(repulsionPoint, 10, radius * 3));
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => proton.removeEmitter(emitter), 1500);
    };

    // Weapon-specific: Muzzle flash with realistic gun smoke
    const createMuzzleFlash = (x: number, y: number, angle: number, weaponType: string) => {
      const fx = WEAPON_FX[weaponType] || WEAPON_FX.pistol;
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(new Proton.Span(8, 15), new Proton.Span(0.01));
      emitter.addInitialize(new Proton.Mass(1));
      emitter.addInitialize(new Proton.Life(0.15, 0.35));
      emitter.addInitialize(new Proton.Body(new Proton.CircleZone(1, 2)));
      emitter.addInitialize(new Proton.Radius(3, 7));
      const angleMin = (angle * 180 / Math.PI) - 25;
      const angleMax = (angle * 180 / Math.PI) + 25;
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(200, 400), new Proton.Span(angleMin, angleMax), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(0.8, 0));
      emitter.addBehaviour(new Proton.Scale(0.5, 2));
      emitter.addBehaviour(new Proton.Color(fx.muzzleColor, fx.sparkColor));
      emitter.addBehaviour(new Proton.RandomDrift(30, 30, 0.15));
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => proton.removeEmitter(emitter), 500);
    };

    // Continuous emitter for flame weapons
    const createFlameStream = (x: number, y: number, angle: number, durationMs: number) => {
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(new Proton.Span(40, 60), new Proton.Span(0.016)); // ~60fps
      emitter.addInitialize(new Proton.Mass(0.5));
      emitter.addInitialize(new Proton.Life(0.2, 0.5));
      emitter.addInitialize(new Proton.Body(new Proton.CircleZone(2, 4)));
      emitter.addInitialize(new Proton.Radius(4, 8));
      const angleMin = (angle * 180 / Math.PI) - 15;
      const angleMax = (angle * 180 / Math.PI) + 15;
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(250, 400), new Proton.Span(angleMin, angleMax), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(0.9, 0));
      emitter.addBehaviour(new Proton.Scale(0.8, 1.5));
      emitter.addBehaviour(new Proton.Color(['#ff4400', '#ff8800', '#ffaa00', '#ff6600']));
      emitter.addBehaviour(new Proton.RandomDrift(40, 40, 0.2));
      emitter.addBehaviour(new Proton.Gravity(-100)); // slight upward drift like fire
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => {
        emitter.stop();
        setTimeout(() => proton.removeEmitter(emitter), 600);
      }, durationMs);
      return emitter;
    };

    // Energy beam particles with attraction to beam line
    const createBeamParticles = (x: number, y: number, angle: number, length: number, color: string) => {
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(new Proton.Span(25, 35), new Proton.Span(0.02));
      emitter.addInitialize(new Proton.Mass(0.8));
      emitter.addInitialize(new Proton.Life(0.15, 0.3));
      emitter.addInitialize(new Proton.Body(new Proton.CircleZone(1, 2)));
      emitter.addInitialize(new Proton.Radius(2, 4));
      const angleMin = (angle * 180 / Math.PI) - 8;
      const angleMax = (angle * 180 / Math.PI) + 8;
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(400, 600), new Proton.Span(angleMin, angleMax), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(1, 0));
      emitter.addBehaviour(new Proton.Scale(1, 0.3));
      emitter.addBehaviour(new Proton.Color(color, '#ffffff'));
      // Add attraction to end point for tight beam effect
      const endX = x + Math.cos(angle) * length;
      const endY = y + Math.sin(angle) * length;
      const attractPoint = new Proton.Vector2D(endX, endY);
      emitter.addBehaviour(new Proton.Attraction(attractPoint, 5, length * 1.5));
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => proton.removeEmitter(emitter), 500);
    };

    // Ice/frost particles with crystalline effect
    const createIceBurst = (x: number, y: number, radius: number) => {
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(new Proton.Span(30, 45), new Proton.Span(0.01));
      emitter.addInitialize(new Proton.Mass(1.2));
      emitter.addInitialize(new Proton.Life(0.6, 1.2));
      emitter.addInitialize(new Proton.Body(new Proton.CircleZone(1, 3)));
      emitter.addInitialize(new Proton.Radius(2, 5));
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(150, 300), new Proton.Span(0, 360), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(0.9, 0));
      emitter.addBehaviour(new Proton.Scale(0.5, 1.2));
      emitter.addBehaviour(new Proton.Color(['#aaddff', '#66ccff', '#88eeff', '#ccffff']));
      emitter.addBehaviour(new Proton.Gravity(800));
      emitter.addBehaviour(new Proton.RandomDrift(15, 15, 0.08));
      // Rotate behavior for crystalline sparkle effect
      emitter.addBehaviour(new Proton.Rotate('random', 'random'));
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => proton.removeEmitter(emitter), 1500);
    };

    // Plasma/energy particles with glow and oscillation
    const createPlasmaImpact = (x: number, y: number, color: string) => {
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(new Proton.Span(35, 50), new Proton.Span(0.01));
      emitter.addInitialize(new Proton.Mass(0.6));
      emitter.addInitialize(new Proton.Life(0.3, 0.7));
      emitter.addInitialize(new Proton.Body(new Proton.CircleZone(2, 4)));
      emitter.addInitialize(new Proton.Radius(3, 6));
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(200, 450), new Proton.Span(0, 360), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(1, 0));
      emitter.addBehaviour(new Proton.Scale(1.2, 0.2));
      emitter.addBehaviour(new Proton.Color(color, '#ffffff'));
      // Add cyclone/spiral behavior
      emitter.addBehaviour(new Proton.CrossZone(new Proton.CircleZone(x, y, 50), 'bound'));
      emitter.addBehaviour(new Proton.Gravity(-200)); // float upward
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => proton.removeEmitter(emitter), 1000);
    };

    // Shell casing ejection with realistic physics
    const createShellCasing = (x: number, y: number, angle: number, weaponType: string) => {
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(1, new Proton.Span(0.01));
      emitter.addInitialize(new Proton.Mass(2));
      emitter.addInitialize(new Proton.Life(1.5, 2.5));
      emitter.addInitialize(new Proton.Body(new Proton.RectZone(0, 0, 4, 2)));
      emitter.addInitialize(new Proton.Radius(3, 4));
      // Eject perpendicular to barrel
      const ejectAngle = angle + Math.PI / 2;
      const ejectMin = (ejectAngle * 180 / Math.PI) - 15;
      const ejectMax = (ejectAngle * 180 / Math.PI) + 15;
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(150, 250), new Proton.Span(ejectMin, ejectMax), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(1, 0.7));
      emitter.addBehaviour(new Proton.Color('#d4af37', '#c9a870')); // brass color
      emitter.addBehaviour(new Proton.Gravity(1800));
      emitter.addBehaviour(new Proton.Rotate('random', 'random'));
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => proton.removeEmitter(emitter), 3000);
    };

    // Generic hit burst with customizable color
    const createHitBurst = (x: number, y: number, color: string, intensity: number = 1) => {
      const emitter = new Proton.Emitter();
      emitter.rate = new Proton.Rate(new Proton.Span(20 * intensity, 30 * intensity), new Proton.Span(0.01));
      emitter.addInitialize(new Proton.Mass(1));
      emitter.addInitialize(new Proton.Life(0.3, 0.6));
      emitter.addInitialize(new Proton.Body(new Proton.CircleZone(2, 3)));
      emitter.addInitialize(new Proton.Radius(2, 4 * intensity));
      emitter.addInitialize(new Proton.Velocity(new Proton.Span(150 * intensity, 300 * intensity), new Proton.Span(0, 360), 'polar'));
      emitter.addBehaviour(new Proton.Alpha(1, 0));
      emitter.addBehaviour(new Proton.Scale(1, 0.3));
      emitter.addBehaviour(new Proton.Color(color, '#ffffff'));
      emitter.addBehaviour(new Proton.Gravity(600));
      emitter.p.x = x;
      emitter.p.y = y;
      emitter.emit('once');
      proton.addEmitter(emitter);
      setTimeout(() => proton.removeEmitter(emitter), 800);
    };


    
    // Use imported collision detection functions
    const checkPointVsCharacterBox = (
      pointX: number, 
      pointY: number, 
      pointRadius: number,
      charX: number,
      charY: number,
      isPlayer: boolean
    ): boolean => 
      CollisionUtils.checkPointVsCharacterBox(pointX, pointY, pointRadius, charX, charY, isPlayer, collisionSettingsRef.current);
    
    const checkHitboxCollision = (
      enemyX: number,
      enemyY: number,
      enemyRadius: number,
      attackerX: number,
      attackerY: number,
      facing: number,
      hitbox: AttackHitbox
    ): boolean => 
      CollisionUtils.checkHitboxCollision(
        enemyX, enemyY, enemyRadius, attackerX, attackerY, facing, hitbox,
        collisionSettingsRef.current, 
        settingsRef.current.debug as DebugSettings
      );
    
    // Helper to trigger hurt animation based on weapon mode
    const triggerHurtAnimation = (char: Character) => {
      // Don't interrupt if already in hurt/die animation or if animation should hold
      if (char.animHoldUntilEnd) return;
      if (char.animKey.includes('die')) return;
      if (char.animKey.includes('hurt')) return; // Already in hurt animation
      
      // Determine hurt animation based on current weapon mode
      let hurtAnim = '';
      if (char.animWeapon === 'pistol') {
        hurtAnim = 'pistol_hurt_center';
      } else if (char.animWeapon === 'sword') {
        hurtAnim = 'sword_hurt_center';
      } else {
        hurtAnim = 'unarmed_hurt';
      }
      
      // Set the hurt animation
      char.animKey = hurtAnim;
      char.animFrame = 0;
      char.animHoldUntilEnd = true; // Let hurt animation play out
    };
    
    // Helper to trigger death animation based on weapon mode
    const triggerDeathAnimation = (char: Character) => {
      // Don't retrigger if already dying
      if (char.animKey.includes('die')) return;
      
      // Determine death animation based on current weapon mode
      let dieAnim = '';
      if (char.animWeapon === 'pistol') {
        dieAnim = 'pistol_die';
      } else if (char.animWeapon === 'sword') {
        dieAnim = 'sword_die';
      } else {
        dieAnim = 'unarmed_die';
      }
      
      // Set the death animation
      char.animKey = dieAnim;
      char.animFrame = 0;
      char.animHoldUntilEnd = true; // Let death animation play out
    };
    
    // Process melee attack with enhanced hitboxes
    const processMeleeAttack = (attacker: Character, currentFrame: number, prevFrame: number) => {
      const attackData = MELEE_ATTACK_DATA[attacker.animKey];
      if (!attackData) return;
      
      let hitAnyEnemy = false;
      
      // Check each hitbox in the attack
      for (const hitbox of attackData.hitboxes) {
        // Check if hitbox is active this frame
        if (currentFrame < hitbox.activeFrameStart || currentFrame > hitbox.activeFrameEnd) continue;
        
        // Check if we just entered the active frame range
        const justActivated = prevFrame < hitbox.activeFrameStart && currentFrame >= hitbox.activeFrameStart;
        if (!justActivated) continue; // Only trigger once when entering active frames
        
        // Determine if this is a sword attack
        const isSword = attackData.soundType === 'sword';
        
        // Apply enhanced kickback to attacker for fighting game feel
        if (justActivated && attacker.isPlayer) {
          // Stronger kickback for sword attacks
          const kickbackMult = isSword ? 2.8 : 1.5; // Much stronger for sword
          attacker.velocity.x -= attacker.facing * attackData.kickback * kickbackMult;
        }
        
        // Calculate hitbox world position
        const hitboxCenterX = attacker.position.x + (hitbox.offsetX || 0) * attacker.facing;
        const hitboxCenterY = attacker.position.y + (hitbox.offsetY || 0);
        
        // Create visual shockwave at hitbox position
        const isWhiteKickShockwave = attacker.isPlayer && (
          attacker.animKey === 'unarmed_kick_high' ||
          attacker.animKey === 'unarmed_kick_low' ||
          attacker.animKey === 'unarmed_salto_kick'
        );
        shockwaves.push({
          x: hitboxCenterX,
          y: hitboxCenterY,
          r: isSword ? 28 : (hitbox.shape === 'arc' ? 12 : 8), // Much bigger shockwave for sword
          lifeMs: isSword ? 400 : 220, // Longer lasting shockwave for sword
          thickness: isSword ? 7 : 3, // Thicker shockwave for sword
          color: isWhiteKickShockwave ? '#ffffff' : hitbox.effectColor,
        });
        
        // Check collision with all enemies
        for (const e of enemies) {
          if (e.invulnMs > 0) continue;
          
          // Use enhanced collision detection
          const hit = checkHitboxCollision(
            e.position.x,
            e.position.y,
            e.radius,
            attacker.position.x,
            attacker.position.y,
            attacker.facing,
            hitbox
          );
          
          if (hit) {
            // Apply damage
            e.hp -= hitbox.damage;
            e.flashMs = 120;
            e.invulnMs = hitbox.invulnFrames;
            
            // Trigger hurt animation for enemy
            triggerHurtAnimation(e);
            
            if (attacker.isPlayer) {
              player.score += Math.floor(hitbox.damage * 0.5);
        spawnText(e.position.x, e.position.y - e.radius - 20, `-${hitbox.damage}`, hitbox.effectColor);
              
              // Trigger screen effects immediately when player hits enemy
              const shakeMult = 2.5;
              const magMult = 2.2;
              cameraShake.ms = Math.max(cameraShake.ms, hitbox.cameraShake * shakeMult);
              cameraShake.magnitude = Math.max(cameraShake.magnitude, hitbox.cameraShake * magMult);
              
              // Hit pause
              const basePause = Math.min(hitbox.damage * 0.8, 120);
              hitstopMs = Math.max(hitstopMs, hitbox.hitStun + basePause);
              
              // Zoom effect only (no screen flash)
              zoomEffect.targetScale = 1.0 + Math.min(0.1, hitbox.damage * 0.002);
            }
            
            playHitEffect();
            playMeleeImpact();
            
            // Blood effect for sword
            if (isSword) {
              const dx = e.position.x - attacker.position.x;
              const dy = e.position.y - attacker.position.y;
              createBloodSpray(e.position.x, e.position.y, Math.atan2(dy, dx));
            }
            
            // Apply knockback
            let knockbackAngle: number;
            if (hitbox.knockbackAngle !== undefined) {
              // Use custom angle (relative to facing)
              knockbackAngle = attacker.facing > 0 ? hitbox.knockbackAngle : (Math.PI - hitbox.knockbackAngle);
            } else {
              // Auto-calculate from attacker to enemy
              const dx = e.position.x - attacker.position.x;
              const dy = e.position.y - attacker.position.y;
              knockbackAngle = Math.atan2(dy, dx);
            }
            
            // Enhanced knockback with vertical component for fighting game feel
            const knockbackMult = 1.8; // Increased knockback multiplier
            e.velocity.x += Math.cos(knockbackAngle) * hitbox.knockback * knockbackMult;
            e.velocity.y += Math.sin(knockbackAngle) * hitbox.knockback * knockbackMult - 150; // Add upward force
            
            hitAnyEnemy = true;
            
            // Enhanced Proton particles based on intensity
            if (hitbox.effectIntensity >= 2) {
            const lightColor = isSword ? 'rgba(159,122,255,1)' : 'rgba(109,214,255,1)';
            pushDynamicLight({ x: hitboxCenterX, y: hitboxCenterY, r: 90 + hitbox.effectIntensity * 35, color: lightColor, a: 0.5 + hitbox.effectIntensity * 0.1, decay: 0.018 });
            createArcaneBurst(e.position.x, e.position.y, hitbox.effectIntensity);
            }
            if (hitbox.effectIntensity >= 3 && isSword) {
              createArcaneSlashTrail(hitboxCenterX, hitboxCenterY, attacker.facing > 0 ? 0 : Math.PI, 80);
            }
          }
        }
        
        // Whiff effects (missed attack) - only for player
        if (!hitAnyEnemy && attacker.isPlayer) {
          cameraShake.ms = hitbox.cameraShake * 0.6;
          cameraShake.magnitude = hitbox.cameraShake * 0.4;
        }
        
        // Enhanced visual effects - ALWAYS trigger for all attacks
        if (attacker.isPlayer) {
          // Extra visual effects based on attack intensity
          if (isSword) {
            // Sword gets arcane slash trail
            createArcaneSlashTrail(hitboxCenterX, hitboxCenterY, attacker.facing > 0 ? 0 : Math.PI, 120);
            
            // Extra dynamic light for sword
            const lightColor = 'rgba(255,100,120,1)';
            pushDynamicLight({ x: hitboxCenterX, y: hitboxCenterY, r: 140, color: lightColor, a: 0.7, decay: 0.022 });
            
            // Arcane burst effect
            createArcaneBurst(hitboxCenterX, hitboxCenterY, 3.5);
          } else if (hitbox.effectIntensity >= 2.0) {
            // High intensity attacks (kicks, uppercut) get enhanced effects
            const hex = hitbox.effectColor.replace('#', '');
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            const lightColor = `rgba(${r}, ${g}, ${b}, 1)`;
            pushDynamicLight({ x: hitboxCenterX, y: hitboxCenterY, r: 90 + hitbox.effectIntensity * 25, color: lightColor, a: 0.6, decay: 0.02 });
            createArcaneBurst(hitboxCenterX, hitboxCenterY, hitbox.effectIntensity);
          } else {
            // Basic attacks still get dynamic light
            const hex = hitbox.effectColor.replace('#', '');
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            const lightColor = `rgba(${r}, ${g}, ${b}, 1)`;
            pushDynamicLight({ x: hitboxCenterX, y: hitboxCenterY, r: 70, color: lightColor, a: 0.4, decay: 0.025 });
          }
        }
        
        // Visual particles - scale with intensity
        const baseParticleCount = isSword ? 8 : 5;
        const particleCount = Math.floor(baseParticleCount + hitbox.effectIntensity * 5);
        for (let i = 0; i < particleCount; i++) {
          const a = (attacker.facing > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * Math.PI * 0.7;
          const speedMult = isSword ? 2.0 : (1.0 + hitbox.effectIntensity * 0.3);
          const speed = 120 + Math.random() * 140 * speedMult;
          pushParticle({
            position: { x: hitboxCenterX, y: hitboxCenterY },
            velocity: { x: Math.cos(a) * speed, y: Math.sin(a) * speed },
            lifeMs: 220 + Math.random() * 180 * speedMult,
            size: (1.2 + hitbox.effectIntensity * 0.5) + Math.random() * (2.0 + hitbox.effectIntensity * 0.8),
            color: hitbox.effectColor,
            gravity: 540,
            fade: 0.0035,
          });
        }
      }
    };
    const cachedSkyGradient = (w: number, h: number, timeMs: number) => {
      const map = currentMapRef.current;
      const mapId = map.id;
      const quant = Math.floor(timeMs / 1200); // update roughly every 1.2s
      const key = `${w}x${h}:${quant}:${mapId}`;
      if (skyGradientCache.key === key && skyGradientCache.gradient) {
        return skyGradientCache.gradient;
      }
      
      let skyTop: string;
      let skyBot: string;
      
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      
      if (map.id === 'rooftop-sunset') {
        // Use rooftops module for Windows Classic theme
        return RooftopsMap.getRooftopSkyGradient(ctx, w, h, timeMs);
      } else if (map.id === 'suburban-day') {
        // Use suburbia module for Windows Classic theme
        return SuburbiaMap.getSuburbanSkyGradient(ctx, w, h, timeMs);
      } else if (map.id === 'city-platformer') {
        // Windows Classic grayscale sky - matches theme tokens
        // Static grayscale gradient for old school OS aesthetic
        gradient.addColorStop(0, '#1a1a1a'); // --neutral-850 (top)
        gradient.addColorStop(0.5, '#0a0a0a'); // --neutral-900 (middle)
        gradient.addColorStop(1, '#000000'); // --neutral-black (bottom/horizon)
      } else if (map.theme?.skyColorTop && map.theme?.skyColorBottom) {
        skyTop = map.theme.skyColorTop;
        skyBot = map.theme.skyColorBottom;
        gradient.addColorStop(0, skyTop);
        gradient.addColorStop(1, skyBot);
      } else {
        const t = (Math.sin(timeMs * 0.0003) * 0.5 + 0.5);
        skyTop = `rgba(${Math.floor(35 + 15 * t)}, ${Math.floor(35 + 15 * t)}, ${Math.floor(35 + 15 * t)}, 1)`;
        skyBot = `rgba(${Math.floor(15 + 10 * t)}, ${Math.floor(15 + 10 * t)}, ${Math.floor(15 + 10 * t)}, 1)`;
      gradient.addColorStop(0, skyTop);
      gradient.addColorStop(1, skyBot);
      }
      skyGradientCache.key = key;
      skyGradientCache.gradient = gradient;
      return gradient;
    };
    let highScore = 0;
    try {
      const s = localStorage.getItem('hvai_highscore');
      if (s) highScore = parseInt(s) || 0;
    } catch {}
    // Enemy status effects
    const eDot = {
      burnMap: new Map<number, { ms: number; dps: number }>(),
      slowMap: new Map<number, { ms: number; factor: number }>(),
      burn(e: Enemy, ms: number, dps: number) {
        this.burnMap.set(e.id, { ms, dps });
      },
      slow(e: Enemy, ms: number, factor: number) {
        this.slowMap.set(e.id, { ms, factor });
      },
      update(dt: number) {
        // apply ticking damage
        for (const e of enemies) {
          const b = this.burnMap.get(e.id);
          if (b) {
            e.hp -= (b.dps * dt);
            b.ms -= dt * 1000;
            if (b.ms <= 0) this.burnMap.delete(e.id);
          }
          const s = this.slowMap.get(e.id);
          if (s) {
            s.ms -= dt * 1000;
            if (s.ms <= 0) this.slowMap.delete(e.id);
          }
        }
      },
      speedFactorFor(e: Enemy) {
        const s = this.slowMap.get(e.id);
        return s ? Math.max(0.2, s.factor) : 1;
      }
    };
    // Helpers
    const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
    const seededRand = (seed: number, offset: number) => {
      const x = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    const signedRand = (seed: number, offset: number) => seededRand(seed, offset) * 2 - 1;

    const platformChunkSpacing = 420;
    const platformHeight = 28;
    const platformChunkCache = new Map<number, { mainY: number; difficulty: number }>();
    let platformCacheMapId = currentMapRef.current.id;
    const walkwayMinLift = 140;
    const walkwayMaxLift = 380; // Increased for more verticality
    const walkwayMaxStep = 100; // Allow bigger height changes
    const fragileRespawnMs = 5000;
    const jumpPadCooldown = 520;
    const dashPadCooldown = 1100;
    
    // Game design: calculate difficulty progression (0-1 based on distance)
    const getDifficulty = (x: number) => {
      const dist = Math.abs(x);
      return Math.min(1, dist / 5000); // Peaks at 5000 units
    };

    const groundYAt = (xWorld: number): number => {
      const n = perlin.noise(xWorld * world.noiseScale);
      const undulation = (n - 0.5) * 2 * world.terrainAmplitude;
      return world.baseGroundY + undulation;
    };

    // Platform motion helper
    const registerMotion = (p: Platform, amplitude: number, speed: number, axis: 'x' | 'y', phase = 0) => {
      if (!p.baseX) p.baseX = p.x;
      if (!p.baseY) p.baseY = p.y;
      p.motion = { axis, amplitude, speed, phase, baseX: p.baseX, baseY: p.baseY };
    };

    const updatePlatformMotion = (dt: number) => {
      // ===== PERFORMANCE: Only update platforms with motion (avoid iterating all) =====
      // Most platforms don't have motion, so filter them out
      for (const p of platforms) {
        if (!p.motion || p.baseX === undefined || p.baseY === undefined) continue;
        
        const t = totalTimeMs * 0.001 * p.motion.speed + p.motion.phase;
        if (p.motion.axis === 'x') {
          p.x = p.motion.baseX + Math.sin(t) * p.motion.amplitude;
        } else {
          p.y = p.motion.baseY + Math.sin(t) * p.motion.amplitude;
        }
      }
    };

    const updatePlatformFeatures = (dt: number, player: any) => {
      // ===== PERFORMANCE: Only update platforms near player (avoid iterating all 100+) =====
      const nearbyForFeatures = platformGrid.query(player.position.x, player.position.y, 400);
      
      for (const p of nearbyForFeatures) {
        // Update feature cooldowns
        if (p.featureTimerMs !== undefined && p.featureTimerMs > 0) {
          p.featureTimerMs = Math.max(0, p.featureTimerMs - dt * 1000);
        }

        // Update fragile platform states
        if (p.featureType === 'fragile' && p.fragileState) {
          if (p.fragileState === 'breaking') {
            p.fragileTimerMs = Math.max(0, (p.fragileTimerMs || 0) - dt * 1000);
            if (p.fragileTimerMs <= 0) {
              p.fragileState = 'gone';
              p.active = false;
              // OPTIMIZATION: Remove platform from spatial hash when deactivated
              platformGrid.removeEntity(p);
              p.fragileTimerMs = p.fragileRespawnMs || fragileRespawnMs;
              // Breaking particles
              for (let i = 0; i < 15; i++) {
                const px = p.x + Math.random() * p.width;
                const py = p.y + Math.random() * p.height;
                pushParticle({
                  position: { x: px, y: py },
                  velocity: { x: (Math.random() - 0.5) * 180, y: -80 - Math.random() * 120 },
                  lifeMs: 350 + Math.random() * 200,
                  size: 2 + Math.random() * 2,
                  color: 'rgba(255,100,0,0.7)',
                  gravity: 800,
                  fade: 0.01,
                });
              }
            }
          } else if (p.fragileState === 'gone') {
            p.fragileTimerMs = Math.max(0, (p.fragileTimerMs || 0) - dt * 1000);
            if (p.fragileTimerMs <= 0) {
              p.fragileState = 'ready';
              p.active = true;
              // OPTIMIZATION: Re-add platform to spatial hash when reactivated
              platformGrid.updateEntity(p, p.x + p.width / 2, p.y + p.height / 2, Math.max(p.width, p.height));
            }
          }
        }
      }
    };
    const applyPlatformFeatureEffects = (carrier: any, isEnemy = false) => {
      if (isEnemy) return; // Features only affect player for now
      
      // ===== PERFORMANCE: Use spatial hash to only check nearby platforms with features =====
      const nearbyFeaturePlatforms = platformGrid.query(carrier.position.x, carrier.position.y, carrier.radius + 100);
      
      for (const p of nearbyFeaturePlatforms) {
        if (p.active === false || !p.featureType) continue;
        
        // Check if carrier is on this platform
        const isWithinX = carrier.position.x + carrier.radius > p.x && carrier.position.x - carrier.radius < p.x + p.width;
        const isOnTop = carrier.position.y + carrier.radius >= p.y - 4 && carrier.position.y + carrier.radius <= p.y + 12;
        
        if (!isWithinX || !isOnTop) continue;
        
        // Dash Pad
        if (p.featureType === 'dashPad' && p.featureTimerMs === 0) {
          const dir = p.featureDir || 1;
          carrier.velocity.x += (p.featureStrength || 1500) * dir;
          p.featureTimerMs = p.featureCooldownMs || dashPadCooldown;
          spawnText(carrier.position.x, carrier.position.y - 40, 'DASH!', '#ff41a4');
        }
        
        // Fragile Platform
        else if (p.featureType === 'fragile' && p.fragileState === 'ready') {
          p.fragileState = 'breaking';
          p.fragileTimerMs = p.fragileTriggerMs || 500;
        }
      }
    };
    const chunkPlatformMap = new Map<number, number[]>();

    const registerPlatformInChunk = (platform: Platform, index: number) => {
      if (platform.chunkId === undefined) return;
      if (!chunkPlatformMap.has(platform.chunkId)) {
        chunkPlatformMap.set(platform.chunkId, []);
      }
      chunkPlatformMap.get(platform.chunkId)!.push(index);
    };

    const findPlatformSupporting = (x: number, feetY: number, tolerance = 18): Platform | null => {
      let candidate: Platform | null = null;
      let bestDiff = tolerance;
      for (const p of platforms) {
        if (p.active === false) continue;
        if (x < p.x - 8 || x > p.x + p.width + 8) continue;
        const diff = feetY - p.y;
        if (diff >= 0 && diff <= bestDiff) {
          bestDiff = diff;
          candidate = p;
        }
      }
      return candidate;
    };
    const findPlatformAhead = (source: Platform, dir: number, maxGap = 340): Platform | null => {
      if (dir === 0) return null;
      const startEdge = dir > 0 ? source.x + source.width : source.x;
      let best: Platform | null = null;
      let bestGap = maxGap;
      for (const p of platforms) {
        if (p === source || p.active === false) continue;
        const gap = dir > 0 ? p.x - startEdge : startEdge - (p.x + p.width);
        if (gap < 0 || gap > bestGap) continue;
        if (Math.abs(p.y - source.y) > 120) continue;
        if (p.featureType === 'fragile' && p.fragileState === 'gone') continue;
        bestGap = gap;
        best = p;
      }
      return best;
    };
    
    // Rooftops helper functions now in rooftops.ts module

    // NYC Rooftop - Generate rooftop collision platforms (now uses rooftops.ts module)
    function ensureRooftopPlatforms(xCenter: number, anchorX?: number): Platform | null {
      const currentMap = currentMapRef.current;
      chunkPlatformMap.clear();
      return RooftopsMap.ensureRooftopPlatforms(currentMap, platforms, world, xCenter, anchorX);
    }
    // Building / platform generation along X
    function ensurePlatformsAround(xCenter: number, anchorX?: number): Platform | null {
      const currentMap = currentMapRef.current;

      if (currentMap.id !== platformCacheMapId) {
        platformChunkCache.clear();
        chunkPlatformMap.clear();
        clearPlatformRenderCache();
        platforms.length = 0;
        platformCacheMapId = currentMap.id;
      }
      
      const isCityMap = currentMap.id === 'city-platformer';
      const isSuburbanMap = currentMap.id === 'suburban-day';
      const suburbanChunkSpacing = SuburbiaMap.SUBURBAN_HOUSE_CONFIG.WIDTH +
        SuburbiaMap.SUBURBAN_HOUSE_CONFIG.GAP;
      const chunkSpacing = isSuburbanMap ? suburbanChunkSpacing : platformChunkSpacing;
      const minX = xCenter - 2200;
      const maxX = xCenter + 2600;
      const minChunk = Math.floor(minX / chunkSpacing) - 2;
      const maxChunk = Math.floor(maxX / chunkSpacing) + 2;
      const SUBURBAN_TRACK_MARGIN = SuburbiaMap.SUBURBAN_TRACK_MARGIN;
      const SUBURBAN_HOVER_MARGIN = SuburbiaMap.SUBURBAN_HOVER_MARGIN;
      let suburbanOccupiedSpans: Array<{ min: number; max: number }> | null = isSuburbanMap ? [] : null;
      const reserveSuburbanSpan = (center: number, width: number, margin: number, amplitude = 0) => {
        if (!suburbanOccupiedSpans) return;
        suburbanOccupiedSpans.push({
          min: center - width / 2 - margin - amplitude,
          max: center + width / 2 + margin + amplitude,
        });
      };
      const findSuburbanFreeCenter = (
        desiredCenter: number,
        width: number,
        margin: number,
        amplitude: number,
        seedBase: number
      ): number => {
        if (!suburbanOccupiedSpans) return desiredCenter;
        const baseStep = width + margin * 2 + amplitude * 2 + 220;
        let center = desiredCenter;
        let stepCount = 0;
        let direction = seededRand(seedBase, 902) > 0.5 ? 1 : -1;
        const maxAttempts = 10;
        while (stepCount < maxAttempts) {
          const min = center - width / 2 - margin - amplitude;
          const max = center + width / 2 + margin + amplitude;
          let overlaps = false;
          for (const span of suburbanOccupiedSpans) {
            if (max > span.min && min < span.max) {
              overlaps = true;
              break;
            }
          }
          if (!overlaps) return center;
          stepCount++;
          const step = baseStep * stepCount;
          center = desiredCenter + direction * step;
          direction = -direction;
        }
        return center;
      };
      
      // Rooftop-sunset uses cityscape buildings as platforms
      if (currentMap.id === 'rooftop-sunset') {
        return ensureRooftopPlatforms(xCenter, anchorX);
      }
      
      const mapWalkwayMinLift = isCityMap 
        ? 180 
        : isSuburbanMap 
          ? 160  // Simple value for uniform house height
          : walkwayMinLift;
      const mapWalkwayMaxLift = isCityMap 
        ? 480 
        : isSuburbanMap 
          ? 200  // Simple value for uniform house system
          : walkwayMaxLift;
      const mapWalkwayMaxStep = isCityMap 
        ? 120 
        : isSuburbanMap 
          ? 80   // Simple value for easy roof-to-roof jumping
          : walkwayMaxStep;

      for (let i = platforms.length - 1; i >= 0; i--) {
        const p = platforms[i];
        if (p.x + p.width < minX - 600 || p.x > maxX + 600) {
          platforms.splice(i, 1);
        }
      }
      if (suburbanOccupiedSpans) {
        suburbanOccupiedSpans.length = 0;
        for (const p of platforms) {
          if (p.kind === 'track' || (p.kind === 'hover' && p.hasThrusters)) {
            const amplitude = p.motion?.amplitude ?? 0;
            const margin = p.kind === 'track' ? SUBURBAN_TRACK_MARGIN : SUBURBAN_HOVER_MARGIN;
            suburbanOccupiedSpans.push({
              min: p.x - margin - amplitude,
              max: p.x + p.width + margin + amplitude,
            });
          }
        }
      }
      // ===== PERFORMANCE: Use Set for O(1) lookup instead of O(n) some() =====
      // Build set directly instead of map() to avoid creating intermediate array
      const existingChunks = new Set<number>();
      for (const p of platforms) {
        if (p.chunkId !== undefined) existingChunks.add(p.chunkId);
      }
      
      for (let chunk = minChunk; chunk <= maxChunk; chunk++) {
        const chunkId = chunk;
        if (existingChunks.has(chunkId)) continue;

        let info = platformChunkCache.get(chunk);
        if (!info) {
          const centerX = chunk * chunkSpacing;
          const ground = groundYAt(centerX);
          const difficulty = getDifficulty(centerX);
          
          // Create rhythm: every 3rd platform is easier (lower)
          const isRestPlatform = chunk % 3 === 0;
          const liftRange = isRestPlatform 
            ? mapWalkwayMinLift + (mapWalkwayMaxLift - mapWalkwayMinLift) * 0.3
            : mapWalkwayMinLift + seededRand(chunk, 1) * (mapWalkwayMaxLift - mapWalkwayMinLift);
          
          let yTop = ground - liftRange;
          
          // Smooth transitions with tighter constraints
          const prev = platformChunkCache.get(chunk - 1);
          if (prev) {
            const maxStep = isRestPlatform ? mapWalkwayMaxStep * 0.5 : mapWalkwayMaxStep;
            yTop = clamp(yTop, prev.mainY - maxStep, prev.mainY + maxStep);
          }

        if (isSuburbanMap) {
          const verticalJitter = (seededRand(chunk, 2.4) - 0.5) * 140;
          yTop += verticalJitter;
          }
          
          // Ensure platforms stay in playable zone
        const lowerBound = ground - mapWalkwayMaxLift - (isSuburbanMap ? 60 : 0);
        const upperBound = ground - mapWalkwayMinLift + (isSuburbanMap ? 60 : 0);
        yTop = clamp(yTop, lowerBound, upperBound);
          info = { mainY: yTop, difficulty };
          platformChunkCache.set(chunk, info);
        }

        // Game design: vary platform positioning and size based on difficulty
        const difficulty = info.difficulty;
        const centerOffset = isSuburbanMap
          ? signedRand(chunk, 5) * 60
          : signedRand(chunk, 5) * (40 + difficulty * 80);
        let centerX = chunk * chunkSpacing + centerOffset;
        
        // Easier platforms are wider, harder ones are narrower
        // City maps get MUCH larger base platforms (like building bases)
        // Suburban maps get bigger platforms with more variation (like diverse house styles)
        const isRestPlatform = chunk % 3 === 0;
        
        let width: number;
        let platformHeightAdjusted: number;
        
        if (isCityMap) {
          const baseWidth = isRestPlatform ? 280 : 200;
          const widthBonus = isRestPlatform ? 80 : 100 - difficulty * 30;
          width = baseWidth + seededRand(chunk, 11) * widthBonus;
          platformHeightAdjusted = 60 + seededRand(chunk, 14) * 40;
        } else if (isSuburbanMap) {
          const dimensions = SuburbiaMap.getSuburbanHouseDimensions();
          width = dimensions.width;
          platformHeightAdjusted = dimensions.height;
        } else {
          const baseWidth = isRestPlatform ? 200 : 140;
          const widthBonus = isRestPlatform ? 60 : 80 - difficulty * 40;
          width = baseWidth + seededRand(chunk, 11) * widthBonus;
          platformHeightAdjusted = platformHeight;
        }
        
        if (isSuburbanMap) {
          centerX = findSuburbanFreeCenter(centerX, width, SUBURBAN_TRACK_MARGIN, 0, chunk * 17 + 3);
        }
        
        const x = centerX - width / 2;
        const id = chunk * 10 + 1;
        const trackPlatform: Platform = {
          id,
          x,
          y: info.mainY,
          width,
          height: platformHeightAdjusted,
          kind: 'track',
          lane: 0,
          seed: chunk,
          chunkId,
          baseX: x,
          baseY: info.mainY,
          active: true,
        };

        // Game design: Features scale with difficulty, rest platforms are safe
        // Suburban houses don't have features/motion - they're static large houses
        if (!isSuburbanMap) {
          const flavorRoll = seededRand(chunk, 31);
          
          if (isRestPlatform) {
            // Rest platforms: no hazards, no features
          } else {
            // Challenge platforms: increase feature frequency with difficulty
            const featureChance = 0.5 + difficulty * 0.3;
            
            if (flavorRoll > (1 - featureChance * 0.15)) {
              // Moving platforms appear later
              const axis: 'x' | 'y' = flavorRoll > 0.95 ? 'y' : 'x';
              const amplitude = axis === 'x' ? (12 + difficulty * 30) : (18 + difficulty * 50);
              const speed = 0.9 + seededRand(chunk, 35) * 1.2;
            registerMotion(trackPlatform, amplitude, speed, axis);
            } else if (flavorRoll > (1 - featureChance * 0.35)) {
            trackPlatform.featureType = 'dashPad';
              trackPlatform.featureOffset = 20 + seededRand(chunk, 36) * Math.max(20, width - 80);
              trackPlatform.featureWidth = 60 + seededRand(chunk, 37) * 40;
              trackPlatform.featureStrength = 1000 + seededRand(chunk, 38) * 600;
            trackPlatform.featureCooldownMs = dashPadCooldown;
            trackPlatform.featureTimerMs = 0;
            trackPlatform.featureDir = Math.random() < 0.5 ? -1 : 1;
            } else if (flavorRoll > (1 - featureChance * 0.7) && difficulty > 0.3) {
              // Fragile platforms only appear after some progression
            trackPlatform.featureType = 'fragile';
            trackPlatform.fragileState = 'ready';
            trackPlatform.fragileTimerMs = 0;
              trackPlatform.fragileTriggerMs = 600 + seededRand(chunk, 47) * 400;
            trackPlatform.fragileRespawnMs = fragileRespawnMs;
            }
          }
        }

        trackPlatform.silhouette = seededRand(chunk, 52);
        trackPlatform.hueShift = (seededRand(chunk, 53) - 0.5) * 0.7;
        platforms.push(trackPlatform);
        registerPlatformInChunk(trackPlatform, platforms.length - 1);
        if (isSuburbanMap) {
          reserveSuburbanSpan(centerX, width, SUBURBAN_TRACK_MARGIN, 0);
        }

        // Game design: Hover platforms provide optional high-risk, high-reward paths
        const hoverChance = seededRand(chunk, 21);
        const hoverThreshold = isRestPlatform ? 0.75 : (0.60 - difficulty * 0.15);
        
        if (isSuburbanMap) {
          const hoverPatternIndex = Math.floor(seededRand(chunk, 210) * SuburbiaMap.SUBURBAN_HOVER_PATTERNS.length) % SuburbiaMap.SUBURBAN_HOVER_PATTERNS.length;
          const hoverPattern = SuburbiaMap.SUBURBAN_HOVER_PATTERNS[hoverPatternIndex];
          const patternFlip = seededRand(chunk, 211) > 0.5 ? -1 : 1;

          hoverPattern.slots.forEach((slot, slotIndex) => {
            const hoverId = chunk * 100 + 1 + slotIndex;
            if (platforms.some((p) => p.chunkId === hoverId)) return;

            const hoverDims = SuburbiaMap.getSuburbanHouseDimensions();
            const hoverWidth = hoverDims.width;
            const hoverHeight = hoverDims.height;
            const offsetSign = slot.mirror === false ? 1 : patternFlip;
            const offsetJitter = (slot.offsetJitter ?? 0) * (seededRand(chunk, 212 + slotIndex) - 0.5) * 2;
            const desiredCenter = centerX + (slot.offset * offsetSign) + offsetJitter;
            const altitude = slot.altitudeBase + seededRand(chunk, 213 + slotIndex) * slot.altitudeVariance;
            const hoverY = info.mainY - altitude;

            let motionAmplitude = 0;
            let motionSpeed = 0;
            if (slot.motion === 'float') {
              motionAmplitude = 40 + seededRand(chunk, 214 + slotIndex) * 40;
              motionSpeed = 0.3 + seededRand(chunk, 215 + slotIndex) * 0.45;
            } else if (slot.motion === 'drift') {
              motionAmplitude = 70 + seededRand(chunk, 216 + slotIndex) * 110;
              motionSpeed = 0.45 + seededRand(chunk, 217 + slotIndex) * 0.5;
            }

            const spacingMargin = slot.gap ?? SUBURBAN_HOVER_MARGIN;
            const finalCenterX = findSuburbanFreeCenter(
              desiredCenter,
              hoverWidth,
              spacingMargin,
              motionAmplitude,
              chunk * 131 + slotIndex * 17
            );
            const hoverX = finalCenterX - hoverWidth / 2;

            const hoverPlatform: Platform = {
              id: hoverId,
              x: hoverX,
              y: hoverY,
              width: hoverWidth,
              height: hoverHeight,
              kind: 'hover',
              lane: 1 + slotIndex,
              seed: chunk * 17 + slotIndex + 1,
              chunkId: hoverId,
              baseX: hoverX,
              baseY: hoverY,
              active: true,
              hasThrusters: true,
            };

            if (motionAmplitude > 0) {
              registerMotion(hoverPlatform, motionAmplitude, motionSpeed, 'x', seededRand(chunk, 218 + slotIndex) * Math.PI * 2);
            }

            hoverPlatform.silhouette = seededRand(chunk, 220 + slotIndex);
            hoverPlatform.hueShift = (seededRand(chunk, 221 + slotIndex) - 0.5) * 0.9;
            platforms.push(hoverPlatform);
            registerPlatformInChunk(hoverPlatform, platforms.length - 1);
            reserveSuburbanSpan(finalCenterX, hoverWidth, spacingMargin, motionAmplitude);
          });
        } else if (hoverChance > hoverThreshold) {
          const hoverId = chunk * 100 + 1;
          if (!platforms.some((p) => p.chunkId === hoverId)) {
            let hoverWidth: number;
            let hoverHeight: number;
            
            if (isCityMap) {
              const hoverWidthBase = 120;
              const hoverWidthBonus = isRestPlatform ? 100 : 80;
              hoverWidth = hoverWidthBase + seededRand(chunk, 22) * hoverWidthBonus;
              hoverHeight = 50 + seededRand(chunk, 24.5) * 30;
            } else {
              const hoverWidthBase = 80;
              const hoverWidthBonus = isRestPlatform ? 80 : 60;
              hoverWidth = hoverWidthBase + seededRand(chunk, 22) * hoverWidthBonus;
              hoverHeight = 20;
            }
            
            const lateralOffset = signedRand(chunk, 23) * (width * 0.5 + difficulty * 100);
            const hoverX = centerX + lateralOffset - hoverWidth / 2;
            
            const verticalGapBase = isCityMap ? 140 : 80;
            const verticalGapVariance = isCityMap ? (80 + difficulty * 90) : (50 + difficulty * 60);
            const verticalGap = verticalGapBase + seededRand(chunk, 24) * verticalGapVariance;
            const hoverY = info.mainY - verticalGap;
            const hoverPlatform: Platform = {
              id: hoverId,
              x: hoverX,
              y: hoverY,
              width: hoverWidth,
              height: hoverHeight,
              kind: 'hover',
              lane: 1,
              seed: chunk * 17 + 1,
              chunkId: hoverId,
              baseX: hoverX,
              baseY: hoverY,
              active: true,
            };

              const hoverFeatureRoll = seededRand(chunk, 25);
              
              if (hoverFeatureRoll > 0.55 && !isRestPlatform) {
                const axis: 'x' | 'y' = seededRand(chunk, 26) > 0.6 ? 'x' : 'y';
                const amplitude = axis === 'x' 
                  ? (25 + seededRand(chunk, 27) * (35 + difficulty * 30))
                  : (35 + seededRand(chunk, 28) * (60 + difficulty * 40));
                const speed = 1.1 + seededRand(chunk, 29) * 1.6;
                registerMotion(hoverPlatform, amplitude, speed, axis, seededRand(chunk, 30) * Math.PI * 2);
              } else if (hoverFeatureRoll > 0.2 && difficulty > 0.4) {
                hoverPlatform.featureType = 'fragile';
                hoverPlatform.fragileState = 'ready';
                hoverPlatform.fragileTimerMs = 0;
                hoverPlatform.fragileTriggerMs = 500 + seededRand(chunk, 45) * 350;
                hoverPlatform.fragileRespawnMs = fragileRespawnMs;
            }

            hoverPlatform.silhouette = seededRand(chunk, 60);
            hoverPlatform.hueShift = (seededRand(chunk, 61) - 0.5) * 0.9;
            platforms.push(hoverPlatform);
            registerPlatformInChunk(hoverPlatform, platforms.length - 1);
          }
        }
        
        // Add unique vertical structures based on map theme
        const currentMap = currentMapRef.current;
        const structureRoll = seededRand(chunk, 70);
        
        // City maps: every 2nd chunk gets a tall building, suburban every 3rd
        const structureFrequency = isCityMap ? 2 : 3;
        const structureChance = isCityMap ? 0.7 : 0.6;
        
        if (chunk % structureFrequency === 0 && structureRoll > (1 - structureChance)) {
          const structureId = chunk * 1000 + 100;
          if (!platforms.some((p) => p.chunkId === structureId)) {
            
            if (isSuburbanMap) {
              // ENHANCED SUBURBAN: Create diverse multi-level structures
              const structureType = seededRand(chunk, 170);
              const structureBaseX = centerX + signedRand(chunk, 72) * 100;
              // Simplified: use uniform house dimensions for all structures
              const structureDims = {
                mansionWidth: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.WIDTH,
                mansionLevelHeight: (level: number) => SuburbiaMap.SUBURBAN_HOUSE_CONFIG.HEIGHT,
                balconyWidth: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.WIDTH * 0.4,
                balconyHeight: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.HEIGHT * 0.3,
                poolWidth: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.WIDTH * 0.6,
                poolHeight: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.HEIGHT * 0.8,
                treehouseRadius: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.WIDTH * 0.4,
                treehousePlatformHeight: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.HEIGHT * 0.5,
                treehouseBranchWidth: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.WIDTH * 0.5,
                treehouseBranchHeight: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.HEIGHT * 0.25,
                playgroundWidth: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.WIDTH * 0.9,
                playgroundPlatformHeight: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.HEIGHT * 0.7,
                waterTowerBaseUpperWidth: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.WIDTH * 0.3,
                waterTowerUpperHeight: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.HEIGHT * 0.35,
                gazeboWidth: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.WIDTH * 0.75,
                gazeboHeight: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.HEIGHT * 0.5,
                roofWidth: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.WIDTH * 0.3,
                towerWidth: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.WIDTH * 0.5,
                towerHeight: SuburbiaMap.SUBURBAN_HOUSE_CONFIG.HEIGHT,
              };
              
              if (structureType < 0.3) {
                // MANSION: Large multi-story house with balconies (3-4 levels)
                const levels = Math.floor(seededRand(chunk, 71) * 2) + 3; // 3-4 levels
                const mansionWidth = structureDims.mansionWidth;
              
              for (let level = 0; level < levels; level++) {
                  const levelId = structureId + level * 10;
                  
                  // Main floor is widest
                  let levelWidth = level === 0 ? mansionWidth : mansionWidth - level * 30;
                  const levelHeight = structureDims.mansionLevelHeight(level);
                  const verticalSpacing = level === 0 ? 0 : 120 + (level - 1) * 100;
                  const levelY = info.mainY - verticalSpacing;
                  
                  // Center upper floors
                  const levelX = structureBaseX - levelWidth / 2;
                  
                  // Main platform
                  const mainPlatform: Platform = {
                  id: levelId,
                  x: levelX,
                  y: levelY,
                  width: levelWidth,
                  height: levelHeight,
                    kind: 'tower',
                    lane: level + 1,
                  seed: chunk * 13 + level,
                  chunkId: levelId,
                  baseX: levelX,
                  baseY: levelY,
                  active: true,
                    buildingStyle: 10 + level, // Special mansion style
                  };
                  
                  platforms.push(mainPlatform);
                  registerPlatformInChunk(mainPlatform, platforms.length - 1);
                  
                  // Add balconies on upper floors
                  if (level > 0 && level < levels - 1) {
                    const balconyWidth = structureDims.balconyWidth;
                    const balconyHeight = structureDims.balconyHeight;
                    
                    // Left balcony
                    const leftBalcony: Platform = {
                      id: levelId + 1,
                      x: levelX - balconyWidth * 0.75,
                      y: levelY - 20,
                      width: balconyWidth,
                      height: balconyHeight,
                      kind: 'hover',
                      seed: chunk * 17 + level,
                      chunkId: levelId + 1,
                    };
                    platforms.push(leftBalcony);
                    registerPlatformInChunk(leftBalcony, platforms.length - 1);
                    
                    // Right balcony
                    const rightBalcony: Platform = {
                      id: levelId + 2,
                      x: levelX + levelWidth - balconyWidth * 0.25,
                      y: levelY - 20,
                      width: balconyWidth,
                      height: balconyHeight,
                      kind: 'hover',
                      seed: chunk * 19 + level,
                      chunkId: levelId + 2,
                    };
                    platforms.push(rightBalcony);
                    registerPlatformInChunk(rightBalcony, platforms.length - 1);
                  }
                }
                
                // Add garage roof as playable area
                const garageId = structureId + 100;
                const garage: Platform = {
                  id: garageId,
                  x: structureBaseX + mansionWidth * 0.4,
                  y: info.mainY - 80,
                  width: structureDims.poolWidth,
                  height: structureDims.poolHeight,
                  kind: 'tower',
                  seed: chunk * 23,
                  chunkId: garageId,
                  buildingStyle: 20, // Garage style
                };
                platforms.push(garage);
                registerPlatformInChunk(garage, platforms.length - 1);
                
              } else if (structureType < 0.5) {
                // TREEHOUSE COMPLEX: Multi-level tree platforms
                const treeCount = 2 + Math.floor(seededRand(chunk, 172) * 2); // 2-3 trees
                
                for (let t = 0; t < treeCount; t++) {
                  const treeX = structureBaseX + t * 150 - (treeCount - 1) * 75;
                  const treeLevels = 2 + Math.floor(seededRand(chunk, 173 + t) * 2); // 2-3 levels per tree
                  
                  for (let level = 0; level < treeLevels; level++) {
                    const treeId = structureId + t * 20 + level;
                    const basePlatformRadius = structureDims.treehouseRadius;
                    const platformRadius = basePlatformRadius - level * (basePlatformRadius * 0.2);
                    const levelY = info.mainY - 200 - level * 120;
                    
                    // Tree platform
                    const treePlatform: Platform = {
                      id: treeId,
                      x: treeX - platformRadius,
                      y: levelY,
                      width: platformRadius * 2,
                      height: structureDims.treehousePlatformHeight,
                      kind: 'hover',
                      seed: chunk * 31 + t * 10 + level,
                      chunkId: treeId,
                      featureType: level === 0 ? 'boost' : undefined,
                      buildingStyle: 30, // Treehouse style
                    };
                    platforms.push(treePlatform);
                    registerPlatformInChunk(treePlatform, platforms.length - 1);
                  }
                  
                  // Add bridges between trees
                  if (t < treeCount - 1) {
                    const bridgeId = structureId + 200 + t;
                    const bridgeY = info.mainY - 250;
                    const bridge: Platform = {
                      id: bridgeId,
                      x: treeX + 50,
                      y: bridgeY,
                      width: structureDims.treehouseBranchWidth,
                      height: structureDims.treehouseBranchHeight,
                      kind: 'hover',
                      seed: chunk * 37 + t,
                      chunkId: bridgeId,
                      fragileState: 'ready', // Fragile bridge
                    };
                    platforms.push(bridge);
                    registerPlatformInChunk(bridge, platforms.length - 1);
                  }
                }
                
              } else if (structureType < 0.7) {
                // PLAYGROUND STRUCTURE: Jungle gym with multiple levels
                const playgroundWidth = structureDims.playgroundWidth;
                const playgroundX = structureBaseX - playgroundWidth / 2;
                
                // Ground level platform
                const groundId = structureId + 300;
                const groundPlatform: Platform = {
                  id: groundId,
                  x: playgroundX,
                  y: info.mainY - 60,
                  width: playgroundWidth,
                  height: structureDims.playgroundPlatformHeight,
                  kind: 'brutalist',
                  seed: chunk * 41,
                  chunkId: groundId,
                  buildingStyle: 40, // Playground style
                };
                platforms.push(groundPlatform);
                registerPlatformInChunk(groundPlatform, platforms.length - 1);
                
                // Upper platforms - now using config-based proportions
                const baseUpperWidth = structureDims.waterTowerBaseUpperWidth;
                const upperHeight = structureDims.waterTowerUpperHeight;
                const upperPositions = [
                  { x: -60, y: -120, w: baseUpperWidth },
                  { x: 0, y: -150, w: baseUpperWidth * 1.3 },
                  { x: 60, y: -120, w: baseUpperWidth },
                  { x: -30, y: -200, w: baseUpperWidth * 0.8 },
                  { x: 30, y: -200, w: baseUpperWidth * 0.8 },
                ];
                
                upperPositions.forEach((pos, i) => {
                  const upperId = structureId + 310 + i;
                  const upperPlatform: Platform = {
                    id: upperId,
                    x: playgroundX + playgroundWidth / 2 + pos.x - pos.w / 2,
                    y: info.mainY + pos.y,
                    width: pos.w,
                    height: upperHeight,
                    kind: 'hover',
                    seed: chunk * 43 + i,
                    chunkId: upperId,
                    featureType: i === 2 ? 'jumpPad' : undefined, // Add jump pad to one
                  };
                  platforms.push(upperPlatform);
                  registerPlatformInChunk(upperPlatform, platforms.length - 1);
                });
                
              } else {
                // POOL AREA: Swimming pool with diving board
                const poolId = structureId + 400;
                
                // Pool deck (main platform)
                const poolDeck: Platform = {
                  id: poolId,
                  x: structureBaseX - structureDims.gazeboWidth * 0.5,
                  y: info.mainY - 30,
                  width: structureDims.gazeboWidth,
                  height: structureDims.gazeboHeight,
                  kind: 'brutalist',
                  seed: chunk * 47,
                  chunkId: poolId,
                  buildingStyle: 50, // Pool style
                };
                platforms.push(poolDeck);
                registerPlatformInChunk(poolDeck, platforms.length - 1);
                
                // Diving board platform
                const divingId = poolId + 1;
                const divingBoard: Platform = {
                  id: divingId,
                  x: structureBaseX - structureDims.gazeboWidth * 0.6,
                  y: info.mainY - 100,
                  width: structureDims.roofWidth,
                  height: 15,
                  kind: 'hover',
                  seed: chunk * 53,
                  chunkId: divingId,
                  featureType: 'boost', // Bouncy diving board
                  featureStrength: 1.5,
                };
                platforms.push(divingBoard);
                registerPlatformInChunk(divingBoard, platforms.length - 1);
                
                // Pool house roof
                const poolHouseId = poolId + 2;
                const poolHouse: Platform = {
                  id: poolHouseId,
                  x: structureBaseX + 100,
                  y: info.mainY - 120,
                  width: structureDims.towerWidth,
                  height: structureDims.towerHeight,
                  kind: 'tower',
                  seed: chunk * 59,
                  chunkId: poolHouseId,
                  buildingStyle: 51, // Pool house style
                };
                platforms.push(poolHouse);
                registerPlatformInChunk(poolHouse, platforms.length - 1);
              }
              
            } else if (isCityMap) {
              // CITY: Create tall skyscraper platforms (4-6 levels) - BIGGER AND TALLER
              const levels = Math.floor(seededRand(chunk, 71) * 3) + 4; // 4-6 levels
              const towerWidth = 180 + seededRand(chunk, 72) * 80; // Much wider (180-260)
              const towerBaseX = centerX - towerWidth / 2;
              
              for (let level = 0; level < levels; level++) {
                const levelId = structureId + level;
                const levelHeight = 70 + seededRand(chunk, 75 + level) * 50; // Taller floors (70-120)
                const verticalSpacing = 180 + level * 40; // Taller vertical spacing
                const levelY = info.mainY - verticalSpacing * (level + 1);
                const horizontalOffset = level === 0 ? 0 : signedRand(chunk, 94 + level) * 30;
                const levelX = towerBaseX + horizontalOffset;
                
                const levelPlatform: Platform = {
                  id: levelId,
                  x: levelX,
                  y: levelY,
                  width: towerWidth,
                  height: levelHeight,
                  kind: 'hover',
                  lane: level + 2,
                  seed: chunk * 13 + level,
                  chunkId: levelId,
                  baseX: levelX,
                  baseY: levelY,
                  active: true,
                  silhouette: seededRand(chunk, 80 + level),
                  hueShift: (seededRand(chunk, 90 + level) - 0.5) * 0.3,
                };
                
                platforms.push(levelPlatform);
                registerPlatformInChunk(levelPlatform, platforms.length - 1);
              }

              if (seededRand(chunk, 105) > 0.6) {
                const lampId = structureId + 999;
                const lampX = centerX + signedRand(chunk, 106) * 60;
                const lampBaseY = info.mainY;
                const lampHeight = 140 + seededRand(chunk, 107) * 70;

                const lampPlatform: Platform = {
                  id: lampId,
                  x: lampX - 8,
                  y: lampBaseY - lampHeight,
                  width: 16,
                  height: lampHeight,
                  kind: 'hover',
                  lane: 0,
                  seed: chunk * 17 + 999,
                  chunkId: lampId,
                  baseX: lampX - 8,
                  baseY: lampBaseY - lampHeight,
                  active: false,
                };

                platforms.push(lampPlatform);
              }
            }
          }
        }
      }
      
      // SUBURBAN MAP: Add persistent neighborhood platforms to platform array
      if (isSuburbanMap && suburbiaState) {
        const neighborhoodPlatforms = SuburbiaMap.getSuburbanPlatformsForCollision(suburbiaState);
        
        // Only add platforms that are in the current viewport area and not already added
        const minPlatformX = xCenter - 2500;
        const maxPlatformX = xCenter + 2500;
        
        neighborhoodPlatforms.forEach(nPlatform => {
          // Check if platform is in range
          if (nPlatform.x + nPlatform.width >= minPlatformX && nPlatform.x <= maxPlatformX) {
            // Check if this platform already exists (avoid duplicates)
            const existingPlatform = platforms.find(p => 
              Math.abs(p.x - nPlatform.x) < 10 && 
              Math.abs(p.y - nPlatform.y) < 10 &&
              Math.abs(p.width - nPlatform.width) < 10
            );
            
            if (!existingPlatform) {
              // Add neighborhood platform to main platform array
              const platformId = Date.now() + Math.random() * 1000; // Unique ID
              const gameplatform: Platform = {
                id: platformId,
                x: nPlatform.x,
                y: nPlatform.y,
                width: nPlatform.width,
                height: nPlatform.height,
                kind: nPlatform.type === 'street' ? 'track' : 'track', // All as track platforms
                lane: 0,
                seed: 0,
                chunkId: platformId,
                baseX: nPlatform.x,
                baseY: nPlatform.y,
                active: true,
              };
              
              platforms.push(gameplatform);
            }
          }
        });
      }
      
      return null;
    }
    // Enemy spawn
    let nextEnemyId = 1;
    let enemySpawnTimer = 0;
    function getEnemyProfile(type: EnemyType): {
      animWeapon: 'unarmed' | 'pistol' | 'sword';
      weaponIndex: number;
      preferredRange: number;
      meleeRange: number;
      strafeDurationMs: number;
      strafePauseMs: number;
      burstSize: number;
      meleeAttacks: ('jab' | 'kickHigh' | 'kickLow' | 'uppercut')[];
    } {
      if (type === "duelist") {
        return {
          animWeapon: 'pistol',
          weaponIndex: 2, // rifle
          preferredRange: 340,
          meleeRange: 110,
          strafeDurationMs: 900,
          strafePauseMs: 600,
          burstSize: 3,
          meleeAttacks: ['jab', 'kickHigh', 'uppercut'],
        };
      }
      if (type === "ranger") {
        return {
          animWeapon: 'pistol',
          weaponIndex: 0, // pistol
          preferredRange: 380,
          meleeRange: 100,
          strafeDurationMs: 700,
          strafePauseMs: 1000,
          burstSize: 2,
          meleeAttacks: ['jab', 'kickHigh'],
        };
      }
      if (type === "brute") {
        return {
          animWeapon: 'unarmed',
          weaponIndex: 0,
          preferredRange: 100,
          meleeRange: 130,
          strafeDurationMs: 0,
          strafePauseMs: 800,
          burstSize: 1,
          meleeAttacks: ['jab', 'kickHigh', 'kickLow', 'uppercut'],
        };
      }
      if (type === "boss") {
        return {
          animWeapon: 'pistol',
          weaponIndex: 3, // rocket
          preferredRange: 480,
          meleeRange: 130,
          strafeDurationMs: 0,
          strafePauseMs: 1200,
          burstSize: 1,
          meleeAttacks: ['jab', 'kickHigh', 'uppercut'],
        };
      }
      return {
        animWeapon: 'pistol',
        weaponIndex: 0, // pistol
        preferredRange: 300,
        meleeRange: 100,
        strafeDurationMs: 600,
        strafePauseMs: 900,
        burstSize: 2,
        meleeAttacks: ['jab', 'kickHigh'],
      };
    }

    function createEnemyInput(): CharacterInput {
      return createCharacterInput();
    }
    function spawnEnemyNear(playerX: number, forceType?: EnemyType, distance = 800 + Math.random() * 900) {
      const typeRand = Math.random();
      const type: EnemyType = forceType || (typeRand < 0.6 ? "grunt" : typeRand < 0.85 ? "ranger" : typeRand < 0.94 ? "brute" : "duelist");
      const spawnX = playerX + (Math.random() < 0.5 ? -distance : distance);
      const gy = groundYAt(spawnX);
      const radius = type === "brute" ? 28 : type === "boss" ? 40 : type === "duelist" ? 24 : 22;
      const baseMaxHp = type === "brute" ? 130 : type === "grunt" ? 60 : type === "ranger" ? 80 : type === "duelist" ? 100 : 600;
      const maxHp = Math.floor(baseMaxHp * diffMul.enemyHp);
      const profile = getEnemyProfile(type);
      
      const enemy: Enemy = {
        id: nextEnemyId++,
        name: type === "boss" ? "OVERSEER" : type === "duelist" ? "RIVAL" : ENEMY_NAMES[Math.floor(Math.random() * ENEMY_NAMES.length)],
        position: { x: spawnX, y: gy - radius - 2 },
        velocity: { x: 0, y: 0 },
        radius,
        facing: Math.random() < 0.5 ? 1 : -1,
        onGround: true,
        canDoubleJump: false,
        shootCooldownMs: 0,
        hp: maxHp,
        maxHp,
        invulnMs: 0,
        currentWeapon: profile.weaponIndex,
        weapons: [
          WEAPONS.pistol, WEAPONS.shotgun, WEAPONS.rifle, WEAPONS.rocket, WEAPONS.minigun, WEAPONS.railgun,
          WEAPONS.flame, WEAPONS.grenade, WEAPONS.ice, WEAPONS.laser, WEAPONS.plasma, WEAPONS.bow,
          WEAPONS.crossbow, WEAPONS.boomerang, WEAPONS.wand, WEAPONS.bomb, WEAPONS.axe, WEAPONS.spear
        ],
        score: 0,
        kills: 0,
        animKey: profile.animWeapon === 'pistol' ? "pistol_idle" : "unarmed_idle",
        animFrame: 0,
        animHoldUntilEnd: false,
        smoothedVelocityX: 0,
        previousVelocityX: 0,
        wasRunning: false,
        currentMotionState: 'idle',
        animWeapon: profile.animWeapon,
        attackCooldown: 0,
        jabPressed: false,
        kickHighPressed: false,
        kickLowPressed: false,
        reverseKickPressed: false,
        uppercutPressed: false,
        saltoKickPressed: false,
        jabHighDoublePressed: false,
        ammo: 999,
        maxAmmo: 999,
        shootPressed: false,
        slashPressed: false,
        blockPressed: false,
        bloodOverlay: 0,
        input: createEnemyInput(),
        isPlayer: false,
        aiType: type,
        aiState: "wander",
        flashMs: 0,
        aiCooldownMs: 0,
        preferredRange: profile.preferredRange,
        meleeRange: profile.meleeRange,
        strafeDir: Math.random() < 0.5 ? -1 : 1,
        strafeTimerMs: Math.random() * profile.strafeDurationMs,
        strafePauseMs: profile.strafePauseMs,
        strafeDurationMs: profile.strafeDurationMs,
        burstSize: profile.burstSize,
        burstShotsRemaining: profile.burstSize,
        nextMeleeMs: 0,
      };
      enemies.push(enemy);
    }
    function spawnEnemyAtPosition(x: number, forceType?: EnemyType) {
      const type: EnemyType = forceType || "grunt";
      const gy = groundYAt(x);
      const radius = type === "brute" ? 28 : type === "boss" ? 40 : type === "duelist" ? 24 : 22;
      const baseMaxHp = type === "brute" ? 130 : type === "grunt" ? 60 : type === "ranger" ? 80 : type === "duelist" ? 100 : 600;
      const maxHp = Math.floor(baseMaxHp * diffMul.enemyHp);
      const profile = getEnemyProfile(type);
      
      const enemy: Enemy = {
        id: nextEnemyId++,
        name: type === "boss" ? "OVERSEER" : type === "duelist" ? "RIVAL" : ENEMY_NAMES[Math.floor(Math.random() * ENEMY_NAMES.length)],
        position: { x, y: gy - radius - 2 },
        velocity: { x: 0, y: 0 },
        radius,
        facing: Math.random() < 0.5 ? 1 : -1,
        onGround: true,
        canDoubleJump: false,
        shootCooldownMs: 0,
        hp: maxHp,
        maxHp,
        invulnMs: 0,
        currentWeapon: profile.weaponIndex,
        weapons: [
          WEAPONS.pistol, WEAPONS.shotgun, WEAPONS.rifle, WEAPONS.rocket, WEAPONS.minigun, WEAPONS.railgun,
          WEAPONS.flame, WEAPONS.grenade, WEAPONS.ice, WEAPONS.laser, WEAPONS.plasma, WEAPONS.bow,
          WEAPONS.crossbow, WEAPONS.boomerang, WEAPONS.wand, WEAPONS.bomb, WEAPONS.axe, WEAPONS.spear
        ],
        score: 0,
        kills: 0,
        animKey: profile.animWeapon === 'pistol' ? "pistol_idle" : "unarmed_idle",
        animFrame: 0,
        animHoldUntilEnd: false,
        smoothedVelocityX: 0,
        previousVelocityX: 0,
        wasRunning: false,
        currentMotionState: 'idle',
        animWeapon: profile.animWeapon,
        attackCooldown: 0,
        jabPressed: false,
        kickHighPressed: false,
        kickLowPressed: false,
        reverseKickPressed: false,
        uppercutPressed: false,
        saltoKickPressed: false,
        jabHighDoublePressed: false,
        ammo: 999,
        maxAmmo: 999,
        shootPressed: false,
        slashPressed: false,
        blockPressed: false,
        bloodOverlay: 0,
        input: createEnemyInput(),
        isPlayer: false,
        aiType: type,
        aiState: "wander",
        flashMs: 0,
        aiCooldownMs: 0,
        preferredRange: profile.preferredRange,
        meleeRange: profile.meleeRange,
        strafeDir: Math.random() < 0.5 ? -1 : 1,
        strafeTimerMs: Math.random() * profile.strafeDurationMs,
        strafePauseMs: profile.strafePauseMs,
        strafeDurationMs: profile.strafeDurationMs,
        burstSize: profile.burstSize,
        burstShotsRemaining: profile.burstSize,
        nextMeleeMs: 0,
      };
      enemies.push(enemy);
    }
    // Input handlers
    const keyDown = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) {
        if (!startedRef.current && (e.code === "KeyP" || e.code === "Enter" || e.code === "Space")) {
          startGameWithName((ae as HTMLInputElement).value || "Player", gameConfigRef.current);
          setGameStarted(true);
          return;
        }
        return;
      }

      // Menu navigation removed - using mouse for match setup now

      if (e.repeat) return;
      if (!startedRef.current && (e.code === "KeyP" || e.code === "Enter" || e.code === "Space")) {
        startGameWithName("Player", gameConfigRef.current);
        setGameStarted(true);
        return;
      }
      if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = true;
      if (e.code === "ArrowRight" || e.code === "KeyD") input.right = true;
      if (e.code === "ArrowUp" || e.code === "KeyW" || e.code === "Space" ) { input.up = true; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.run = true;
      
      // Attack keys (context-dependent based on weapon)
      if (e.code === "KeyZ") {
        if (player.animWeapon === 'sword') {
          input.slash = true;
        } else {
          input.jab = true;
        }
      }
      if (e.code === "KeyX") {
        if (player.animWeapon === 'sword') input.block = true;
        else input.kickHigh = true;
      }
      if (e.code === "KeyC") input.kickLow = true;
      if (e.code === "KeyV") input.reverseKick = true;
      if (e.code === "KeyQ") input.uppercut = true;
      if (e.code === "KeyE") input.saltoKick = true;
      if (e.code === "KeyF") input.jabHighDouble = true;
      
      if (e.code === "KeyH") {
        helpRef.current = !helpRef.current;
      }
      // Removed debug variant/clip override keybindings
      if (e.code === 'KeyT') {
        settingsRef.current.visual.aiEnabled = !settingsRef.current.visual.aiEnabled;
        if (!settingsRef.current.visual.aiEnabled) {
          enemies.length = 0;
          waveSpawnQueue.length = 0;
          waveNeedsSetup = true;
          waveInProgress = false;
        }
      }
      // Removed unsupported combat override keybindings; melee triggers via LMB
      if (e.code === "KeyP") {
        runningRef.current = !runningRef.current;
        setIsPaused(!runningRef.current);
      }
      // Host end game: Return to map selection (only when paused)
      if (e.code === "Escape" && !runningRef.current && startedRef.current) {
        if (multiplayerStateRef.current.isMultiplayerGame && multiplayerStateRef.current.isHost) {
          // Call hostEndGame from context
          const canvas = canvasRef.current as any;
          if (canvas && canvas._hostEndGame) {
            canvas._hostEndGame();
          }
          return;
        }
      }
      // Restart game when R is pressed during pause
      if (e.code === "KeyR" && !runningRef.current && startedRef.current) {
        restartGame();
        return;
      }
      // Mode selection (1=melee/unarmed, 2=guns/pistol, 3=sword)
      if (e.code === "Digit1") { player.animWeapon = 'unarmed'; }
      if (e.code === "Digit2") { player.animWeapon = 'pistol'; }
      if (e.code === "Digit3") { player.animWeapon = 'sword'; }
      
      // Weapon selection (4-9 and 0) - only works in gun mode
      if (player.animWeapon === 'pistol') {
        if (e.code === "Digit4") { player.currentWeapon = 0; }
        if (e.code === "Digit5") { player.currentWeapon = 1; }
        if (e.code === "Digit6") { player.currentWeapon = 2; }
        if (e.code === "Digit7") { player.currentWeapon = 3; }
        if (e.code === "Digit8") { player.currentWeapon = 4; }
        if (e.code === "Digit9") { player.currentWeapon = 5; }
        if (e.code === "Digit0") { player.currentWeapon = 6; }
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = false;
      if (e.code === "ArrowRight" || e.code === "KeyD") input.right = false;
      if (e.code === "ArrowUp" || e.code === "KeyW" || e.code === "Space") { input.up = false; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.run = false;
      
      // Attack key releases
      if (e.code === "KeyZ") {
        input.shoot = false;
        input.slash = false;
        input.jab = false;
        input.shootHeld = false;
      }
      if (e.code === "KeyX") {
        input.block = false;
        input.kickHigh = false;
      }
      if (e.code === "KeyC") input.kickLow = false;
      if (e.code === "KeyV") input.reverseKick = false;
      if (e.code === "KeyQ") input.uppercut = false;
      if (e.code === "KeyE") input.saltoKick = false;
      if (e.code === "KeyF") input.jabHighDouble = false;
    };
    // Track screen-space mouse for continuous world-space updates
    const mouseScreen = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };

    const pointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseScreen.x = e.clientX - rect.left;
      mouseScreen.y = e.clientY - rect.top;
      input.mouse.x = mouseScreen.x + camera.x;
      input.mouse.y = mouseScreen.y + camera.y;
      updateWheelHover(mouseScreen.x, mouseScreen.y);
    };
    // Initialize mouse world position at player center
    input.mouse.x = mouseScreen.x + camera.x;
    input.mouse.y = mouseScreen.y + camera.y;

    const pointerDown = (e: PointerEvent) => {
      // Right mouse opens wheel
      if (e.button === 2) {
        openWheel();
        return;
      }
      if (e.button === 0) {
        if (player.animWeapon === 'pistol') {
          input.shoot = true;
          input.shootHeld = true;
        } else if (player.animWeapon === 'sword') {
          input.slash = true;
        } else {
          input.jab = true;
        }
        // Do not fake recoil; weaponKickMs is set only when a shot actually fires
      }
    };
    const pointerUp = (e: PointerEvent) => {
      if (e.button === 2) {
        closeWheel(true);
        return;
      }
      if (e.button === 0) {
        input.shootHeld = false;
        input.shoot = false;
        input.slash = false;
        input.jab = false;
      }
    };

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerdown", pointerDown);
    window.addEventListener("pointerup", pointerUp);
    // prevent context menu on right click (store handler for cleanup)
    const onContextMenu = (e: Event) => { e.preventDefault(); };
    canvas.addEventListener('contextmenu', onContextMenu as any);

    // Minimal Gamepad polling
    let lastGamepadPoll = 0;
    function pollGamepad(dt: number) {
      lastGamepadPoll += dt * 1000;
      if (lastGamepadPoll < 16) return; // ~60Hz
      lastGamepadPoll = 0;
      const gps = navigator.getGamepads ? navigator.getGamepads() : [] as any;
      const gp = gps && gps[0];
      if (!gp) return;
      const axLX = gp.axes[0] || 0; // left stick X for move
      const axLY = gp.axes[1] || 0; // left stick Y (unused)
      input.left = axLX < -0.2;
      input.right = axLX > 0.2;
      // Face buttons (A to jump, RT to shoot)
      const btnA = gp.buttons[0]?.pressed; // A / Cross
      const rt = gp.buttons[7]?.pressed || (gp.axes[5] && gp.axes[5] > 0.2);
      if (btnA) input.up = true;
      input.shootHeld = !!rt;
      // Right stick aims
      const axRX = gp.axes[2] || 0;
      const axRY = gp.axes[3] || 0;
      if (Math.abs(axRX) > 0.2 || Math.abs(axRY) > 0.2) {
        const len = Math.hypot(axRX, axRY) || 1;
        const aimX = player.position.x + (axRX / len) * 500;
        const aimY = player.position.y + (axRY / len) * 500;
        input.mouse.x = aimX;
        input.mouse.y = aimY;
      }
    }

    // Scroll wheel cycles selection while wheel is open OR when in gun mode
    const wheelScroll = (e: WheelEvent) => {
      // Only cycle through first 7 weapons (mapped to keys 4-0)
      const availableCount = Math.min(7, player.weapons.length);
      
      if (wheel.open) {
        // Wheel is open - cycle hover selection
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      wheel.hoverIndex = (wheel.hoverIndex + dir + availableCount) % availableCount;
      } else if (player.animWeapon === 'pistol') {
        // Gun mode - cycle through weapons
        e.preventDefault();
        const dir = e.deltaY > 0 ? 1 : -1;
        player.currentWeapon = (player.currentWeapon + dir + availableCount) % availableCount;
      }
    };
    canvas.addEventListener('wheel', wheelScroll, { passive: false });
    // Initialize - spawn based on map type
    const currentMap = currentMapRef.current;
    
    // ========== MAP INITIALIZATION - ALL MAPS IN ONE PLACE ==========
    
    // 1. Initialize map-specific state
    if (currentMap.id === 'city-platformer') {
      // Metropolis: procedural platforms in the air
      metropolisState = MetropolisMap.initMetropolisState();
    } else if (currentMap.id === 'suburban-day') {
      // Suburbia: houses/buildings as platforms
      suburbiaState = SuburbiaMap.initializeSuburbiaState();
    } else if (currentMap.id === 'rooftop-sunset') {
      // Rooftops: rooftops only
      rooftopsState = RooftopsMap.initRooftopsState();
    }
    
    // 2. Generate platforms and spawn player
    const spawnX = currentMap.spawnPoints?.[0]?.x ?? SPAWN_OFFSET_X;
    ensurePlatformsAround(spawnX);
    
    // Find platform to spawn on
    const startPlatform = platforms.find(p => 
      p.x <= spawnX && p.x + p.width >= spawnX
    ) || platforms[0];
    
    if (startPlatform) {
      player.position.x = spawnX;
      player.position.y = startPlatform.y - player.radius - 2;
    } else {
      player.position.x = spawnX;
      player.position.y = groundYAt(spawnX) - player.radius - 2;
    }
    
    // ========== END MAP INITIALIZATION ==========
    
    // ===== Multiplayer: Helper to sync bullet creation =====
    function syncBulletToMultiplayer(bullet: Bullet, weaponType: string) {
      if (!multiplayerStateRef.current.isMultiplayerGame || bullet.from !== "player") return;
      
      const channel = multiplayerStateRef.current.roomChannel;
      if (channel) {
        safeChannelPublish(channel, 'bulletSync', {
          shooterId: localPlayerId.current,
          position: { x: bullet.position.x, y: bullet.position.y },
          velocity: { x: bullet.velocity.x, y: bullet.velocity.y },
          weaponType: weaponType,
          damage: bullet.damage
        });
      }
    }
    
    // Shooting
    function spawnBullets(char: Character = player) {
      const weapon = char.weapons[char.currentWeapon];
      const charInput = char.input || input;
      const bulletFrom: "player" | "enemy" = char.isPlayer === false ? "enemy" : "player";

      const dx = charInput.mouse.x - char.position.x;
      const dy = charInput.mouse.y - char.position.y;
      // Restrict angle to horizontal only based on facing direction
      const baseAngle = char.facing > 0 ? 0 : Math.PI;
      const spread = (weapon.spreadDeg * Math.PI) / 180;
      const damageMul = (char.isPlayer && overdriveMs > 0) ? 1.25 : 1;

      const offsets = getWeaponOffsets(weapon.type);
      const anchors = SPRITE_WEAPON_ANCHORS[char.animWeapon as 'pistol' | 'sword'];
      const baseScale = BASE_SPRITE_SCALE * (char.radius / DEFAULT_PLAYER_RADIUS);
      const muzzlePoint = anchors
        ? {
            x: char.position.x + (char.facing === 1 ? 1 : -1) * (anchors.muzzle.u * STICKMAN_BOUNDS.width * baseScale - BASE_OFFSET_X * (char.radius / DEFAULT_PLAYER_RADIUS)),
            y: char.position.y + (anchors.muzzle.v * STICKMAN_BOUNDS.height * baseScale - BASE_OFFSET_Y * (char.radius / DEFAULT_PLAYER_RADIUS)),
          }
        : {
        x: char.position.x + Math.cos(baseAngle) * (char.radius + offsets.muzzle),
        y: char.position.y + Math.sin(baseAngle) * (char.radius + offsets.muzzle),
      };
      const gripPoint = anchors
        ? {
            x: char.position.x + (char.facing === 1 ? 1 : -1) * (anchors.grip.u * STICKMAN_BOUNDS.width * baseScale - BASE_OFFSET_X * (char.radius / DEFAULT_PLAYER_RADIUS)),
            y: char.position.y + (anchors.grip.v * STICKMAN_BOUNDS.height * baseScale - BASE_OFFSET_Y * (char.radius / DEFAULT_PLAYER_RADIUS)),
          }
        : {
            x: char.position.x + Math.cos(baseAngle) * (char.radius + offsets.grip),
            y: char.position.y + Math.sin(baseAngle) * (char.radius + offsets.grip),
      };
      const fx = WEAPON_FX[weapon.type] || WEAPON_FX.pistol;
      // Special weapon behaviors
      if (weapon.type === "railgun") {
        const maxRange = 1400;
        const endX = muzzlePoint.x + Math.cos(baseAngle) * maxRange;
        const endY = muzzlePoint.y + Math.sin(baseAngle) * maxRange;
        
        // ===== PvE: Damage enemies along line =====
        if (!multiplayerStateRef.current.isMultiplayerGame) {
          for (const e of enemies) {
            const A = muzzlePoint;
            const B = { x: endX, y: endY };
            const APx = e.position.x - A.x, APy = e.position.y - A.y;
            const ABx = B.x - A.x, ABy = B.y - A.y;
            const ab2 = ABx * ABx + ABy * ABy;
            const t = Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / ab2));
            const Px = A.x + ABx * t, Py = A.y + ABy * t;
            const d = Math.hypot(e.position.x - Px, e.position.y - Py);
            if (d < e.radius + 6) {
              const dmg = weapon.damage * 1.2;
              e.hp -= dmg;
              
              // Trigger hurt animation for enemy
              triggerHurtAnimation(e);
              
              playHitEffect();
              player.score += Math.floor(dmg * 0.5); // Score for damage
            }
          }
        }
        
        // ===== PvP: Check railgun beam against remote players =====
        if (multiplayerStateRef.current.isMultiplayerGame && bulletFrom === 'player') {
          const currentRemotePlayers = remotePlayersRef.current;
          currentRemotePlayers.forEach((remotePlayer) => {
            // Use same sprite-based collision as bullets
            const remoteRadius = DEFAULT_PLAYER_RADIUS;
            const remoteScale = remoteRadius / DEFAULT_PLAYER_RADIUS;
            const remoteSpriteHeight = STICKMAN_BOUNDS.visibleHeight * BASE_SPRITE_SCALE * remoteScale;
            const remoteCenterY = remotePlayer.position.y - remoteSpriteHeight * 0.42;
            const remoteHitRadius = Math.max(remoteSpriteHeight * 0.32, remoteRadius * 1.8, 36);
            
            // Calculate closest point on beam to remote player's center
            const A = muzzlePoint;
            const B = { x: endX, y: endY };
            const APx = remotePlayer.position.x - A.x;
            const APy = remoteCenterY - A.y;
            const ABx = B.x - A.x;
            const ABy = B.y - A.y;
            const ab2 = ABx * ABx + ABy * ABy;
            const t = Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / ab2));
            const Px = A.x + ABx * t;
            const Py = A.y + ABy * t;
            const d = Math.hypot(remotePlayer.position.x - Px, remoteCenterY - Py);
            
            // Use same hit radius as bullet collision
            if (d < remoteHitRadius + 8) {
              const dmg = Math.floor(weapon.damage * 1.2 * damageMul);
              
              // Send railgun hit to network
              const channel = multiplayerStateRef.current.roomChannel;
              if (channel) {
                const bulletAngle = Math.atan2(remoteCenterY - muzzlePoint.y, remotePlayer.position.x - muzzlePoint.x);
                safeChannelPublish(channel, 'playerHit', {
                  victimId: remotePlayer.id,
                  attackerId: localPlayerId.current,
                  damage: dmg,
                  attackType: 'railgun',
                  knockbackX: Math.cos(bulletAngle) * 1500,
                  knockbackY: Math.sin(bulletAngle) * 1500 * 0.6 - 80,
                  hitPosition: { x: remotePlayer.position.x, y: remotePlayer.position.y },
                  cameraShake: 320,
                  hitStun: 60,
                  effectColor: '#ff6b6b',
                  effectIntensity: 2.0,
                  timestamp: Date.now()
                });
              }
              
              // Local feedback
              setRemotePlayers(prev => {
                const updated = new Map(prev);
                const victim = updated.get(remotePlayer.id);
                if (victim) {
                  victim.health = Math.max(0, victim.health - dmg);
                  updated.set(remotePlayer.id, victim);
                }
                return updated;
              });
              
              spawnText(remotePlayer.position.x, remotePlayer.position.y - remoteRadius - 20, `-${dmg}`, '#ff6b6b');
              player.score += Math.floor(dmg * 0.5);
              playHitEffect();
              spawnHitSpark(Px, Py, 'railgun');
              shockwaves.push({ x: Px, y: Py, r: 18, lifeMs: 220, thickness: 4, color: '#ffffff' });
              cameraShake.ms = Math.max(cameraShake.ms, 220);
              cameraShake.magnitude = Math.max(cameraShake.magnitude, 16);
            }
          });
        }
        
        railBeams.push({ x1: muzzlePoint.x, y1: muzzlePoint.y, x2: endX, y2: endY, lifeMs: 140 });
        // Use Proton.js for railgun beam particles
        if (bulletFrom === 'player') {
          createBeamParticles(muzzlePoint.x, muzzlePoint.y, baseAngle, maxRange, fx.sparkColor);
          createSparks(muzzlePoint.x, muzzlePoint.y, baseAngle);
        }
      } else if (weapon.type === "flame") {
        // Flame is a hold weapon - spawn projectiles locally, no network sync
        const count = 12;
        for (let i = 0; i < count; i++) {
          const angle = baseAngle + (Math.random() - 0.5) * (weapon.spreadDeg * Math.PI / 180);
          const speed = weapon.projectileSpeed * (0.4 + Math.random() * 0.6);
          const b: Bullet = {
            position: { x: muzzlePoint.x, y: muzzlePoint.y },
            velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
            lifeMs: 320 + Math.random() * 200,
            damage: Math.floor(weapon.damage * damageMul),
            radius: 3,
            from: bulletFrom,
            type: weapon.type,
          };
          bullets.push(b);
        }
        
        // Add continuous flame stream effect with Proton.js
        if (bulletFrom === 'player') {
          createFlameStream(muzzlePoint.x, muzzlePoint.y, baseAngle, 150);
        }
      } else if (weapon.type === "grenade" || weapon.type === "bomb") {
        const angle = baseAngle + (Math.random() - 0.5) * (weapon.spreadDeg * Math.PI / 180);
        const speed = weapon.projectileSpeed;
        const b: Bullet = {
          position: { x: muzzlePoint.x, y: muzzlePoint.y },
          velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
          lifeMs: weapon.type === 'bomb' ? 2500 : 2200,
          damage: weapon.damage,
          radius: weapon.type === 'bomb' ? 12 : 8,
          from: bulletFrom,
          type: weapon.type,
          gravity: 1500,
        };
        bullets.push(b);
        syncBulletToMultiplayer(b, weapon.type);
        if (bullets.length > MAX_BULLETS) bullets.splice(0, bullets.length - MAX_BULLETS);
      } else if (weapon.type === "minigun") {
        const count = weapon.projectilesPerShot;
        for (let i = 0; i < count; i++) {
          const angle = baseAngle + (Math.random() - 0.5) * (weapon.spreadDeg * Math.PI / 180);
          const speed = weapon.projectileSpeed * (0.8 + Math.random() * 0.4);
          const b = {
            position: { x: muzzlePoint.x, y: muzzlePoint.y },
            velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
            lifeMs: 700,
            damage: Math.floor(weapon.damage * damageMul),
            radius: 2.5,
            from: bulletFrom,
            type: weapon.type,
            pierce: 0,
          };
          bullets.push(b);
          syncBulletToMultiplayer(b, weapon.type);
        }
        if (bullets.length > MAX_BULLETS) bullets.splice(0, bullets.length - MAX_BULLETS);
      } else if (weapon.type === "ice") {
        const angle = baseAngle;
        const speed = weapon.projectileSpeed;
        const b = {
          position: { x: muzzlePoint.x, y: muzzlePoint.y },
          velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
          lifeMs: 1200,
          damage: weapon.damage,
          radius: 3,
          from: bulletFrom,
          type: weapon.type,
          pierce: 0,
        };
        bullets.push(b);
        syncBulletToMultiplayer(b, weapon.type);
      } else if (weapon.type === 'laser') {
        // fast precise projectile, low damage, slight glow, slight pierce
        const angle = baseAngle;
        const speed = weapon.projectileSpeed;
        const b = {
          position: { x: muzzlePoint.x, y: muzzlePoint.y },
          velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                      lifeMs: 900,
            damage: Math.floor(weapon.damage * damageMul),
            radius: 2,
          from: bulletFrom,
          type: weapon.type,
          pierce: 1,
          trailMs: 0,
        };
        bullets.push(b);
        syncBulletToMultiplayer(b, weapon.type);
        if (bullets.length > MAX_BULLETS) bullets.splice(0, bullets.length - MAX_BULLETS);
      } else if (weapon.type === 'plasma') {
        // slow heavy projectile, splash on timeout
        const angle = baseAngle + (Math.random() - 0.5) * (weapon.spreadDeg * Math.PI / 180);
        const speed = weapon.projectileSpeed * 0.8;
        const b = {
          position: { x: muzzlePoint.x, y: muzzlePoint.y },
          velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                      lifeMs: 1400,
            damage: Math.floor(weapon.damage * damageMul),
            radius: 6,
          from: bulletFrom,
          type: weapon.type,
          trailMs: 0,
        };
        bullets.push(b);
        syncBulletToMultiplayer(b, weapon.type);
        if (bullets.length > MAX_BULLETS) bullets.splice(0, bullets.length - MAX_BULLETS);
      } else if (weapon.type === 'beam') {
        // Continuous short beam burst
        const maxRange = 600;
        const endX = muzzlePoint.x + Math.cos(baseAngle) * maxRange;
        const endY = muzzlePoint.y + Math.sin(baseAngle) * maxRange;
        
        // ===== PvE: Damage enemies along path =====
        if (!multiplayerStateRef.current.isMultiplayerGame) {
          for (const e of enemies) {
            const A = muzzlePoint;
            const B = { x: endX, y: endY };
            const APx = e.position.x - A.x, APy = e.position.y - A.y;
            const ABx = B.x - A.x, ABy = B.y - A.y;
            const ab2 = ABx * ABx + ABy * ABy;
            const t = Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / ab2));
            const Px = A.x + ABx * t, Py = A.y + ABy * t;
            const d = Math.hypot(e.position.x - Px, e.position.y - Py);
            if (d < e.radius + 6) { 
              const dmg = weapon.damage * 0.6;
              e.hp -= dmg;
              e.flashMs = 100;
              
              // Trigger hurt animation for enemy
              triggerHurtAnimation(e);
              
              playHitEffect();
              player.score += Math.floor(dmg * 0.5); // Score for damage
            }
          }
        }
        
        // ===== PvP: Check beam against remote players =====
        if (multiplayerStateRef.current.isMultiplayerGame && bulletFrom === 'player') {
          const currentRemotePlayers = remotePlayersRef.current;
          currentRemotePlayers.forEach((remotePlayer) => {
            const remoteRadius = DEFAULT_PLAYER_RADIUS;
            const remoteScale = remoteRadius / DEFAULT_PLAYER_RADIUS;
            const remoteSpriteHeight = STICKMAN_BOUNDS.visibleHeight * BASE_SPRITE_SCALE * remoteScale;
            const remoteCenterY = remotePlayer.position.y - remoteSpriteHeight * 0.42;
            const remoteHitRadius = Math.max(remoteSpriteHeight * 0.32, remoteRadius * 1.8, 36);
            
            const A = muzzlePoint;
            const B = { x: endX, y: endY };
            const APx = remotePlayer.position.x - A.x;
            const APy = remoteCenterY - A.y;
            const ABx = B.x - A.x;
            const ABy = B.y - A.y;
            const ab2 = ABx * ABx + ABy * ABy;
            const t = Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / ab2));
            const Px = A.x + ABx * t;
            const Py = A.y + ABy * t;
            const d = Math.hypot(remotePlayer.position.x - Px, remoteCenterY - Py);
            
            if (d < remoteHitRadius + 6) {
              const dmg = Math.floor(weapon.damage * 0.6 * damageMul);
              
              const channel = multiplayerStateRef.current.roomChannel;
              if (channel) {
                const bulletAngle = Math.atan2(remoteCenterY - muzzlePoint.y, remotePlayer.position.x - muzzlePoint.x);
                safeChannelPublish(channel, 'playerHit', {
                  victimId: remotePlayer.id,
                  attackerId: localPlayerId.current,
                  damage: dmg,
                  attackType: 'beam',
                  knockbackX: Math.cos(bulletAngle) * 800,
                  knockbackY: Math.sin(bulletAngle) * 800 * 0.6 - 80,
                  hitPosition: { x: remotePlayer.position.x, y: remotePlayer.position.y },
                  cameraShake: 180,
                  hitStun: 30,
                  effectColor: '#ff6b6b',
                  effectIntensity: 1.5,
                  timestamp: Date.now()
                });
              }
              
              setRemotePlayers(prev => {
                const updated = new Map(prev);
                const victim = updated.get(remotePlayer.id);
                if (victim) {
                  victim.health = Math.max(0, victim.health - dmg);
                  updated.set(remotePlayer.id, victim);
                }
                return updated;
              });
              
              spawnText(remotePlayer.position.x, remotePlayer.position.y - remoteRadius - 20, `-${dmg}`, '#ff6b6b');
              player.score += Math.floor(dmg * 0.5);
              playHitEffect();
            }
          });
        }
        
        railBeams.push({ x1: muzzlePoint.x, y1: muzzlePoint.y, x2: endX, y2: endY, lifeMs: 80 });
        pushDynamicLight({ x: muzzlePoint.x, y: muzzlePoint.y, r: fx.lightRadius, color: fx.lightColor, a: 0.6, decay: 0.03 });
        // Use Proton.js for beam weapon particles
        if (bulletFrom === 'player') {
          createBeamParticles(muzzlePoint.x, muzzlePoint.y, baseAngle, maxRange, fx.sparkColor);
        }
      } else if (weapon.type === 'lightning') {
        // Arc to nearest enemy in range
        // ===== PERFORMANCE: Use spatial hash to find nearest enemy =====
        const nearbyForLightning = enemyGrid.query(muzzlePoint.x, muzzlePoint.y, 360);
        let nearest: Enemy | null = null; let nd = 360;
        for (const e of nearbyForLightning) {
          const d = Math.hypot(e.position.x - muzzlePoint.x, e.position.y - muzzlePoint.y);
          if (d < nd) { nd = d; nearest = e; }
        }
        if (nearest) {
          nearest.hp -= weapon.damage;
          nearest.flashMs = 120;
          
          // Trigger hurt animation for enemy
          triggerHurtAnimation(nearest);
          
          playHitEffect();
          player.score += Math.floor(weapon.damage * 0.5); // Score for damage
          // Create jagged points
          const seg = 10; const pts: number[] = [];
          for (let i=0;i<=seg;i++) {
            const t = i/seg;
            const x = muzzlePoint.x + (nearest.position.x - muzzlePoint.x)*t + (Math.random()-0.5)*20;
            const y = muzzlePoint.y + (nearest.position.y - muzzlePoint.y)*t + (Math.random()-0.5)*20;
            pts.push(x,y);
          }
          pushLightningArc({ points: pts, lifeMs: 120 });
          pushDynamicLight({ x: nearest.position.x, y: nearest.position.y, r: 120, color: fx.lightColor, a: 0.7, decay: 0.02 });
        }
      } else if (weapon.type === 'bow' || weapon.type === 'crossbow' || weapon.type === 'spear') {
        // arrows/spears pierce 1-2 targets
        const count = weapon.type === 'bow' ? 1 : 1;
        for (let i=0;i<count;i++){
          const angle = baseAngle + (Math.random() - 0.5) * (weapon.spreadDeg * Math.PI / 180);
          const speed = weapon.projectileSpeed;
          const b = {
            position: { x: muzzlePoint.x, y: muzzlePoint.y },
            velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
            lifeMs: 1600,
            damage: Math.floor(weapon.damage * damageMul),
            radius: 3,
            from: bulletFrom,
            type: weapon.type,
            pierce: weapon.type==='spear'?2:1,
            trailMs: 0,
          };
          bullets.push(b);
          syncBulletToMultiplayer(b, weapon.type);
        }
      } else if (weapon.type === 'boomerang' || weapon.type === 'axe') {
        // returns to player after range; slight arc
        const angle = baseAngle;
        const speed = weapon.projectileSpeed * 0.9;
        const b: Bullet = {
          position: { x: muzzlePoint.x, y: muzzlePoint.y },
          velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                      lifeMs: 2200,
            damage: Math.floor(weapon.damage * damageMul),
            radius: 6,
          from: bulletFrom,
          type: weapon.type,
          boomerang: true,
          boomerangPhase: 'out' as 'out' | 'return',
          startPos: { x: char.position.x, y: char.position.y },
          maxRange: 420,
          hitIds: new Set<number>(),
          trailMs: 0,
        };
        bullets.push(b);
        syncBulletToMultiplayer(b, weapon.type);
      } else if (weapon.type === 'wand') {
        // small homing orb (mild)
        const angle = baseAngle;
        const speed = weapon.projectileSpeed*0.8;
        const b: Bullet = { position: { x: muzzlePoint.x, y: muzzlePoint.y }, velocity: { x: Math.cos(angle)*speed, y: Math.sin(angle)*speed }, lifeMs: 1400, damage: Math.floor(weapon.damage * damageMul), radius: 4, from: bulletFrom, type:'wand' as WeaponType, trailMs: 0 };
        bullets.push(b);
        syncBulletToMultiplayer(b, weapon.type);
      } else {
        // Default ballistic guns and rockets
        for (let i = 0; i < weapon.projectilesPerShot; i++) {
          const angle = baseAngle + (Math.random() - 0.5) * spread;
          const speed = weapon.projectileSpeed;
          const vx = Math.cos(angle) * speed;
          const vy = Math.sin(angle) * speed;
          const b: Bullet = {
            position: {
              x: muzzlePoint.x,
              y: muzzlePoint.y,
            },
            velocity: { x: vx, y: vy },
            lifeMs: weapon.type === "rocket" ? 2400 : 1500,
            damage: Math.floor(weapon.damage * damageMul),
            radius: weapon.type === "rocket" ? 6 : 3,
            from: bulletFrom,
            type: weapon.type,
            pierce: 0,
            trailMs: 0,
          };
          bullets.push(b);
          syncBulletToMultiplayer(b, weapon.type);
          
        if (bullets.length > MAX_BULLETS) bullets.splice(0, bullets.length - MAX_BULLETS);
        }
      }

      // Recoil
      const recoilAngle = Math.atan2(-dy, -dx);
      char.velocity.x += Math.cos(recoilAngle) * weapon.recoil;
      char.velocity.y += Math.sin(recoilAngle) * weapon.recoil * 0.1; // small vertical kick

      // Muzzle particles
      spawnMuzzleFlash(muzzlePoint.x, muzzlePoint.y, baseAngle, !char.isPlayer, weapon.type);
      // Dynamic light (only for player to save performance)
      if (char.isPlayer) {
      dynamicLights.push({ x: muzzlePoint.x, y: muzzlePoint.y, r: fx.lightRadius, color: fx.lightColor, a: 0.7, decay: 0.02 });
      if (dynamicLights.length > MAX_DYNAMIC_LIGHTS) dynamicLights.splice(0, dynamicLights.length - MAX_DYNAMIC_LIGHTS);
      }
      // Shell casings for ballistic guns
      if (['pistol','rifle','shotgun','minigun','crossbow'].includes(weapon.type)) {
        for (let c=0;c< (weapon.type==='shotgun'?3:1); c++) {
          const dir = char.facing;
          const speed = 200 + Math.random()*140;
          casings.push({ x: char.position.x - dir*6, y: char.position.y - 6, vx: -dir * speed + (Math.random()-0.5)*80, vy: -120 - Math.random()*120, rot: Math.random()*Math.PI, vr: (Math.random()-0.5)*6, life: 1400, size: weapon.type==='shotgun'?3:2, color: '#caa85a' });
        }
      }
      // SFX - For pistol_shoot animation, sound plays on frame 1 (see animation update logic)
      // For all other shooting modes (walk_shoot, run_shoot, etc.), play sound immediately
      if (char.animKey !== 'pistol_shoot') {
      playShoot(weapon.type);
      }

      // Kickback and muzzle effects (player only)
      if (char.isPlayer) {
      weaponKickMs = 120;
      muzzleFxMs = 110;
      }

      // Set cooldown (for pistol_shoot, this happens on frame 1)
      char.shootCooldownMs = weapon.fireRateMs;
    }
    function shootIfPossible(char: Character = player) {
      // Only allow shooting in gun mode
      if (char.animWeapon !== 'pistol') return;
      
      const weapon = char.weapons[char.currentWeapon];
      const wt = weapon.type as WeaponType;
      const ammoCost =
        wt === 'shotgun' ? 2 :
        wt === 'rocket' ? 4 :
        wt === 'railgun' ? 5 :
        wt === 'grenade' ? 3 :
        wt === 'bomb' ? 4 :
        wt === 'laser' ? 2 :
        wt === 'plasma' ? 2 :
        wt === 'beam' ? 3 :
        wt === 'lightning' ? 2 :
        wt === 'cluster' ? 4 :
        wt === 'boomerang' || wt === 'wand' || wt === 'axe' || wt === 'spear' ? 0 :
        1;

      if (char.ammo < ammoCost && char.isPlayer) {
        spawnText(char.position.x, char.position.y - 40, 'NO AMMO', '#ff6666', 12);
        return;
      }
      if (char.shootCooldownMs > 0) return;

      // For pistol_shoot animation, bullets spawn automatically on frame 1
      // For all other shooting modes (walking/running), spawn bullets immediately
      if (char.animKey !== 'pistol_shoot') {
        char.ammo = Math.max(0, char.ammo - ammoCost);
        spawnBullets(char);
      }
    }
    function spawnMuzzleFlash(x: number, y: number, angle: number, enemy?: boolean, weaponOverride?: WeaponType) {
      // Vary FX by active weapon for quick visual variety
      const active = enemy ? weaponOverride || 'pistol' : player.weapons[player.currentWeapon]?.type as WeaponType;
      const fx = WEAPON_FX[active] || WEAPON_FX.pistol;
      
      // Use advanced Proton.js muzzle flash for player weapons
      if (!enemy) {
        createMuzzleFlash(x, y, angle, active);
        
        // Add shell casings for ballistic weapons
        if (['pistol', 'shotgun', 'rifle', 'minigun'].includes(active)) {
          createShellCasing(x, y, angle, active);
        }
      }
      
      // Keep some legacy particles for extra visual density
      let count = enemy ? 10 : 5;
      let baseColor = fx.muzzleColor;
      let spread = 0.6;
      let speedMin = 200, speedMax = 400;

      if (active === 'shotgun') { count = enemy ? 18 : 8; spread = 1.0; speedMin = 260; speedMax = 520; }
      else if (active === 'railgun') { count = enemy ? 8 : 4; spread = 0.2; baseColor = fx.muzzleColor; speedMin = 500; speedMax = 900; }
      else if (active === 'minigun') { count = enemy ? 12 : 6; spread = 0.7; speedMin = 180; speedMax = 360; }
      else if (active === 'flame') { count = enemy ? 14 : 6; spread = 0.9; baseColor = fx.muzzleColor; speedMin = 140; speedMax = 260; }
      else if (active === 'laser') { count = enemy ? 10 : 4; spread = 0.25; baseColor = fx.muzzleColor; speedMin = 380; speedMax = 680; }
      else if (active === 'plasma') { count = enemy ? 12 : 5; spread = 0.4; baseColor = fx.muzzleColor; speedMin = 280; speedMax = 520; }
      else if (active === 'grenade' || active === 'bomb') { count = enemy ? 10 : 5; spread = 0.7; baseColor = fx.muzzleColor; speedMin = 220; speedMax = 420; }

      for (let i = 0; i < count; i++) {
        const a = angle + (Math.random() - 0.5) * spread + (enemy ? (Math.random() - 0.5) * 0.2 : 0);
        const sp = speedMin + Math.random() * (speedMax - speedMin);
        pushParticle({
          position: { x, y },
          velocity: { x: Math.cos(a) * sp, y: Math.sin(a) * sp },
          lifeMs: 160 + Math.random() * 160,
          size: 1.5 + Math.random() * 2.5,
          color: enemy ? '#ff5555' : baseColor,
          gravity: 0,
          fade: 0.007,
        });
      }
      // Add subtle backflash near the muzzle
      pushParticle({ position: { x, y }, velocity: { x: 0, y: 0 }, lifeMs: 80, size: 6, color: enemy ? '#ff4444' : baseColor, gravity: 0, fade: 0.02 });
      // Light uses palette
      dynamicLights.push({ x, y, r: fx.lightRadius, color: fx.lightColor, a: 0.6, decay: 0.03 });
      if (!enemy) {
      dynamicLights.push({ x, y, r: fx.lightRadius, color: fx.lightColor, a: 0.6, decay: 0.03 });
      if (dynamicLights.length > MAX_DYNAMIC_LIGHTS) dynamicLights.splice(0, dynamicLights.length - MAX_DYNAMIC_LIGHTS);
      if (dynamicLights.length > MAX_DYNAMIC_LIGHTS) dynamicLights.splice(0, dynamicLights.length - MAX_DYNAMIC_LIGHTS);
      }
    }
    function explode(x: number, y: number, radius: number, power: number, damage: number) {
      // Shockwave ring
      shockwaves.push({ x, y, r: 16, lifeMs: 350, thickness: 6, color: '#ff4444' });
      
      // Use Proton.js for advanced explosion particles with shockwave effect
      createExplosionBurst(x, y, radius, '#ff6b6b', '#cc3333');
      
      // Add some legacy particles for extra density
      const count = 30;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = Math.random() * power;
        const c = Math.random() < 0.6 ? "#ff6b6b" : "#cc3333";
        pushParticle({
          position: { x, y },
          velocity: { x: Math.cos(a) * sp, y: Math.sin(a) * sp },
          lifeMs: 600 + Math.random() * 500,
          size: 2 + Math.random() * 4,
          color: c,
          gravity: 1600,
          fade: 0.0015,
        });
      }

      // Damage enemies within radius
      // ===== PERFORMANCE: Use spatial hash for explosion damage =====
      const nearbyEnemiesForExplosion = enemyGrid.query(x, y, radius + 50);
      for (const e of nearbyEnemiesForExplosion) {
        const dx = e.position.x - x;
        const dy = e.position.y - y;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius + e.radius) {
          e.hp -= damage * (1 - dist / (radius + e.radius));
          
          // Trigger hurt animation for enemy
          triggerHurtAnimation(e);
          
          playHitEffect();
          if (e.hp <= 0) {
            e.hp = 0;
          } else {
            // Knockback
            const k = (1 - dist / (radius + e.radius)) * 900;
            const ang = Math.atan2(dy, dx);
            e.velocity.x += Math.cos(ang) * k;
            e.velocity.y += Math.sin(ang) * k;
          }
        }
      }

      // Audio + hitstop
      playExplosion();
      hitstopMs = Math.max(hitstopMs, 80);
      spawnText(x, y - 24, 'BOOM', '#ffd166');
      // Add a scorch decal under entities with soft fade
      scorchDecals.push({ x, y, r: radius * 0.9, a: 0.9 });
      if (scorchDecals.length > MAX_SCORCH_DECALS) scorchDecals.splice(0, scorchDecals.length - MAX_SCORCH_DECALS);

      // Screen-space confetti on big explosions (map world -> screen using camera)
      if (radius >= 120) {
        const sx = (x - camera.x) / (ctx.canvas.width || 1);
        const sy = (y - camera.y) / (ctx.canvas.height || 1);
        // Confetti effect was removed to avoid external CDN dependency during static export.
      }
    }
    function spawnHitSpark(x: number, y: number, weaponType?: string) {
      // Use Proton.js for advanced particle effects
      const fx = weaponType ? (WEAPON_FX[weaponType] || WEAPON_FX.pistol) : WEAPON_FX.pistol;
      
      // Choose effect based on weapon type
      if (weaponType === 'ice') {
        createIceBurst(x, y, 30);
      } else if (weaponType === 'plasma' || weaponType === 'wand') {
        createPlasmaImpact(x, y, fx.sparkColor);
      } else if (weaponType === 'beam' || weaponType === 'laser' || weaponType === 'railgun') {
        createBeamParticles(x, y, Math.random() * Math.PI * 2, 40, fx.sparkColor);
      } else {
        // Default: Use advanced hit burst with weapon color
        createHitBurst(x, y, fx.sparkColor, 1.2);
        // Add blood spray for organic hits
        if (Math.random() < 0.3) {
          const dir = Math.random() * Math.PI * 2;
          createBloodSpray(x, y, dir);
        }
      }
    }
    // Physics & AI
    let lastTime = performance.now();
    let lastNetworkSync = 0;
    let lastFrameTime = 0;
    let rafId = 0;
    
    // ===== PERFORMANCE OPTIMIZATION SETTINGS =====
    // These optimizations have been implemented:
    // 1. Incremental spatial hash updates (30-50% FPS gain)
    // 2. Network sync throttling to 30fps instead of 60fps  
    // 3. Optional frame rate limiting for lower-end devices
    // 4. Enhanced early exits for paused states
    // 5. Periodic cleanup of orphaned spatial hash entities
    
    const NETWORK_SYNC_INTERVAL = 33; // ~30fps network sync (was 60fps)
    const TARGET_FRAME_TIME = 16.67; // 60fps default, can be set to 33.33 for 30fps on low-end devices
    const SPATIAL_HASH_CLEANUP_INTERVAL = 5000; // Cleanup orphaned entities every 5 seconds
    
    let enableFrameLimiting = false; // Set to true for 30fps mode on lower-end devices
    let lastSpatialCleanup = 0;
    
    // Performance monitoring (enable for debugging)
    const enablePerformanceLogging = false;
    let frameCount = 0;
    let lastPerfLog = 0;
    let telemetryWindowStart = performance.now();
    let telemetryFrameCount = 0;
    let telemetryFrameMsTotal = 0;
    let visiblePlatformDrawCount = 0;
    const frameTelemetry = {
      frame: 0,
      fps: 0,
      avgFrameMs: 0,
      lastFrameMs: 0,
      maxFrameMs: 0,
      updateMs: 0,
      renderMs: 0,
      visiblePlatforms: 0,
      platformCache: platformCacheManager.getStats(),
    };
    (window as any).__platformerFrameTelemetry = frameTelemetry;

    const updateFrameTelemetry = (frameStart: number, updateMs: number, renderMs: number) => {
      const frameEnd = performance.now();
      const frameMs = frameEnd - frameStart;
      frameCount++;
      telemetryFrameCount++;
      telemetryFrameMsTotal += frameMs;

      frameTelemetry.frame = frameCount;
      frameTelemetry.lastFrameMs = frameMs;
      frameTelemetry.maxFrameMs = Math.max(frameTelemetry.maxFrameMs, frameMs);
      frameTelemetry.updateMs = updateMs;
      frameTelemetry.renderMs = renderMs;
      frameTelemetry.visiblePlatforms = visiblePlatformDrawCount;

      if (frameEnd - telemetryWindowStart >= 1000) {
        frameTelemetry.fps = (telemetryFrameCount * 1000) / (frameEnd - telemetryWindowStart);
        frameTelemetry.avgFrameMs = telemetryFrameMsTotal / Math.max(1, telemetryFrameCount);
        frameTelemetry.platformCache = platformCacheManager.getStats();
        (window as any).__platformerFrameTelemetry = frameTelemetry;

        if (enablePerformanceLogging && frameEnd - lastPerfLog >= 3000) {
          console.log('[PERF] Frame telemetry', { ...frameTelemetry });
          lastPerfLog = frameEnd;
        }

        telemetryWindowStart = frameEnd;
        telemetryFrameCount = 0;
        telemetryFrameMsTotal = 0;
        frameTelemetry.maxFrameMs = 0;
      }
    };

    const step = () => {
      if (stats) stats.begin();
      const now = performance.now();
      
      // Optional frame rate limiting
      if (enableFrameLimiting && now - lastFrameTime < TARGET_FRAME_TIME) {
        rafId = requestAnimationFrame(step);
        if (stats) stats.end();
        return;
      }
      lastFrameTime = now;
      
      let dt = (now - lastTime) / 1000; // seconds
      dt = Math.min(0.033, Math.max(0.008, dt));
      lastTime = now;

      // Early exit for hidden tabs - avoid ALL processing
      if (document.hidden) {
        dt = 0;
        rafId = requestAnimationFrame(step);
        if (stats) stats.end();
        return;
      }

      const updateStart = performance.now();
      update(dt);
      const updateMs = performance.now() - updateStart;
      
      // Throttled network sync (20-30fps instead of 60fps)
      if (multiplayerStateRef.current.isMultiplayerGame && now - lastNetworkSync >= NETWORK_SYNC_INTERVAL) {
        syncPlayerToNetwork();
        lastNetworkSync = now;
      }
      
      const renderStart = performance.now();
      render();
      const renderMs = performance.now() - renderStart;
      updateFrameTelemetry(now, updateMs, renderMs);
      if (stats) stats.end();
      rafId = requestAnimationFrame(step);
    };
    const update = (dt: number) => {
      // Early exit for paused states - avoid ALL processing
      if (!startedRef.current || !runningRef.current) return;

      // Apply hitstop slow-mo
      const isHitstop = hitstopMs > 0;
      if (isHitstop) {
        hitstopMs = Math.max(0, hitstopMs - dt * 1000);
        dt *= 0.15;
        // During hitstop, we can skip some expensive updates if needed
      }

      // Time
      totalTimeMs += dt * 1000;
      
      // ===== PERFORMANCE: Incremental spatial hash updates (major optimization!) =====
      // Only update entities that have actually moved instead of full rebuilds
      
      // Update enemy positions in spatial hash (only if they moved)
      for (const e of enemies) {
        const enemyRadius = e.radius * 2; // Include sprite bounds
        enemyGrid.updateEntity(e, e.position.x, e.position.y, enemyRadius);
      }
      
      // Update platform positions in spatial hash (only platforms with motion)
      for (const p of platforms) {
        if (p.active !== false) {
          // Only update platforms that have motion or are newly added
          if (p.motion || !platformGrid.hasEntity(p)) {
            platformGrid.updateEntity(p, p.x + p.width / 2, p.y + p.height / 2, Math.max(p.width, p.height));
          }
        }
      }
      
      // Periodic spatial hash cleanup to remove orphaned entities
      if (performance.now() - lastSpatialCleanup > SPATIAL_HASH_CLEANUP_INTERVAL) {
        enemyGrid.cleanupOrphanedEntities(enemies);
        platformGrid.cleanupOrphanedEntities(platforms.filter(p => p.active !== false));
        lastSpatialCleanup = performance.now();
        
        // Optional performance logging for monitoring optimization effectiveness
        if (enablePerformanceLogging) {
          const enemyStats = enemyGrid.getStats();
          const platformStats = platformGrid.getStats();
          console.log(`[PERF] Enemy grid: ${enemyStats.trackedEntities} entities, ${enemyStats.cellCount} cells, ${(enemyStats.memoryUsage/1024).toFixed(1)}KB`);
          console.log(`[PERF] Platform grid: ${platformStats.trackedEntities} entities, ${platformStats.cellCount} cells, ${(platformStats.memoryUsage/1024).toFixed(1)}KB`);
        }
      }
      
      // ===== Multiplayer: Remote Player Interpolation =====
      // Smooth out network jitter by interpolating between buffered positions
      if (multiplayerStateRef.current.isMultiplayerGame) {
        const currentRemotePlayers = remotePlayersRef.current;
        currentRemotePlayers.forEach(remote => {
          if (!remote.interpolationBuffer || remote.interpolationBuffer.length < 2) {
            // Not enough data - use current position
            remote.renderPosition.x = remote.position.x;
            remote.renderPosition.y = remote.position.y;
            return;
          }
          
          const now = Date.now();
          const renderTime = now - 100; // 100ms interpolation delay for smooth prediction
          
          // Find the two positions to interpolate between
          let older = null;
          let newer = null;
          
          for (let i = 0; i < remote.interpolationBuffer.length - 1; i++) {
            const curr = remote.interpolationBuffer[i];
            const next = remote.interpolationBuffer[i + 1];
            
            if (curr.timestamp <= renderTime && next.timestamp >= renderTime) {
              older = curr;
              newer = next;
              break;
            }
          }
          
          if (older && newer && newer.timestamp !== older.timestamp) {
            // Smooth linear interpolation between network updates
            const t = Math.max(0, Math.min(1, 
              (renderTime - older.timestamp) / (newer.timestamp - older.timestamp)
            ));
            
            remote.renderPosition.x = older.position.x + (newer.position.x - older.position.x) * t;
            remote.renderPosition.y = older.position.y + (newer.position.y - older.position.y) * t;
          } else if (remote.interpolationBuffer.length > 0) {
            // Use most recent position if interpolation fails
            const latest = remote.interpolationBuffer[remote.interpolationBuffer.length - 1];
            remote.renderPosition.x = latest.position.x;
            remote.renderPosition.y = latest.position.y;
          } else {
            // Final fallback
            remote.renderPosition.x = remote.position.x;
            remote.renderPosition.y = remote.position.y;
          }
        });
      }
      
      // Update map-specific interactive elements
      if (currentMapRef.current.id === 'suburban-day' && suburbiaState) {
        SuburbiaMap.updateSuburbiaPlatforms(suburbiaState, totalTimeMs);
        SuburbiaMap.checkSuburbiaCollisionsForExplosions(suburbiaState, player.position.x, player.position.y, player.radius, (x, y) => {
          for (let i = 0; i < 20; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 150 + Math.random() * 300;
            particles.push({position: {x, y}, velocity: {x: Math.cos(angle) * speed, y: Math.sin(angle) * speed}, lifeMs: 800, size: 4, color: '#FFD700', gravity: 400, fade: 0.001});
          }
        });
      }
      
      // Update screen effects
      if (screenFlash.alpha > 0) {
        screenFlash.alpha -= dt * 4; // Fade out quickly
        if (screenFlash.alpha < 0) screenFlash.alpha = 0;
      }
      
      // Update damage edge pulse
      if (damageEdgePulse.alpha > 0) {
        // Pulse effect with sine wave
        const pulseSpeed = 8;
        damageEdgePulse.alpha = damageEdgePulse.maxAlpha * (0.5 + 0.5 * Math.sin(totalTimeMs * 0.01 * pulseSpeed));
        damageEdgePulse.maxAlpha -= dt * 1.2; // Fade out over time
        if (damageEdgePulse.maxAlpha <= 0) {
          damageEdgePulse.alpha = 0;
          damageEdgePulse.maxAlpha = 0;
        }
      }
      
      // Update zoom effect
      if (zoomEffect.scale !== zoomEffect.targetScale) {
        const zoomSpeed = 12;
        zoomEffect.scale += (zoomEffect.targetScale - zoomEffect.scale) * Math.min(1, dt * zoomSpeed);
        if (Math.abs(zoomEffect.scale - zoomEffect.targetScale) < 0.001) {
          zoomEffect.scale = zoomEffect.targetScale;
        }
      }
      // Return to normal zoom
      if (zoomEffect.targetScale > 1.0) {
        zoomEffect.targetScale -= dt * 0.5;
        if (zoomEffect.targetScale < 1.0) zoomEffect.targetScale = 1.0;
      }

      // Cooldowns
      if (player.shootCooldownMs > 0) player.shootCooldownMs = Math.max(0, player.shootCooldownMs - dt * 1000 * (overdriveMs > 0 ? 1.3 : 1));
      if (player.invulnMs > 0) player.invulnMs = Math.max(0, player.invulnMs - dt * 1000);
      if (player.bloodOverlay > 0) {
        player.bloodOverlay = Math.max(0, player.bloodOverlay - dt * 0.25);
      }
      if (combo > 0) {
        comboTimerMs -= dt * 1000;
        if (comboTimerMs <= 0) combo = 0;
      }
      if (overdriveMs > 0) overdriveMs = Math.max(0, overdriveMs - dt * 1000);
      if (weaponKickMs > 0) weaponKickMs = Math.max(0, weaponKickMs - dt * 1000);
      if (muzzleFxMs > 0) muzzleFxMs = Math.max(0, muzzleFxMs - dt * 1000);

      // Poll gamepad
      pollGamepad(dt);
      
      // Update mouse world position continuously as camera moves
      input.mouse.x = mouseScreen.x + camera.x;
      input.mouse.y = mouseScreen.y + camera.y;

      // Player movement - simplified immediate velocity (from animation-test)
      const isRunning = input.run;
      const currentSpeed = isRunning ? world.moveSpeed * world.runMultiplier : world.moveSpeed;
      
      // Check if player is in an attack animation that should preserve momentum
      const isInAttackAnimation = MELEE_ATTACK_DATA[player.animKey] !== undefined;
      const shouldPreserveMomentum = isInAttackAnimation && player.animHoldUntilEnd;
      
      if (shouldPreserveMomentum) {
        // During attack animations, preserve existing velocity and apply friction
        // This allows kickback to be visible
        const frictionMult = 0.92; // Gradual slowdown
        player.velocity.x *= frictionMult;
        
        // Still allow some player control during attacks (reduced)
        const attackControlMult = 0.25; // 25% control during attacks
        if (input.left) {
          player.velocity.x += -currentSpeed * attackControlMult * dt * 10;
        }
        if (input.right) {
          player.velocity.x += currentSpeed * attackControlMult * dt * 10;
        }
      } else {
        // Normal movement - full control
        player.velocity.x = 0;
        if (input.left) {
          player.velocity.x = -currentSpeed;
        }
        if (input.right) {
          player.velocity.x = currentSpeed;
        }
      }
      
      // Face mouse direction when available, otherwise fall back to movement
      const mouseRelativeX = input.mouse.x - player.position.x;
      if (Math.abs(mouseRelativeX) > 5) {
        player.facing = mouseRelativeX > 0 ? 1 : -1;
      } else {
        if (input.left) player.facing = -1;
        if (input.right) player.facing = 1;
      }
      
      // Smooth velocity for better state detection (exponential moving average)
      const smoothingFactor = 0.3; // Lower = smoother, higher = more responsive
      smoothedVelocityX = smoothedVelocityX * (1 - smoothingFactor) + player.velocity.x * smoothingFactor;
      
      const absSmoothedVel = Math.abs(smoothedVelocityX);
      const absRawVel = Math.abs(player.velocity.x);
      
      // Determine motion state with hysteresis (prevents flickering between states)
      const isMoving = absSmoothedVel > WALK_ENTER;
      
      if (!isMoving) {
        currentMotionState = 'idle';
      } else if (isRunning) {
        // Shift held and moving = run
        currentMotionState = 'run';
        wasShiftHeld = true;
      } else {
        // Moving without shift = walk
        currentMotionState = 'walk';
        wasShiftHeld = false;
      }
      
      // ===== Animation State Machine =====
      // Update cooldowns
      if (player.attackCooldown > 0) player.attackCooldown -= dt;
      // Update smoothed velocity for animation
      player.smoothedVelocityX = smoothedVelocityX;
      player.currentMotionState = currentMotionState;
      
      // Detect run_stop - ONLY if we were running WITH SHIFT and now stopped
      const wasActuallyRunning = wasShiftHeld && Math.abs(player.previousVelocityX) > 150;
      const inputStopped = absRawVel < 10;
      const shouldRunStop = wasActuallyRunning && inputStopped && player.onGround && !player.animHoldUntilEnd;
      
      // Detect attack inputs (edge-triggered with cooldown)
      updateAttackEdgeFlags(player, input);
      
      // Only trigger standalone shoot animation when idle (movement animations handle shooting while moving)
      if (input.shoot && !player.shootPressed && player.attackCooldown <= 0 && currentMotionState === 'idle') player.shootPressed = true;
      if (!input.shoot) player.shootPressed = false;
      
      // Slash edge detection - prevent spam by requiring input release
      // Only set slashPressed to true on the rising edge (when it was false before)
      if (input.slash && !player.slashPressed && player.attackCooldown <= 0) {
        player.slashPressed = true;
      }
      // Only clear slashPressed when input is released, not when animation completes
      // This prevents retriggering while holding the button
      if (!input.slash) {
        player.slashPressed = false;
      }
      
      // Block edge detection - prevent spam by requiring input release
      // Only set blockPressed to true on the rising edge
      if (input.block && !player.blockPressed && player.attackCooldown <= 0) {
        player.blockPressed = true;
      }
      // Only clear blockPressed when input is released
      if (!input.block) {
        player.blockPressed = false;
      }
      
      // Check if currently attacking
      const isShootAttack = player.animKey.includes('_shoot') &&
                            !player.animKey.includes('_run') &&
                            !player.animKey.includes('_walk');
      const isAttacking = player.animKey.includes('_jab') ||
                         player.animKey.includes('_kick') ||
                         player.animKey.includes('_uppercut') ||
                         player.animKey.includes('_salto') ||
                         isShootAttack ||
                         player.animKey.includes('_slash') ||
                         player.animKey.includes('_block');
      const attackLockActive = isAttacking && !(player.animKey === 'pistol_shoot' && currentMotionState !== 'idle');
      // Interrupt run_stop if player changes direction, starts moving, or jumps
      const isMovingAgain = absRawVel > 50;
      const changedDirection = player.previousVelocityX * player.velocity.x < 0 && Math.abs(player.velocity.x) > 10;
      const shouldInterruptRunStop = player.animKey.includes("_run_stop") && 
                                      (isMovingAgain || changedDirection || !player.onGround);
      
      if (shouldInterruptRunStop) {
        player.animHoldUntilEnd = false;
      }
      
      // Check if we're in a hurt animation that should continue playing
      const isInHurtAnimation = player.animKey.includes('hurt') && player.animHoldUntilEnd;
      
      // Determine next animation based on state
      let nextKey = "unarmed_idle";
      let shouldHoldUntilEnd = false;
      
      // If hurt animation is playing, let it finish
      if (isInHurtAnimation) {
        const currentClip = globalClips.clips[player.animKey];
        if (currentClip && player.animFrame < currentClip.images.length - 0.5) {
          nextKey = player.animKey;
          shouldHoldUntilEnd = true;
        }
      }
      // Priority-based animation selection
      // Highest priority: Check if attack key is STILL HELD (handles both ongoing and just-completed attacks)
      else if (attackLockActive && player.onGround) {
        const currentClip = globalClips.clips[player.animKey];
        const attackNotComplete = currentClip && player.animFrame < currentClip.images.length - 0.5;
        
        // Check which attack is current and if its key is still held
        let keyStillHeld = false;
        if (player.animKey === "unarmed_jab_single" && input.jab) keyStillHeld = true;
        else if (player.animKey === "unarmed_kick_high" && input.kickHigh) keyStillHeld = true;
        else if (player.animKey === "unarmed_kick_low" && input.kickLow) keyStillHeld = true;
        else if (player.animKey === "unarmed_reverse_kick" && input.reverseKick) keyStillHeld = true;
        else if (player.animKey === "unarmed_uppercut" && input.uppercut) keyStillHeld = true;
        else if (player.animKey === "unarmed_salto_kick" && input.saltoKick) keyStillHeld = true;
        else if (player.animKey === "unarmed_jab_high_double" && input.jabHighDouble) keyStillHeld = true;
        else if (player.animKey === "pistol_shoot" && input.shoot && currentMotionState === 'idle') keyStillHeld = true;
        else if (player.animKey === "sword_slash" && input.slash) keyStillHeld = true;
        else if (player.animKey === "sword_block_center" && input.block) keyStillHeld = true;
        
        if (keyStillHeld) {
          // Key is held - either continue current attack or loop it
          nextKey = player.animKey;
          shouldHoldUntilEnd = true;
        }
        // If key released and attack not complete, let it finish
        else if (attackNotComplete && player.animHoldUntilEnd) {
          nextKey = player.animKey;
          shouldHoldUntilEnd = true;
        }
      }
      // Attack inputs (priority order: jab, kicks, uppercut, special)
      else if (player.jabPressed && !attackLockActive && player.onGround) {
        nextKey = "unarmed_jab_single";
        shouldHoldUntilEnd = true;
        player.jabPressed = false;
        player.attackCooldown = 0.15;
      }
      else if (player.kickHighPressed && !attackLockActive && player.onGround) {
        nextKey = "unarmed_kick_high";
        shouldHoldUntilEnd = true;
        player.kickHighPressed = false;
        player.attackCooldown = 0.15;
      }
      else if (player.kickLowPressed && !attackLockActive && player.onGround) {
        nextKey = "unarmed_kick_low";
        shouldHoldUntilEnd = true;
        player.kickLowPressed = false;
        player.attackCooldown = 0.15;
      }
      else if (player.reverseKickPressed && !attackLockActive && player.onGround) {
        nextKey = "unarmed_reverse_kick";
        shouldHoldUntilEnd = true;
        player.reverseKickPressed = false;
        player.attackCooldown = 0.15;
      }
      else if (player.uppercutPressed && !attackLockActive && player.onGround) {
        nextKey = "unarmed_uppercut";
        shouldHoldUntilEnd = true;
        player.uppercutPressed = false;
        player.attackCooldown = 0.15;
      }
      else if (player.saltoKickPressed && !attackLockActive && player.onGround) {
        nextKey = "unarmed_salto_kick";
        shouldHoldUntilEnd = true;
        player.saltoKickPressed = false;
        player.attackCooldown = 0.2;
      }
      else if (player.jabHighDoublePressed && !attackLockActive && player.onGround) {
        nextKey = "unarmed_jab_high_double";
        shouldHoldUntilEnd = true;
        player.jabHighDoublePressed = false;
        player.attackCooldown = 0.15;
      }
      // Pistol shoot (only when idle - movement animations handle shooting while moving)
      else if (player.shootPressed && !attackLockActive && player.onGround && currentMotionState === 'idle') {
        nextKey = "pistol_shoot";
        shouldHoldUntilEnd = true;
        player.shootPressed = false;
        player.attackCooldown = 0.15;
      }
      // Sword slash
      else if (player.slashPressed && !attackLockActive && player.onGround) {
        nextKey = "sword_slash";
        shouldHoldUntilEnd = true;
        // Don't reset slashPressed here - let it be controlled by input release only
        // This prevents spam when holding the button
        player.attackCooldown = 0.15;
      }
      // Sword block
      else if (player.blockPressed && !attackLockActive && player.onGround) {
        nextKey = "sword_block_center";
        shouldHoldUntilEnd = true;
        // Don't reset blockPressed here - let it be controlled by input release only
        player.attackCooldown = 0.1;
      }
      // Jump (high priority - can interrupt run_stop)
      else if (!player.onGround) {
        nextKey = player.animWeapon === 'pistol' ? "pistol_jump" : 
                  player.animWeapon === 'sword' ? "sword_jump" : 
                  "unarmed_jump";
      }
      // Run_stop (but can be interrupted)
      else if (shouldRunStop) {
        const prefix = player.animWeapon === 'pistol' ? 'pistol' : 
                      player.animWeapon === 'sword' ? 'sword' : 
                      'unarmed';
        nextKey = `${prefix}_run_stop`;
        shouldHoldUntilEnd = true;
      }
      // Continue run_stop if still holding
      else if (player.animHoldUntilEnd && player.animKey.includes("_run_stop")) {
        nextKey = player.animKey;
        shouldHoldUntilEnd = true;
      }
      // Use shift-based motion state with shooting variants for pistol
      else if (currentMotionState === 'run') {
        if (player.animWeapon === 'pistol' && input.shootHeld) {
          nextKey = "pistol_run_shoot";
        } else {
          nextKey = player.animWeapon === 'pistol' ? "pistol_run" : 
                    player.animWeapon === 'sword' ? "sword_run" : 
                    "unarmed_run";
        }
      }
      else if (currentMotionState === 'walk') {
        if (player.animWeapon === 'pistol' && input.shootHeld) {
          nextKey = "pistol_walk_shoot";
        } else {
          nextKey = player.animWeapon === 'pistol' ? "pistol_walk" : 
                    player.animWeapon === 'sword' ? "sword_walk" : 
                    "unarmed_walk";
        }
      }
      else {
        nextKey = player.animWeapon === 'pistol' ? "pistol_idle" : 
                  player.animWeapon === 'sword' ? "sword_idle" : 
                  "unarmed_idle";
      }
      // Check if we need to restart the same attack (key still held after completion)
      const needsRestart = nextKey === player.animKey && 
                          shouldHoldUntilEnd && 
                          !player.animHoldUntilEnd &&
                          isAttacking;
      
      // Switch animation if different OR restart if needed
      if (nextKey !== player.animKey) {
        player.animKey = nextKey;
        player.animFrame = 0; // Reset to start of new animation
        player.animHoldUntilEnd = shouldHoldUntilEnd;
      } else if (needsRestart) {
        // Same attack, key still held, restart from beginning
        player.animFrame = 0;
        player.animHoldUntilEnd = shouldHoldUntilEnd;
      } else {
        // Same animation - just update hold state without resetting frame
        player.animHoldUntilEnd = shouldHoldUntilEnd;
      }
      // Update facing and advance frame
      const clip = globalClips.clips[player.animKey];
      if (clip && clip.images.length > 0) {
        const prevFrame = Math.floor(player.animFrame);
        
        // For pistol_shoot, dynamically adjust fps based on weapon fire rate
        // This makes the animation duration match the weapon's fire rate perfectly
        let effectiveFps = clip.fps;
        if (player.animKey === 'pistol_shoot') {
          const weapon = player.weapons[player.currentWeapon];
          if (weapon) {
            // Calculate fps so animation duration = fireRateMs
            // fps = frames / seconds = frames / (fireRateMs / 1000)
            effectiveFps = clip.images.length / (weapon.fireRateMs / 1000);
          }
        }
        
        player.animFrame += effectiveFps * dt;
        const currFrame = Math.floor(player.animFrame);
        
        // Store frame info for multiplayer hit detection (frame-crossing logic)
        (player as any).prevAnimFrame = prevFrame;
        (player as any).currAnimFrame = currFrame;
        
        // Trigger sound AND bullets on animation frame 1 for pistol_shoot
        // This syncs the audio and bullet spawn with the visual firing animation
        // Fires every time the animation crosses into frame 1 (including loops)
        if (player.animKey === 'pistol_shoot' && prevFrame < 1 && currFrame >= 1) {
          const weapon = player.weapons[player.currentWeapon];
          if (weapon) {
            const wt = weapon.type as WeaponType;
            const ammoCost =
              wt === 'shotgun' ? 2 : wt === 'rocket' ? 4 : wt === 'railgun' ? 5 : wt === 'grenade' ? 3 : wt === 'bomb' ? 4 : wt === 'laser' ? 2 : wt === 'plasma' ? 2 : wt === 'beam' ? 3 : wt === 'lightning' ? 2 : wt === 'cluster' ? 4 : (wt === 'boomerang' || wt === 'wand' || wt === 'axe' || wt === 'spear' ? 0 : 1);
            if (player.ammo >= ammoCost) {
              player.ammo = Math.max(0, player.ammo - ammoCost);
              playShoot(wt);
              spawnBullets();
            } else {
              spawnText(player.position.x, player.position.y - 40, 'NO AMMO', '#ff6666', 12);
            }
          }
        }

        const meleeAudioData = MELEE_ATTACK_DATA[player.animKey];
        const audioTriggerFrames = meleeAudioData?.audioTriggerFrames && meleeAudioData.audioTriggerFrames.length > 0
          ? meleeAudioData.audioTriggerFrames
          : [meleeAudioData?.audioTriggerFrame ?? 1];
        const audioTriggeredThisStep =
          meleeAudioData && audioTriggerFrames.some(frame => prevFrame < frame && currFrame >= frame);

        if (audioTriggeredThisStep) {
          playMeleeSwingSound(meleeAudioData!.soundType);

          // Trigger kick-specific effects on configured frame
          const kickAnimations = [
            'unarmed_kick_high',
            'unarmed_kick_low',
            'unarmed_reverse_kick',
            'unarmed_salto_kick'
          ];
          const isKick = kickAnimations.includes(player.animKey);

          if (isKick) {
          // Kickback effect (opposite direction)
          player.velocity.x -= player.facing * 200;
          // Shockwave at hit location (in front of player)
          const hitX = player.position.x + player.facing * 40;
          const hitY = player.position.y;
          const kickRange = 60;
          const kickDamage = 35;
          const kickKnockback = 300;
          
          shockwaves.push({ x: hitX, y: hitY, r: 12, lifeMs: 250, thickness: 4, color: '#ffffff' });
          
          // Check for enemy hits
          // ===== PERFORMANCE: Use spatial hash for melee attacks =====
          const meleeRange = 150; // Max reach of melee attacks
          const nearbyForMelee = enemyGrid.query(hitX, hitY, meleeRange);
          let hitAnyEnemy = false;
          for (const e of nearbyForMelee) {
            if (e.invulnMs > 0) continue; // Skip if enemy is invulnerable
            const dx = e.position.x - hitX;
            const dy = e.position.y - hitY;
            const dist = Math.hypot(dx, dy);
            if (dist <= kickRange + e.radius) {
              e.hp -= kickDamage;
              e.flashMs = 120;
              e.invulnMs = 250; // Brief invulnerability to prevent multi-hit
              player.score += Math.floor(kickDamage * 0.5);
              spawnText(e.position.x, e.position.y - e.radius - 20, `-${kickDamage}`, '#ff6b6b');
              playHitEffect();
              playMeleeImpact();
              // Knockback
              const angle = Math.atan2(dy, dx);
              e.velocity.x += Math.cos(angle) * kickKnockback;
              e.velocity.y += Math.sin(angle) * kickKnockback - 60;
          hitAnyEnemy = true;
            }
          }
          
          // Enhanced effects if we hit something
          if (hitAnyEnemy) {
            cameraShake.ms = 300;
            cameraShake.magnitude = 24;
            hitstopMs = Math.max(hitstopMs, 60);
          } else {
            cameraShake.ms = 200;
            cameraShake.magnitude = 16;
          }
          
          // Particles for impact
          for (let i = 0; i < 12; i++) {
            const a = (player.facing > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * Math.PI * 0.8;
            pushParticle({
              position: { x: hitX, y: hitY },
              velocity: { x: Math.cos(a) * (200 + Math.random() * 150), y: Math.sin(a) * (200 + Math.random() * 150) },
              lifeMs: 300 + Math.random() * 200,
              size: 2 + Math.random() * 3,
              color: '#ffaa66',
              gravity: 800,
              fade: 0.003,
            });
          }
          }
        }
        // Enhanced melee system - check all attack types
        if (MELEE_ATTACK_DATA[player.animKey]) {
          processMeleeAttack(player, currFrame, prevFrame);
        }
        
        if (clip.loop) {
          // Perfect smooth looping - wrap without ever hitting frame count
          const totalFrames = clip.images.length;
          while (player.animFrame >= totalFrames) {
            player.animFrame -= totalFrames;
          }
          while (player.animFrame < 0) {
            player.animFrame += totalFrames;
          }
        } else {
          // Non-looping animations
          const wasComplete = player.animFrame >= clip.images.length;
          player.animFrame = Math.min(player.animFrame, clip.images.length - 0.01); // Stay on last frame
          
          // Release hold when animation truly completes (reached the end)
          if (wasComplete && player.animHoldUntilEnd) {
            player.animHoldUntilEnd = false;
          }
        }
      }
      
      // Update previous state for next frame
      player.previousVelocityX = player.velocity.x;
      
      // Reset wasShiftHeld if we're not running anymore
      if (currentMotionState !== 'run') {
        // Keep it true briefly to allow run_stop to trigger
        if (Math.abs(player.velocity.x) < 10) {
          // Only clear it when actually stopped
          wasShiftHeld = false;
        }
      }
      
      player.velocity.y += world.gravity * dt;

      // Jump buffering and coyote time handling
      const jumpPressed = input.up;
      let justJumped = false;
      if (input.up) { jumpBufferedMs = jumpBufferWindowMs; input.up = false; }
      if (player.onGround) coyoteMs = coyoteTimeWindowMs; else coyoteMs = Math.max(0, coyoteMs - dt * 1000);
      if (jumpBufferedMs > 0) jumpBufferedMs = Math.max(0, jumpBufferedMs - dt * 1000);
      const wantsJump = jumpBufferedMs > 0;
      if (wantsJump) {
        if (player.onGround || coyoteMs > 0) {
          player.velocity.y = world.jumpVelocity;
          player.onGround = false;
          player.canDoubleJump = true;
          jumpBufferedMs = 0;
          justJumped = true;
        } else if (player.canDoubleJump) {
          player.velocity.y = world.jumpVelocity * 0.9;
          player.canDoubleJump = false;
          jumpBufferedMs = 0;
          justJumped = true;
        }
      }
      // Jetpack removed

      // Integrate
      player.position.x += player.velocity.x * dt;
      player.position.y += player.velocity.y * dt;

      // Map boundaries - constrain player to arena
      const mapBounds = currentMapRef.current.boundaries;
      if (mapBounds) {
        if (player.position.x < mapBounds.left + player.radius) {
          player.position.x = mapBounds.left + player.radius;
          player.velocity.x = Math.max(0, player.velocity.x);
        }
        if (player.position.x > mapBounds.right - player.radius) {
          player.position.x = mapBounds.right - player.radius;
          player.velocity.x = Math.min(0, player.velocity.x);
        }
      }

      // Collisions with terrain
      collideCircleWithTerrain(player.position, player.radius, player);
      // Collisions with platforms (top-only)
      collideCircleWithPlatformsTop(player.position, player.radius, player);
      applyPlatformFeatureEffects(player);

      // Camera follow with shake
      const targetCameraX = player.position.x - canvas.clientWidth * 0.5;
      const targetCameraY = player.position.y - canvas.clientHeight * 0.5;
      camera.x += (targetCameraX - camera.x) * camera.lerp;
      camera.y += (targetCameraY - camera.y) * camera.lerp;
      
      if (cameraShake.ms > 0) {
        // Enhanced camera shake with decay and directional bias
        const shakeProgress = cameraShake.ms / (cameraShake.ms + dt * 1000);
        const intensity = cameraShake.magnitude * shakeProgress;
        
        // Add both high frequency and low frequency shake
        const highFreq = Math.sin(totalTimeMs * 0.3) * (Math.random() - 0.5);
        const lowFreq = Math.sin(totalTimeMs * 0.05) * 0.3;
        
        camera.x += (highFreq + lowFreq) * intensity * 1.2;
        camera.y += (Math.random() - 0.5) * intensity * 0.6 * shakeProgress;
        
        cameraShake.ms -= dt * 1000;
        if (cameraShake.ms < 0) cameraShake.ms = 0;
      }
      // Generate environment and enemies around player
      // ===== PERFORMANCE: Only generate platforms if player moved significantly =====
      // Avoid expensive chunk checking every single frame
      const platformCheckDistance = 300; // Only check every 300 pixels of movement
      const lastCheckX = (player as any).lastPlatformCheckX as number | undefined;
      if (!lastCheckX || Math.abs(player.position.x - lastCheckX) > platformCheckDistance) {
        ensurePlatformsAround(player.position.x);
        (player as any).lastPlatformCheckX = player.position.x;
      }
      
      updatePlatformMotion(dt);
      updatePlatformFeatures(dt, player);
      // Waves logic
      if (settingsRef.current.visual.aiEnabled) {
        if (gameConfigRef.current.mode === 'PvP') {
          // PvP mode: No AI enemies, players fight each other
          // Remote players are rendered separately
        } else {
          // Infinite mode with controlled progressive spawning
          // Dynamic concurrent limit that scales slowly with progression
          waveMaxConcurrent = Math.min(3, 1 + Math.floor(wave / 5)); // 1-2 enemies early, max 3 later
          
          // Spawn new enemies when conditions are met:
          // 1. Below the concurrent limit
          // 2. Player has moved forward significantly OR few/no enemies remain
          const playerMovedForward = player.position.x > lastSpawnX + progressionDistance;
          const needsMoreEnemies = enemies.length === 0 || (enemies.length < waveMaxConcurrent && playerMovedForward);
          
          if (needsMoreEnemies && enemies.length < waveMaxConcurrent) {
            // Determine enemy type based on wave progression
                const typeRoll = Math.random();
            let type: EnemyType;
            
            if (wave >= 10 && Math.random() < 0.08) {
              // Rare boss spawn at higher waves
              type = "boss";
            } else if (wave >= 7) {
              // Higher waves: more variety
              type = typeRoll < 0.35 ? "grunt" : 
                     typeRoll < 0.60 ? "ranger" : 
                     typeRoll < 0.80 ? "brute" : "duelist";
            } else if (wave >= 4) {
              // Mid waves: introduce harder enemies
              type = typeRoll < 0.50 ? "grunt" : 
                     typeRoll < 0.80 ? "ranger" : "brute";
            } else {
              // Early waves: mostly grunts and rangers
              type = typeRoll < 0.70 ? "grunt" : "ranger";
            }
            
            spawnEnemyNear(player.position.x, type);
            lastSpawnX = player.position.x;
          }
        }
      }
      // Shooting
      if (input.shootHeld) shootIfPossible();
      // Bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.lifeMs -= dt * 1000;
        if (b.gravity) b.velocity.y += b.gravity * dt;
        b.position.x += b.velocity.x * dt;
        b.position.y += b.velocity.y * dt;

        // Simple per-weapon trails
        if (b.from === 'player') {
          b.trailMs = (b.trailMs || 0) + dt * 1000;
          const spawnEvery = (b.type === 'laser') ? 14 : (b.type === 'plasma' ? 18 : (b.type === 'rocket' || b.type==='bomb' || b.type==='grenade') ? 24 : 22);
          if (b.trailMs >= spawnEvery) {
            b.trailMs = 0;
            const fx = WEAPON_FX[b.type] || WEAPON_FX.pistol;
          pushParticle({ position: { x: b.position.x, y: b.position.y }, velocity: { x: 0, y: 0 }, lifeMs: 200, size: 1.6, color: fx.trailColor, gravity: 0, fade: 0.01 });
          }
        }

        // Boomerang behavior
        if (b.boomerang) {
          if (b.boomerangPhase === 'out') {
            const dx0 = (b.startPos!.x - b.position.x);
            const dy0 = (b.startPos!.y - b.position.y);
            const dist = Math.hypot(dx0, dy0);
            if (dist > (b.maxRange || 360)) {
              b.boomerangPhase = 'return';
            }
          } else {
            const dxp = player.position.x - b.position.x;
            const dyp = player.position.y - b.position.y;
            const len = Math.hypot(dxp, dyp) || 1;
            const homing = 900 * dt;
            b.velocity.x += (dxp/len) * homing;
            b.velocity.y += (dyp/len) * homing;
            // Despawn when returned to player
            if (Math.hypot(dxp, dyp) < player.radius + 8) {
              bullets.splice(i, 1);
              continue;
            }
          }
        }

        // Mild homing for wand
        if (b.type === 'wand') {
          // Seek nearest enemy within radius
          // ===== PERFORMANCE: Use spatial hash for wand seeking =====
          const nearbyForWand = enemyGrid.query(b.position.x, b.position.y, 420);
          let nearest: Enemy | null = null;
          let nearestDist = 420;
          for (const e of nearbyForWand) {
            const dx = e.position.x - b.position.x;
            const dy = e.position.y - b.position.y;
            const d = Math.hypot(dx, dy);
            if (d < nearestDist) { nearestDist = d; nearest = e; }
          }
          if (nearest) {
            const dx = nearest.position.x - b.position.x;
            const dy = nearest.position.y - b.position.y;
            const len = Math.hypot(dx, dy) || 1;
            const steer = 600 * dt;
            b.velocity.x += (dx/len) * steer;
            b.velocity.y += (dy/len) * steer;
          }
        }

        const gy = groundYAt(b.position.x);
        if (b.type === "rocket" || b.type === 'bomb') {
          if (b.position.y >= gy) {
            explode(b.position.x, gy - 2, b.type==='bomb'? 180:140, b.type==='bomb'? 1100:900, b.type==='bomb'? 95:85);
            cameraShake.ms = Math.max(cameraShake.ms, 600);
            cameraShake.magnitude = Math.max(cameraShake.magnitude, 56);
            bullets.splice(i, 1);
            continue;
          }
        } else if (b.type === "grenade") {
          b.velocity.y += (b.gravity || 0) * dt;
          if (b.position.y >= gy) {
            b.position.y = gy - 2;
            if (Math.abs(b.velocity.y) > 300) {
              explode(b.position.x, b.position.y, 130, 800, 70);
              cameraShake.ms = Math.max(cameraShake.ms, 440);
              cameraShake.magnitude = Math.max(cameraShake.magnitude, 44);
              // Cluster bomblets
              if (player.weapons[player.currentWeapon]?.type === 'cluster') {
                for (let n=0;n<6;n++) {
                  const a = Math.random()*Math.PI*2;
                  const sp = 700 + Math.random()*400;
                  bullets.push({ position: { x: b.position.x, y: b.position.y-4 }, velocity: { x: Math.cos(a)*sp, y: Math.sin(a)*sp }, lifeMs: 700, damage: 10, radius: 3, from: 'player', type: 'bomb', gravity: 1500, trailMs: 0 });
                }
              }
              bullets.splice(i, 1);
              continue;
            }
            b.velocity.y *= -0.35;
            b.velocity.x *= 0.8;
          }
          if (b.lifeMs <= 0) {
            explode(b.position.x, b.position.y, 130, 800, 70);
            cameraShake.ms = Math.max(cameraShake.ms, 440);
            cameraShake.magnitude = Math.max(cameraShake.magnitude, 44);
            // Cluster bomblets
            if (player.weapons[player.currentWeapon]?.type === 'cluster') {
              for (let n=0;n<6;n++) {
                const a = Math.random()*Math.PI*2;
                const sp = 700 + Math.random()*400;
                bullets.push({ position: { x: b.position.x, y: b.position.y-4 }, velocity: { x: Math.cos(a)*sp, y: Math.sin(a)*sp }, lifeMs: 700, damage: 10, radius: 3, from: 'player', type: 'bomb', gravity: 1500, trailMs: 0 });
              }
            }
            bullets.splice(i, 1);
            continue;
          }
        } else {
          if (b.position.y >= gy) {
            // Ground impact sparks colored by weapon
            for (let s = 0; s < 8; s++) {
              const a = Math.random() * Math.PI - Math.PI / 2;
              const sp = 200 + Math.random() * 200;
              const fx = WEAPON_FX[b.type] || WEAPON_FX.pistol;
            pushParticle({ position: { x: b.position.x, y: gy - 2 }, velocity: { x: Math.cos(a) * sp, y: Math.sin(a) * sp }, lifeMs: 200 + Math.random() * 200, size: 2, color: fx.sparkColor, gravity: 1200, fade: 0.006 });
            }
            bullets.splice(i, 1);
            continue;
          }
        }

        // Rocket smoke trails
        if (b.type === 'rocket' || b.type === 'bomb') {
          if (Math.random() < 0.6) {
            pushParticle({ position: { x: b.position.x, y: b.position.y }, velocity: { x: (Math.random()-0.5)*30, y: (Math.random()-0.5)*30 }, lifeMs: 500, size: 3 + Math.random()*2, color: 'rgba(200,200,200,0.9)', gravity: 0, fade: 0.003 });
          }
        }
        // Enemy hit (skip in multiplayer - bullets should only hit remote players in PvP)
        if (b.from === "player" && !multiplayerStateRef.current.isMultiplayerGame) {
          // ===== PERFORMANCE: Use spatial hash grid instead of checking ALL enemies =====
          // Old: O(bullets * enemies) = 50 * 20 = 1,000 checks
          // New: O(bullets * nearby_enemies) = 50 * 2-5 = 100-250 checks (10x faster!)
          const nearbyEnemies = enemyGrid.query(b.position.x, b.position.y, 150);
          
          for (const e of nearbyEnemies) {
            const dx = e.position.x - b.position.x;

            // Enemy visual center sits significantly above physics circle center
            const enemySpriteHeight = STICKMAN_BOUNDS.visibleHeight * BASE_SPRITE_SCALE * (e.radius / DEFAULT_PLAYER_RADIUS);
            const enemyCenterY = e.position.y - enemySpriteHeight * 0.42; // roughly torso center
            const dy = enemyCenterY - b.position.y;
            const enemyHitRadius = Math.max(enemySpriteHeight * 0.32, e.radius * 1.8, 36);
            const bulletRadius = (b.type === 'flame' || b.type === 'ice' || b.type === 'plasma') ? 22 : Math.max(b.radius || 4, 10);
            const dist = Math.hypot(dx, dy);
            if (dist <= enemyHitRadius + (b.type === "rocket" ? 0 : bulletRadius)) {
              if (b.type === "rocket" || b.type === 'bomb') {
                explode(b.position.x, b.position.y, b.type==='bomb'? 180:160, b.type==='bomb'? 1100:950, b.type==='bomb'? 95:90);
                cameraShake.ms = Math.max(cameraShake.ms, 600);
                cameraShake.magnitude = Math.max(cameraShake.magnitude, 56);
                bullets.splice(i, 1);
                break;
              } else if (b.type === "grenade") {
                explode(b.position.x, b.position.y, 130, 800, 70);
                cameraShake.ms = Math.max(cameraShake.ms, 440);
                cameraShake.magnitude = Math.max(cameraShake.magnitude, 44);
                bullets.splice(i, 1);
                break;
              } else {
                                 // piercing logic with per-bullet per-enemy guard
                 if (!b.hitIds) b.hitIds = new Set();
                 if (b.hitIds.has(e.id)) {
                   continue;
                 }
                e.hp -= b.damage;
                 e.flashMs = 120;
                 
                 // Trigger hurt animation for enemy
                 triggerHurtAnimation(e);
                 
                 player.score += Math.floor(b.damage * 0.5); // Score for damage
                 b.hitIds.add(e.id);
                 spawnHitSpark(b.position.x, b.position.y, b.type);
                 playHitEffect();
                 
                 // Shockwave at impact point
                 const profile = BULLET_IMPACT_PROFILES[b.type] || DEFAULT_BULLET_IMPACT;
                 shockwaves.push({ x: b.position.x, y: b.position.y, r: profile.shock, lifeMs: 220, thickness: 4, color: '#ffffff' });
                 
                 // Pushback/knockback on enemy
                 const angle = Math.atan2(enemyCenterY - b.position.y, dx);
                 const profileAngle = BULLET_IMPACT_PROFILES[b.type] || DEFAULT_BULLET_IMPACT;
                 const knockbackStrength = profileAngle.knock;
                 e.velocity.x += Math.cos(angle) * knockbackStrength;
                 e.velocity.y += Math.sin(angle) * knockbackStrength * 0.62 - 80;
                 
                 // Camera shake (doubled)
                 const shakeProfile = BULLET_IMPACT_PROFILES[b.type] || DEFAULT_BULLET_IMPACT;
                 cameraShake.ms = Math.max(cameraShake.ms, shakeProfile.shake);
                 cameraShake.magnitude = Math.max(cameraShake.magnitude, shakeProfile.shake * 0.35);
                 
                 if (b.type === "flame") eDot.burn(e, 400, 2);
                 if (b.type === "ice") eDot.slow(e, 600, 0.45);
                 if (typeof b.pierce === 'number' && b.pierce > 0) {
                   b.pierce -= 1;
                 } else {
                   bullets.splice(i, 1);
                 }
                 // Reward bonus knockback hits with floating text if configured
                 if ((profileAngle.hitBonus || 0) > 0) {
                   spawnText(e.position.x, enemyCenterY - 28, `+${profileAngle.hitBonus}`, '#ffd966', 16);
                   player.score += profileAngle.hitBonus || 0;
                 }
                 break;
              }
            }
          }
        }
        
        // ===== Multiplayer: Local Player Bullets Hit Remote Players (PvP) =====
        if (b.from === "player" && multiplayerStateRef.current.isMultiplayerGame) {
          const remotePlayers = remotePlayersRef.current;
          if (!remotePlayers || remotePlayers.size === 0) {
            // No remote targets to check
            continue;
          }

          const targetRadius = DEFAULT_PLAYER_RADIUS;
          let bulletRemoved = false;
          const remotePlayerEntries = Array.from(remotePlayers.entries());

          for (const [remoteId, remotePlayer] of remotePlayerEntries) {
            if (bulletRemoved) break;

            // Use authoritative position (same as melee system) for consistency
            const remotePos = remotePlayer.position;
            if (!remotePos) continue;

            const remoteRadius = targetRadius;
            const remoteScale = remoteRadius / DEFAULT_PLAYER_RADIUS;
            const remoteSpriteHeight = STICKMAN_BOUNDS.visibleHeight * BASE_SPRITE_SCALE * remoteScale;
            const remoteCenterY = remotePos.y - remoteSpriteHeight * 0.42;
            const remoteHitRadius = Math.max(remoteSpriteHeight * 0.32, remoteRadius * 1.8, 36);

            const dx = remotePos.x - b.position.x;
            const dy = remoteCenterY - b.position.y;
            const dist = Math.hypot(dx, dy);
            const bulletRadius = (b.type === 'flame' || b.type === 'ice' || b.type === 'plasma') ? 22 : Math.max(b.radius || 4, 10);

            if (dist > remoteHitRadius + (b.type === 'rocket' || b.type === 'bomb' ? 0 : bulletRadius)) {
              continue;
            }

            if (b.type !== 'rocket' && b.type !== 'bomb' && b.type !== 'grenade') {
              // Use precise collision box for standard projectiles (same as melee)
              const hit = CollisionUtils.checkPointVsCharacterBox(
                b.position.x,
                b.position.y,
                bulletRadius,
                remotePos.x,
                remotePos.y,
                true,
                collisionSettingsRef.current
              );
              if (!hit) {
                continue;
              }
            }

            // Prevent multi-hit per bullet using a string-based tracking
            const anyBullet = b as any;
            if (!anyBullet.hitRemotePlayerIds) anyBullet.hitRemotePlayerIds = new Set<string>();
            if (anyBullet.hitRemotePlayerIds.has(remoteId)) {
              continue;
            }
            
            // ===== Handle Explosive Projectiles (Rocket/Bomb/Grenade) =====
            if (b.type === "rocket" || b.type === 'bomb' || b.type === 'grenade') {
              const explosionDamage = b.type === 'bomb' ? 95 : b.type === 'rocket' ? 85 : 70;
              const explosionRadius = b.type === 'bomb' ? 180 : b.type === 'rocket' ? 140 : 130;
              
              // Trigger explosion visual/audio
              explode(b.position.x, b.position.y, explosionRadius, b.type==='bomb'? 1100 : b.type==='rocket'? 900 : 800, explosionDamage);
              cameraShake.ms = Math.max(cameraShake.ms, b.type === 'bomb' ? 600 : b.type === 'rocket' ? 600 : 440);
              cameraShake.magnitude = Math.max(cameraShake.magnitude, b.type === 'bomb' ? 56 : b.type === 'rocket' ? 56 : 44);
              
              // Damage all remote players in explosion radius
              for (const [explosionRemoteId, explosionRemotePlayer] of remotePlayerEntries) {
                const explosionPos = explosionRemotePlayer.position;
                if (!explosionPos) continue;
                const explosionRadiusTarget = targetRadius;
                const explosionScale = explosionRadiusTarget / DEFAULT_PLAYER_RADIUS;
                const explosionSpriteHeight = STICKMAN_BOUNDS.visibleHeight * BASE_SPRITE_SCALE * explosionScale;
                const explosionCenterY = explosionPos.y - explosionSpriteHeight * 0.42;
                const explosionHitRadius = Math.max(explosionSpriteHeight * 0.32, explosionRadiusTarget * 1.8, 36);
                const eDx = explosionPos.x - b.position.x;
                const eDy = explosionCenterY - b.position.y;
                const eDist = Math.hypot(eDx, eDy);
                
                if (eDist <= explosionRadius + explosionHitRadius) {
                  const damageMultiplier = 1 - (eDist / (explosionRadius + explosionHitRadius));
                  const finalDamage = Math.floor(explosionDamage * damageMultiplier);
                  const knockbackAngle = Math.atan2(eDy, eDx);
                  const knockbackStrength = 400 * damageMultiplier;
                  
                  // Send explosion hit to network
                  const channel = multiplayerStateRef.current.roomChannel;
                  if (channel) {
                    safeChannelPublish(channel, 'playerHit', {
                      victimId: explosionRemoteId,
                      attackerId: localPlayerId.current,
                      damage: finalDamage,
                      attackType: 'explosion_' + b.type,
                      knockbackX: Math.cos(knockbackAngle) * knockbackStrength,
                      knockbackY: Math.sin(knockbackAngle) * knockbackStrength - 100,
                      hitPosition: { x: explosionPos.x, y: explosionCenterY },
                      cameraShake: 150,
                      hitStun: 40,
                      effectColor: '#ff6b6b',
                      effectIntensity: 1.8,
                      timestamp: Date.now()
                    });
                  }
                  
                  // Update remote player health immediately
                  setRemotePlayers(prev => {
                    const updated = new Map(prev);
                    const victim = updated.get(explosionRemoteId);
                    if (victim) {
                      victim.health = Math.max(0, victim.health - finalDamage);
                      updated.set(explosionRemoteId, victim);
                    }
                    return updated;
                  });
                  
                  // Visual feedback
                  spawnText(
                    explosionPos.x,
                    explosionCenterY - explosionHitRadius * 0.6,
                    `-${finalDamage}`,
                    '#ff6b6b'
                  );
                  
                  player.score += Math.floor(finalDamage * 0.5);
                }
              }
              
              // Remove the explosive bullet
              bullets.splice(i, 1);
              bulletRemoved = true;
              break;
            }
            
            // ===== Handle Regular Bullets =====
            // Calculate knockback
            const bulletAngle = Math.atan2(b.velocity.y, b.velocity.x);
            const profile = BULLET_IMPACT_PROFILES[b.type] || DEFAULT_BULLET_IMPACT;
            const knockbackStrength = profile.knock || 250;
            const knockbackX = Math.cos(bulletAngle) * knockbackStrength;
            const knockbackY = Math.sin(bulletAngle) * knockbackStrength * 0.6 - 80;
            
            // Send hit event to network
            const channel = multiplayerStateRef.current.roomChannel;
            if (channel) {
              safeChannelPublish(channel, 'playerHit', {
                victimId: remoteId,
                attackerId: localPlayerId.current,
                damage: b.damage,
                attackType: 'bullet_' + b.type,
                knockbackX,
                knockbackY,
                hitPosition: { x: remotePos.x, y: remotePos.y },
                cameraShake: profile.shake || 60,
                hitStun: 20,
                effectColor: '#ff6b6b',
                effectIntensity: 1.3,
                timestamp: Date.now()
              });
            }
            
            // ===== Attacker-Side Local Feedback =====
            // Update remote player's health bar immediately
            setRemotePlayers(prev => {
              const updated = new Map(prev);
              const victim = updated.get(remoteId);
              if (victim) {
                victim.health = Math.max(0, victim.health - b.damage);
                updated.set(remoteId, victim);
              }
              return updated;
            });
            
            // Visual feedback
            spawnText(
              remotePos.x,
              remotePos.y - remoteRadius - 20,
              `-${b.damage}`,
              '#ff6b6b'
            );
            
            spawnHitSpark(b.position.x, b.position.y, b.type);
            playHitEffect();
            
            // Score reward
            player.score += Math.floor(b.damage * 0.5);
            
            // Camera shake for hit confirmation
            cameraShake.ms = Math.max(cameraShake.ms, profile.shake || 60);
            cameraShake.magnitude = Math.max(cameraShake.magnitude, (profile.shake || 60) * 0.35);
            
            // Shockwave at impact point
            shockwaves.push({ x: b.position.x, y: b.position.y, r: profile.shock || 10, lifeMs: 220, thickness: 4, color: '#ffffff' });
            
            // Handle pierce or remove bullet
            anyBullet.hitRemotePlayerIds.add(remoteId);
            if (typeof b.pierce === 'number' && b.pierce > 0) {
              b.pierce -= 1;
            } else {
              bullets.splice(i, 1);
              bulletRemoved = true;
            }
          }
          if (bulletRemoved) continue;
        }
        
        // Player hit by bullets (enemy bullets in PvE, OR remote player bullets in PvP)
        if (b.from === "enemy") {
          const dx = player.position.x - b.position.x;
          const dy = player.position.y - b.position.y;
          const dist = Math.hypot(dx, dy);
          const bulletRadius = (b.type === 'flame' || b.type === 'ice' || b.type === 'plasma') ? 22 : Math.max(b.radius || 4, 10);
          
          if (dist <= player.radius + bulletRadius && player.invulnMs <= 0) {
            const bulletAngle = Math.atan2(b.velocity.y, b.velocity.x);
            const knockbackStrength = 250;
            
            // Apply PvP damage with full effects
            applyPvPDamage(
              b.damage,
              Math.cos(bulletAngle) * knockbackStrength,
              Math.sin(bulletAngle) * knockbackStrength * 0.6 - 80,
              {
                cameraShake: b.type === 'rocket' ? 150 : b.type === 'bomb' ? 150 : b.type === 'shotgun' ? 80 : 60,
                hitStun: b.type === 'rocket' || b.type === 'bomb' ? 40 : 20,
                effectColor: '#ff6b6b',
                effectIntensity: b.type === 'rocket' || b.type === 'bomb' ? 1.8 : 1.3
              }
            );
            
            spawnHitSpark(player.position.x, player.position.y, b.type);
            
            // Blood particles
            for (let p = 0; p < 8; p++) {
              const bleedAngle = bulletAngle + (Math.random() - 0.5) * Math.PI * 0.6;
              pushParticle({
                position: { x: player.position.x, y: player.position.y - player.radius * 0.2 },
                velocity: { x: Math.cos(bleedAngle) * (160 + Math.random() * 160), y: Math.sin(bleedAngle) * (120 + Math.random() * 120) },
                lifeMs: 380 + Math.random() * 240,
                size: 1.8 + Math.random() * 1.6,
                color: '#6e0000',
                gravity: 1600,
                fade: 0.0035,
              });
            }
            
            playHitEffect();
            playMeleeImpact();
            
            // Remove bullet
            if (typeof b.pierce === 'number' && b.pierce > 0) {
              b.pierce -= 1;
            } else {
              bullets.splice(i, 1);
            }
          }
        }
        
        // Lifetime
        if (i < bullets.length && b.lifeMs <= 0) {
          if (b.type === "rocket" || b.type==='bomb') {
            const explosionDamage = b.type==='bomb'? 95:85;
            const explosionRadius = b.type==='bomb'? 180:140;
            
            explode(b.position.x, b.position.y, explosionRadius, b.type==='bomb'? 1100:900, explosionDamage);
            dynamicLights.push({ x: b.position.x, y: b.position.y, r: (b.type==='bomb'? 260:220), color: 'rgba(255,209,102,1)', a: 0.85, decay: 0.01 });
            if (dynamicLights.length > MAX_DYNAMIC_LIGHTS) dynamicLights.splice(0, dynamicLights.length - MAX_DYNAMIC_LIGHTS);
            
            // Check explosion area damage on player (for remote bullets in PvP)
            if (b.from === "enemy") {
              const dx = player.position.x - b.position.x;
              const dy = player.position.y - b.position.y;
              const dist = Math.hypot(dx, dy);
              
              if (dist <= explosionRadius + player.radius && player.invulnMs <= 0) {
                const damageMultiplier = 1 - (dist / (explosionRadius + player.radius));
                const finalDamage = Math.floor(explosionDamage * damageMultiplier);
                const knockbackAngle = Math.atan2(dy, dx);
                const knockbackStrength = 400 * damageMultiplier;
                
                applyPvPDamage(
                  finalDamage,
                  Math.cos(knockbackAngle) * knockbackStrength,
                  Math.sin(knockbackAngle) * knockbackStrength - 100,
                  {
                    cameraShake: 150,
                    hitStun: 40,
                    effectColor: '#ff6b6b',
                    effectIntensity: 1.8
                  }
                );
                
                for (let p = 0; p < 12; p++) {
                  const bleedAngle = knockbackAngle + (Math.random() - 0.5) * Math.PI * 0.8;
                  pushParticle({
                    position: { x: player.position.x, y: player.position.y - player.radius * 0.2 },
                    velocity: { x: Math.cos(bleedAngle) * (180 + Math.random() * 180), y: Math.sin(bleedAngle) * (140 + Math.random() * 140) },
                    lifeMs: 400 + Math.random() * 250,
                    size: 2 + Math.random() * 2,
                    color: '#6e0000',
                    gravity: 1600,
                    fade: 0.0035,
                  });
                }
                
                playHitEffect();
                playMeleeImpact();
              }
            }
            
            // Check explosion area damage on remote players (for local player explosives in PvP)
            if (b.from === "player" && multiplayerStateRef.current.isMultiplayerGame) {
              const currentRemotePlayers = remotePlayersRef.current;
              const remoteEntries = Array.from(currentRemotePlayers.entries());
              
              for (const [remoteId, remotePlayer] of remoteEntries) {
                const explosionPos = remotePlayer.position;
                if (!explosionPos) continue;
                
                const explosionRadiusTarget = DEFAULT_PLAYER_RADIUS;
                const explosionScale = explosionRadiusTarget / DEFAULT_PLAYER_RADIUS;
                const explosionSpriteHeight = STICKMAN_BOUNDS.visibleHeight * BASE_SPRITE_SCALE * explosionScale;
                const explosionCenterY = explosionPos.y - explosionSpriteHeight * 0.42;
                const explosionHitRadius = Math.max(explosionSpriteHeight * 0.32, explosionRadiusTarget * 1.8, 36);
                
                const dx = explosionPos.x - b.position.x;
                const dy = explosionCenterY - b.position.y;
                const dist = Math.hypot(dx, dy);
                
                if (dist <= explosionRadius + explosionHitRadius) {
                  const damageMultiplier = 1 - (dist / (explosionRadius + explosionHitRadius));
                  const finalDamage = Math.floor(explosionDamage * damageMultiplier);
                  const knockbackAngle = Math.atan2(dy, dx);
                  const knockbackStrength = 400 * damageMultiplier;
                  
                  // Send explosion hit to network
                  const channel = multiplayerStateRef.current.roomChannel;
                  if (channel) {
                    safeChannelPublish(channel, 'playerHit', {
                      victimId: remoteId,
                      attackerId: localPlayerId.current,
                      damage: finalDamage,
                      attackType: 'explosion_timeout_' + b.type,
                      knockbackX: Math.cos(knockbackAngle) * knockbackStrength,
                      knockbackY: Math.sin(knockbackAngle) * knockbackStrength - 100,
                      hitPosition: { x: explosionPos.x, y: explosionCenterY },
                      cameraShake: 150,
                      hitStun: 40,
                      effectColor: '#ff6b6b',
                      effectIntensity: 1.8,
                      timestamp: Date.now()
                    });
                  }
                  
                  // Update remote player health immediately
                  setRemotePlayers(prev => {
                    const updated = new Map(prev);
                    const victim = updated.get(remoteId);
                    if (victim) {
                      victim.health = Math.max(0, victim.health - finalDamage);
                      updated.set(remoteId, victim);
                    }
                    return updated;
                  });
                  
                  // Visual feedback
                  spawnText(
                    explosionPos.x,
                    explosionCenterY - explosionHitRadius * 0.6,
                    `-${finalDamage}`,
                    '#ff6b6b'
                  );
                  
                  player.score += Math.floor(finalDamage * 0.5);
                }
              }
            }
          } else if (b.type === 'plasma') {
            // small plasma splash with moderate damage
            explode(b.position.x, b.position.y, 90, 500, 18);
            dynamicLights.push({ x: b.position.x, y: b.position.y, r: 200, color: 'rgba(176,139,255,1)', a: 0.6, decay: 0.015 });
            if (dynamicLights.length > MAX_DYNAMIC_LIGHTS) dynamicLights.splice(0, dynamicLights.length - MAX_DYNAMIC_LIGHTS);
          }
          bullets.splice(i, 1);
        }
      }
      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.lifeMs -= dt * 1000;
        p.velocity.y += p.gravity * dt;
        p.position.x += p.velocity.x * dt;
        p.position.y += p.velocity.y * dt;
        if (p.lifeMs <= 0) particles.splice(i, 1);
      }

      // Update Proton particles (only if emitters exist for performance)
      if (proton && proton.emitters && proton.emitters.length > 0) {
      proton.update();
      }

      // Floating texts
      for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const ft = floatingTexts[i];
        ft.life -= dt * 1000;
        ft.x += ft.vx * dt;
        ft.y += ft.vy * dt;
        ft.vy += 180 * dt; // slow fall
        if (ft.life <= 0) floatingTexts.splice(i, 1);
      }

      // Rain
      ensureRain();
      for (let i = rainDrops.length - 1; i >= 0; i--) {
        const r = rainDrops[i];
        r.y += r.vy * dt;
        r.x += 200 * dt; // wind
        if (r.y > canvas.height + 20) r.y = -20;
        if (r.x > canvas.width + 20) r.x = -20;
      }

      // Pickup collision
      for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        const dx = p.x - player.position.x;
        const dy = p.y - player.position.y;
        if (Math.hypot(dx, dy) <= player.radius + 16) {
          if (p.type === 'medkit') {
            const heal = Math.floor(player.maxHp * 0.35);
            player.hp = Math.min(player.maxHp, player.hp + heal);
            spawnText(player.position.x, player.position.y - 28, `?? +${heal}`, '#2fd159');
            playPowerUp();
          } else if (p.type === 'shield') {
            playerShield = Math.min(100, playerShield + 25);
            spawnText(player.position.x, player.position.y - 28, `??? +25`, '#ff6666');
            playPowerUp();
          } else if (p.type === 'overdrive') {
            overdriveMs = Math.max(overdriveMs, 3500);
            spawnText(player.position.x, player.position.y - 28, `? OVERDRIVE`, '#ffd166');
            playPowerUp();
          // Note: 'medkit' handled earlier with percentage-based heal
          } else if (p.type === 'ammo') {
            const add = p.value || 20;
            player.ammo = Math.min(player.maxAmmo, player.ammo + add);
            spawnText(player.position.x, player.position.y - 28, `+${add}`, '#e6e600');
          playPowerUp();
          } else if (p.type === 'coin') {
            const coinValue = p.value || 10;
            player.score += coinValue;
            spawnText(player.position.x, player.position.y - 28, `+${coinValue}`, '#ffd700');
            playCoin();
          }
          pickups.splice(i, 1);
        }
      }
      // DOT/Slow update
      eDot.update(dt);
      // AI Input Simulation - Simplified Aggressive AI
      function simulateAIInput(e: Enemy, dt: number) {
        return;
        if (!e.input) return;
        const screenWidth = canvas && typeof canvas.width === 'number' ? canvas.width : (typeof window !== 'undefined' ? window.innerWidth || 1920 : 1920);
        const screenHeight = canvas && typeof canvas.height === 'number' ? canvas.height : (typeof window !== 'undefined' ? window.innerHeight || 1080 : 1080);
        const profile = getEnemyProfile(e.aiType!);
        
        const input = e.input;
        resetCharacterInput(input);

        const dxp = player.position.x - e.position.x;
        const dyp = player.position.y - e.position.y;
        const distToPlayer = Math.hypot(dxp, dyp);
        const playerDir = Math.sign(dxp);
        const playerApproachSpeed = player.velocity.x * playerDir;
        const playerClosingFast = playerApproachSpeed < -120;
        
        // Predict player position based on velocity
        const predictionTime = 0.3; // seconds ahead
        const predictedPlayerX = player.position.x + player.velocity.x * predictionTime;
        const dxpPredicted = predictedPlayerX - e.position.x;
        
        input.mouse.x = player.position.x;
        input.mouse.y = player.position.y;

        // Simple ranges
        const meleeRange = 100;
        const shootRange = 350;
        const tooFarRange = 600;
        
        // Additional range constants for AI behavior
        const punchRange = 80;
        const kickRange = 100;
        const shootStartRange = 200;
        const shootOptimalRange = 350;
        const disengageRange = 600;

        if (!e.aiData) {
          e.aiData = {
            state: 'approach',
            stateTimer: 1000,
            actionCooldown: 0,
            movePattern: 'idle',
            moveTimer: 0,
            lastAttackTime: 0,
            comboCount: 0,
            circleDirection: 1,
            approachStyle: 'direct',
            playerVelocityHistory: [],
            reactionDelay: 0,
            decisionCooldown: 0,
            commitTimer: 0,
            jumpCooldownMs: 0,
            shootHoldMs: 0,
            burstCooldownMs: 0,
            comboStep: 0,
            lastPlayerDir: playerDir,
            stuckTimer: 0,
            engageWarmupMs: 0,
            aimTimerMs: 0,
            isAiming: false,
            lastRangedIntent: false,
            playerVisible: false,
            horizontalGap: Math.abs(player.position.x - e.position.x),
            strafeDir: 1,
          };
        }

        const horizontalDistance = Math.abs(dxp);

        const isOnScreen = e.position.x > camera.x - 120 && e.position.x < camera.x + screenWidth + 120;



        const decision = stepEnemyStateMachine({

          enemy: e,

          player: {

            position: { x: player.position.x, y: player.position.y },

            velocity: { x: player.velocity.x, y: player.velocity.y },

            facing: player.facing,

            onGround: player.onGround,

          },

          profile: {

            preferredRange: e.preferredRange ?? profile.preferredRange,

            meleeRange: e.meleeRange ?? profile.meleeRange,

            strafeDurationMs: e.strafeDurationMs ?? profile.strafeDurationMs,

            strafePauseMs: e.strafePauseMs ?? profile.strafePauseMs,

            burstSize: e.burstSize ?? profile.burstSize,

            meleeAttacks: profile.meleeAttacks,

          },

          dt,

          dx: dxp,

          dy: dyp,

          horizontalDistance,

          totalDistance: distToPlayer,

          playerVisible: isOnScreen,

          playerClosingFast,

          random: Math.random,

        });



        applyDecisionToInput(input, decision);



        const aiData = e.aiData!;

        aiData.playerVisible = isOnScreen;

        aiData.horizontalGap = horizontalDistance;

        aiData.lastRangedIntent = decision.wantsRangedIntent;
        
        // Store speed multiplier for movement calculation
        (e as any).speedMultiplier = decision.speedMultiplier;



        const mappedState = decision.state === 'combo'
          ? 'melee'
          : decision.state === 'approach'
            ? 'chase'
            : decision.state === 'retreat'
              ? 'retreat'
              : (decision.state === 'spacing' || decision.state === 'pressure' || decision.state === 'engage')
                ? 'attack'
                : 'wander';

        e.aiState = mappedState;



        e.nextMeleeMs = Math.max(0, (e.nextMeleeMs || 0) - dt * 1000);



        // Weapon switching based on state (with hysteresis to prevent rapid switching)
        if (!e.weaponSwitchCooldown) e.weaponSwitchCooldown = 0;
        e.weaponSwitchCooldown = Math.max(0, e.weaponSwitchCooldown - dt * 1000);
        
        const wantsMelee = decision.weapon === 'unarmed';
        const canSwitch = e.weaponSwitchCooldown <= 0 && !e.animHoldUntilEnd;
        
        if (wantsMelee && canSwitch) {
          if (e.animWeapon !== 'unarmed') {
            e.animWeapon = 'unarmed';
            e.weaponSwitchCooldown = 400; // Cooldown to prevent rapid switching
          }
        } else if (!wantsMelee && canSwitch) {
          if (e.animWeapon !== 'pistol') {
            e.animWeapon = 'pistol';
            e.currentWeapon = 0;
            e.weaponSwitchCooldown = 400;
          }
        }

        // Additional shooting logic - don't shoot when close (prefer melee)
        const minShootRange = profile.meleeRange * 2.0; // Increased to prevent shooting in close-medium range
        if (decision.state !== 'retreat' && distToPlayer < minShootRange) {
          input.shootHeld = false;
        }
        
        // Force melee weapon when very close
        if (distToPlayer < profile.meleeRange * 1.8 && e.animWeapon !== 'unarmed' && canSwitch) {
          if (distToPlayer < profile.meleeRange * 0.55) {
            // Too close - let them back off briefly before resuming melee stance
            e.animWeapon = 'pistol';
          } else {
            e.animWeapon = 'unarmed';
          }
          e.weaponSwitchCooldown = 300;
        }

        }
      const applyDamageToPlayer = (dmg: number, knockX: number, knockY: number, sourceX: number, sourceY: number, isMelee = false) => {
          const shieldAbsorb = Math.min(playerShield, dmg);
          playerShield -= shieldAbsorb;
          const hpDmg = dmg - shieldAbsorb;
          if (hpDmg <= 0) return;
          player.hp = Math.max(0, player.hp - hpDmg);
          player.invulnMs = 500;
          
          // Trigger hurt animation for player
          triggerHurtAnimation(player);
          
          const ang = Math.atan2(player.position.y - sourceY, player.position.x - sourceX);
          player.velocity.x += Math.cos(ang) * knockX;
          player.velocity.y += Math.sin(ang) * knockY;
          spawnHitSpark(player.position.x, player.position.y, 'pistol');
          for (let i = 0; i < 8; i++) {
            const bleedAngle = ang + (Math.random() - 0.5) * Math.PI * 0.6;
            pushParticle({
              position: { x: player.position.x, y: player.position.y - player.radius * 0.2 },
              velocity: { x: Math.cos(bleedAngle) * (160 + Math.random() * 160), y: Math.sin(bleedAngle) * (120 + Math.random() * 120) },
              lifeMs: 380 + Math.random() * 240,
              size: 1.8 + Math.random() * 1.6,
              color: '#6e0000',
              gravity: 1600,
              fade: 0.0035,
            });
          }
          player.bloodOverlay = Math.min(1.2, player.bloodOverlay + Math.min(0.8, hpDmg / player.maxHp));
          playDamage();
          playHitEffect();
          if (isMelee) {
            playMeleeImpact();
            
            // Add enhanced screen effects for melee hits
            const shakeMult = 2.2;
            const shakeBase = 35;
            cameraShake.ms = Math.max(cameraShake.ms, shakeBase * shakeMult);
            cameraShake.magnitude = Math.max(cameraShake.magnitude, shakeBase * shakeMult * 0.8);
            
            // Hit pause
            const basePause = Math.min(dmg * 0.8, 120);
            hitstopMs = Math.max(hitstopMs, basePause);
            
            // Red edge pulse instead of screen flash
            // damageEdgePulse.alpha = 0.8;
            // damageEdgePulse.maxAlpha = Math.min(0.8, hpDmg / player.maxHp + 0.3);
            zoomEffect.targetScale = 1.0 + Math.min(0.08, dmg * 0.002);
          } else {
            // Projectile hits get smaller screen shake
            cameraShake.ms = Math.max(cameraShake.ms, 200);
            cameraShake.magnitude = Math.max(cameraShake.magnitude, 14);
          }
          
          // Trigger hurt animation for player
          triggerHurtAnimation(player);
        };
      // Enemies AI & physics
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const wasGrounded = !!e.onGround;
        if (e.flashMs && e.flashMs > 0) e.flashMs = Math.max(0, e.flashMs - dt * 1000);
        if (e.invulnMs > 0) e.invulnMs = Math.max(0, e.invulnMs - dt * 1000);
        if (e.bloodOverlay > 0) e.bloodOverlay = Math.max(0, e.bloodOverlay - dt * 0.25);
        
        // Skip most updates for dying enemies (but still update animation)
        const isDying = e.hp <= 0 || e.animKey.includes('die');
        
        // Simulate AI inputs (skip if dying)
        if (!isDying) {
          simulateAIInput(e, dt);
        }
        
        // Unified character movement (same as player)
        const eInput = e.input!;
        const isRunning = eInput.run;
        const baseSpeed = isRunning ? world.moveSpeed * world.runMultiplier : world.moveSpeed;
        
        // Apply AI speed multiplier (slower when player just passed by)
        const speedMultiplier = (e as any).speedMultiplier ?? 1.0;
        const currentSpeed = baseSpeed * speedMultiplier;
        
        // Only move if not dying
        if (!isDying) {
          // Apply friction/damping to preserve knockback while allowing control
          const friction = e.onGround ? 0.85 : 0.95; // Lower friction on ground for knockback visibility
          e.velocity.x *= friction;
          
          // Add movement input (smaller influence if recently hit)
          const controlStrength = e.invulnMs > 0 ? 0.1 : 1.0; // Reduced control during hitstun
          if (eInput.left) e.velocity.x += -currentSpeed * dt * 60 * controlStrength;
          if (eInput.right) e.velocity.x += currentSpeed * dt * 60 * controlStrength;
          
          // Jump handling
          if (eInput.up && e.onGround) {
            e.velocity.y = world.jumpVelocity;
            e.onGround = false;
            e.canDoubleJump = true;
          }
          
          // Cap maximum velocity
          const maxVel = currentSpeed * 1.5;
          e.velocity.x = Math.max(-maxVel, Math.min(maxVel, e.velocity.x));
        } else {
          // Dying enemies maintain knockback momentum
          e.velocity.x *= 0.92;
        }
        
        // Face player in combat, otherwise face movement (with stability to prevent flipping)
        const dxp = player.position.x - e.position.x;
          const targetFacing = Math.sign(dxp);
        
        // Always face player when in combat or close range
        if (Math.abs(dxp) < 600 || e.aiState === "attack" || e.aiState === "melee" || e.aiState === "chase") {
          if (targetFacing !== 0) e.facing = targetFacing;
        } else {
          // Face movement direction when far away
          if (eInput.left && !eInput.right) e.facing = -1;
          else if (eInput.right && !eInput.left) e.facing = 1;
        }
        
        // Apply movement  
        e.velocity.y += world.gravity * dt;
        e.position.x += e.velocity.x * dt;
        e.position.y += e.velocity.y * dt;

        collideCircleWithTerrain(e.position, e.radius, e);
        collideCircleWithPlatformsTop(e.position, e.radius, e);
        applyPlatformFeatureEffects(e, true);
        
        // Edge-triggered attack inputs (just like player) - skip if dying
        if (!isDying) {
          updateAttackEdgeFlags(e, eInput);
        }
        
        // Animation state machine (matching player's system)
        const absVel = Math.abs(e.velocity.x);
        const isMoving = absVel > 50;
        const wantsGun = e.animWeapon === 'pistol';

        if (!isDying) {
          if (wantsGun && eInput.shootHeld && !e.shootPressed && e.shootCooldownMs <= 0 && absVel < 50) {
            e.shootPressed = true;
            if (e.aiData) {
              e.aiData.engageWarmupMs = Math.max(0, e.aiData.engageWarmupMs || 0);
            }
          }
          if (!wantsGun || !eInput.shootHeld || absVel >= 50) e.shootPressed = false;
        } else {
          e.shootPressed = false;
        }

        if (!isDying && wantsGun && eInput.shootHeld && absVel > 50) {
          shootIfPossible(e);
        }
        
        const isShootAttack = e.animKey.includes('_shoot') && !e.animKey.includes('_run') && !e.animKey.includes('_walk');
        const isAttacking = e.animKey.includes('_jab') || e.animKey.includes('_kick') || e.animKey.includes('_uppercut') || e.animKey.includes('_salto') || isShootAttack || e.animKey.includes('_slash');
        const attackLockActive = isAttacking && !(e.animKey === 'pistol_shoot' && isMoving);
        
        // Check if enemy is in a hurt or death animation that should continue playing
        const isInHurtAnimation = e.animKey.includes('hurt') && e.animHoldUntilEnd;
        const isInDeathAnimation = e.animKey.includes('die');
        
        let nextAnimKey = e.animWeapon === 'pistol' ? "pistol_idle" : "unarmed_idle";
        let shouldHoldUntilEnd = false;
        
        // If death animation is playing, always keep it
        if (isInDeathAnimation) {
          nextAnimKey = e.animKey;
          shouldHoldUntilEnd = true;
        }
        // If hurt animation is playing, let it finish
        else if (isInHurtAnimation) {
          const currentClip = globalClips.clips[e.animKey];
          if (currentClip && e.animFrame < currentClip.images.length - 0.5) {
            nextAnimKey = e.animKey;
            shouldHoldUntilEnd = true;
          }
        }
        // Priority: Attack animations
        else if (e.shootPressed && !attackLockActive && e.animWeapon === 'pistol') {
          nextAnimKey = "pistol_shoot";
          shouldHoldUntilEnd = true;
          e.shootPressed = false;
          e.shootCooldownMs = e.weapons[e.currentWeapon]?.fireRateMs || 240;
        } else if (e.jabPressed && !attackLockActive && e.onGround) {
          nextAnimKey = "unarmed_jab_single";
          shouldHoldUntilEnd = true;
          e.jabPressed = false;
          e.attackCooldown = 0.4;
        } else if (e.kickHighPressed && !attackLockActive && e.onGround) {
          nextAnimKey = "unarmed_kick_high";
          shouldHoldUntilEnd = true;
          e.kickHighPressed = false;
          e.attackCooldown = 0.5;
        } else if (e.kickLowPressed && !attackLockActive && e.onGround) {
          nextAnimKey = "unarmed_kick_low";
          shouldHoldUntilEnd = true;
          e.kickLowPressed = false;
          e.attackCooldown = 0.5;
        } else if (e.uppercutPressed && !attackLockActive && e.onGround) {
          nextAnimKey = "unarmed_uppercut";
          shouldHoldUntilEnd = true;
          e.uppercutPressed = false;
          e.attackCooldown = 0.45;
        }
        // Jump
        else if (!e.onGround) {
          nextAnimKey = e.animWeapon === 'pistol' ? "pistol_jump" : "unarmed_jump";
        }
        // Let attack animations finish
        else if (attackLockActive && e.animHoldUntilEnd) {
          const clip = globalClips.clips[e.animKey];
          if (clip && e.animFrame < clip.images.length - 0.5) {
            nextAnimKey = e.animKey;
            shouldHoldUntilEnd = true;
          }
        }
        // Movement animations
        else if (isMoving) {
          if (e.animWeapon === 'pistol') {
            if (absVel > 200 && isRunning) {
              nextAnimKey = eInput.shootHeld ? "pistol_run_shoot" : "pistol_run";
            } else {
              nextAnimKey = eInput.shootHeld ? "pistol_walk_shoot" : "pistol_walk";
            }
          } else {
            nextAnimKey = absVel > 200 && isRunning ? "unarmed_run" : "unarmed_walk";
          }
        }
        // Idle (default for all weapon types)
        else {
          if (e.animWeapon === 'pistol') {
            nextAnimKey = eInput.shootHeld ? "pistol_idle_active" : "pistol_idle";
          } else if (e.animWeapon === 'sword') {
            nextAnimKey = "sword_idle";
          } else {
            nextAnimKey = "unarmed_idle";
          }
        }
        
        // Smooth animation transitions - don't reset if transitioning between similar states
        const isSimilarTransition = (oldKey: string, newKey: string): boolean => {
          // Allow smooth transitions between walk/run/idle of same weapon
          const oldParts = oldKey.split('_');
          const newParts = newKey.split('_');
          if (oldParts[0] === newParts[0]) { // Same weapon type
            const oldMotion = oldParts.slice(1).join('_');
            const newMotion = newParts.slice(1).join('_');
            // Smooth transition between idle/walk/run
            const motionStates = ['idle', 'idle_active', 'walk', 'run', 'walk_shoot', 'run_shoot'];
            if (motionStates.some(s => oldMotion.includes(s)) && motionStates.some(s => newMotion.includes(s))) {
              return true;
            }
          }
          return false;
        };
        
        if (nextAnimKey !== e.animKey) {
          const wasSimilar = isSimilarTransition(e.animKey, nextAnimKey);
          e.animKey = nextAnimKey;
          // Don't reset frame for similar transitions (smoother blending)
          if (!wasSimilar) {
          e.animFrame = 0;
          }
          e.animHoldUntilEnd = shouldHoldUntilEnd;
        }
        
        // Advance animation
        const clip = globalClips.clips[e.animKey];
        if (clip && clip.images.length > 0) {
          e.animFrame += clip.fps * dt;
          if (clip.loop) {
            while (e.animFrame >= clip.images.length) e.animFrame -= clip.images.length;
          } else {
            if (e.animFrame >= clip.images.length) {
              e.animFrame = clip.images.length - 0.01;
              // Release hold when non-looping animation completes
              if (e.animHoldUntilEnd) {
                e.animHoldUntilEnd = false;
              }
            }
          }
        }
        
        // Trigger bullets on frame 1 for pistol_shoot (just like player)
        const prevFrame = Math.floor(e.animFrame - (clip?.fps || 14) * dt);
        const currFrame = Math.floor(e.animFrame);
        if (e.animKey === 'pistol_shoot' && prevFrame < 1 && currFrame >= 1) {
          const weapon = e.weapons[e.currentWeapon];
          if (weapon && e.ammo >= 1) {
            e.ammo = Math.max(0, e.ammo - 1);
            spawnBullets(e);
            playShoot(weapon.type);
          }
        }
        
        const enemyMelee = MELEE_ATTACK_DATA[e.animKey];
        if (enemyMelee) {
          const enemyAudioFrames = enemyMelee.audioTriggerFrames && enemyMelee.audioTriggerFrames.length > 0
            ? enemyMelee.audioTriggerFrames
            : [enemyMelee.audioTriggerFrame ?? 1];
          const enemyAudioTriggered = enemyAudioFrames.some(frame => prevFrame < frame && currFrame >= frame);
          if (enemyAudioTriggered) {
            playMeleeSwingSound(enemyMelee.soundType);
          }
        }
        
        // Update cooldowns
        if (e.shootCooldownMs > 0) e.shootCooldownMs = Math.max(0, e.shootCooldownMs - dt * 1000);
        if (e.attackCooldown > 0) e.attackCooldown -= dt;
        
        // Landing/running dust (same as player)
        const landed = !wasGrounded && e.onGround;
        if (landed) {
          for (let d = 0; d < 6; d++) {
            const a = (Math.random() - 0.5) * Math.PI;
            const sp = 120 + Math.random() * 120;
            pushParticle({
              position: { x: e.position.x, y: e.position.y + e.radius },
              velocity: { x: Math.cos(a) * sp, y: Math.sin(a) * sp * 0.4 },
              lifeMs: 250 + Math.random() * 150,
              size: 2 + Math.random() * 1.5,
              color: 'rgba(200,220,230,0.6)',
              gravity: 1000,
              fade: 0.006
            });
          }
        } else if (e.onGround && absVel > 260 && Math.random() < 0.2) {
          pushParticle({
            position: { x: e.position.x - Math.sign(e.velocity.x) * e.radius, y: e.position.y + e.radius - 2 },
            velocity: { x: (Math.random() - 0.5) * 60, y: -60 - Math.random() * 60 },
            lifeMs: 180,
            size: 1.5,
            color: 'rgba(180,200,210,0.5)',
            gravity: 1200,
            fade: 0.01
          });
        }
        
        // Melee hit detection (on hit frames of animations)
        const meleeHitFrames: Record<string, number> = {
          'unarmed_jab_single': 2,
          'unarmed_kick_high': 5,
          'unarmed_kick_low': 5,
          'unarmed_reverse_kick': 6,
          'unarmed_uppercut': 4,
          'unarmed_salto_kick': 8,
          'unarmed_jab_high_double': 4,
        };
        const hitFrame = meleeHitFrames[e.animKey];
        if (hitFrame !== undefined && prevFrame < hitFrame && currFrame >= hitFrame) {
          const hitX = e.position.x + e.facing * 38;
          const hitY = e.position.y - 8;
          const meleeRange = 52;
          const meleeDamage = 28;
          const meleeKnockback = 420;
          
          const dx = player.position.x - hitX;
          const dy = player.position.y - hitY;
          const dist = Math.hypot(dx, dy);
          
          if (dist <= meleeRange + player.radius && player.invulnMs <= 0) {
            applyDamageToPlayer(meleeDamage, meleeKnockback, 180, hitX, hitY, true);
            // Extra blood on melee hits
            for (let splat = 0; splat < 8; splat++) {
              const bleedAngle = Math.atan2(dy, dx) + (Math.random() - 0.5) * Math.PI * 0.5;
              pushParticle({
                position: { x: player.position.x, y: player.position.y - player.radius * 0.3 },
                velocity: { x: Math.cos(bleedAngle) * (240 + Math.random() * 200), y: Math.sin(bleedAngle) * (200 + Math.random() * 180) },
                lifeMs: 450 + Math.random() * 280,
                size: 2 + Math.random() * 2,
                color: '#7a0000',
                gravity: 1850,
                fade: 0.003,
              });
            }
            cameraShake.ms = Math.max(cameraShake.ms, 200);
            cameraShake.magnitude = Math.max(cameraShake.magnitude, 14);
          }
        }
        
        // Character-to-character separation (prevent enemies from overlapping player/other enemies)
        // Only apply when actually overlapping, not as a constant force
        if (!isDying && e.onGround) {
          // Check if player is moving fast (running past)
          const playerMovingFast = Math.abs(player.velocity.x) > 200;
          const playerRunningPast = playerMovingFast && Math.sign(player.velocity.x) === Math.sign(dxp);
          
          // Separate from player - only when significantly overlapping
          const dxPlayer = e.position.x - player.position.x;
          const dyPlayer = e.position.y - player.position.y;
          const distToPlayer = Math.hypot(dxPlayer, dyPlayer);
          const actualOverlap = (e.radius + player.radius) - distToPlayer;
          
          // Only apply separation if there's actual overlap (characters are intersecting)
          if (actualOverlap > 0 && distToPlayer > 0) {
            // Weaker separation if player is running past
            const separationStrength = playerRunningPast ? 0.15 : 0.3;
            const pushX = (dxPlayer / distToPlayer) * actualOverlap * separationStrength;
            e.position.x += pushX;
          }
          
          // Separate from other enemies (to prevent stacking)
          for (let j = 0; j < enemies.length; j++) {
            if (j === i) continue;
            const other = enemies[j];
            if (other.hp <= 0) continue; // Skip dead enemies
            
            const dxOther = e.position.x - other.position.x;
            const dyOther = e.position.y - other.position.y;
            const distToOther = Math.hypot(dxOther, dyOther);
            const enemyOverlap = (e.radius + other.radius + 5) - distToOther;
            
            // Only push apart if actually overlapping
            if (enemyOverlap > 0 && distToOther > 0) {
              const pushStrength = 0.25;
              const pushX = (dxOther / distToOther) * enemyOverlap * pushStrength;
              e.position.x += pushX;
            }
          }
        }

        // Enemy bullets hitting player
        for (let k = bullets.length - 1; k >= 0; k--) {
          const b = bullets[k];
          if (b.from !== "enemy") continue;
          const dbx = b.position.x - player.position.x;
          const dby = b.position.y - player.position.y;
          if (Math.hypot(dbx, dby) <= player.radius + b.radius) {
            if (player.invulnMs <= 0) {
              applyDamageToPlayer(b.damage, 260, 140, b.position.x, b.position.y);
              const impactAngle = Math.atan2(dby, dbx);
              for (let splat = 0; splat < 6; splat++) {
                const variation = (Math.random() - 0.5) * Math.PI * 0.4;
                pushParticle({
                  position: { x: player.position.x + Math.cos(impactAngle) * player.radius * 0.5, y: player.position.y + Math.sin(impactAngle) * player.radius * 0.2 },
                  velocity: { x: Math.cos(impactAngle + variation) * (200 + Math.random() * 180), y: Math.sin(impactAngle + variation) * (200 + Math.random() * 180) },
                  lifeMs: 340 + Math.random() * 220,
                  size: 1.5 + Math.random() * 1.5,
                  color: '#5a0000',
                  gravity: 1700,
                  fade: 0.003,
                });
              }
            }
            bullets.splice(k, 1);
          }
        }
        // Die
        if (e.hp <= 0) {
          // Trigger death animation
          triggerDeathAnimation(e);
          e.hp = 0; // Ensure HP is exactly 0
          
          // Check if death animation is complete
          const dieClip = globalClips.clips[e.animKey];
          const isDeathComplete = e.animKey.includes('die') && dieClip && e.animFrame >= dieClip.images.length - 0.5;
          
          if (isDeathComplete) {
            // Only remove enemy after death animation completes
            explode(e.position.x, e.position.y, 90, 600, 0);
            // OPTIMIZATION: Remove enemy from spatial hash before removing from array
            enemyGrid.removeEntity(e);
            enemies.splice(i, 1);
            player.kills += 1;
            
            // Wave progression: every 10 kills for faster difficulty scaling
            if (player.kills % 10 === 0) {
              wave += 1;
              spawnText(player.position.x, player.position.y - 100, `LEVEL ${wave}`, '#ff0000', 32);
              // Reduce progression distance slightly as player advances (more frequent encounters)
              progressionDistance = Math.max(500, 800 - wave * 15);
            }
            
            const value = e.aiType === "boss" ? 1000 : e.aiType === "brute" ? 200 : e.aiType === "duelist" ? 180 : 120;
            const multiplier = 1 + Math.min(4, Math.floor(combo / 5)) * 0.25;
            player.score += Math.floor(value * multiplier);
            combo += 1;
            comboTimerMs = 2500;
            spawnText(e.position.x, e.position.y - e.radius - 20, `+${Math.floor(value * multiplier)}`, '#2fd159');
            if (combo % 5 === 0) spawnText(e.position.x, e.position.y - e.radius - 36, `COMBO x${1 + Math.min(4, Math.floor(combo / 5))}`, '#ffd166');
            if (Math.random() < (e.aiType === "boss" ? 0.9 : 0.2)) {
              playerShield = Math.min(100, playerShield + (e.aiType === "boss" ? 60 : 20));
            }
            // Coin drops (always drop 1-3 coins)
            const coinCount = Math.floor(Math.random() * 3) + 1;
            for (let c = 0; c < coinCount; c++) {
              const offsetX = (Math.random() - 0.5) * 30;
              const offsetY = Math.random() * -15;
              const coinValue = e.aiType === 'boss' ? 50 : e.aiType === 'brute' ? 20 : 10;
              pickups.push({ type: 'coin', x: e.position.x + offsetX, y: e.position.y - e.radius + offsetY, value: coinValue });
            }
            
            // Medkit drop chance
            if (Math.random() < 0.12) {
              pickups.push({ type: 'medkit', x: e.position.x, y: e.position.y - e.radius });
            }
            // Shield / Overdrive drop chance
            if (Math.random() < 0.10) pickups.push({ type: 'shield', x: e.position.x + 12, y: e.position.y - e.radius - 6 });
            if (Math.random() < 0.08) pickups.push({ type: 'overdrive', x: e.position.x - 12, y: e.position.y - e.radius - 6 });
            if (Math.random() < 0.10) pickups.push({ type: 'medkit', x: e.position.x, y: e.position.y - e.radius - 10 });
            if (Math.random() < 0.12) pickups.push({ type: 'ammo', x: e.position.x, y: e.position.y - e.radius - 12, value: 24 });
            if (combo % 10 === 0) { overdriveMs = 4000; playPowerUp(); }
          }
        }
      }

      // ===== Multiplayer: Advance Remote Player Animations =====
      // Replicate animation logic locally for remote players using their input state
      // This ensures frame-perfect synchronization with local logic
      if (multiplayerStateRef.current.isMultiplayerGame) {
        const currentRemotePlayers = remotePlayersRef.current;
        
        currentRemotePlayers.forEach((remotePlayer) => {
          const clip = globalClips.clips[remotePlayer.animKey];
          if (!clip || clip.images.length === 0) return;
          
          // Store previous frame for frame-crossing detection
          const prevFrame = Math.floor(remotePlayer.animFrame);
          
          // Calculate fps (same logic as local player)
          let effectiveFps = clip.fps;
          if (remotePlayer.animKey === 'pistol_shoot') {
            // Match weapon fire rate (assuming pistol)
            effectiveFps = 5 / 0.277; // ~18 fps for pistol
          }
          
          // Advance frame
          remotePlayer.animFrame += effectiveFps * dt;
          let currFrame = Math.floor(remotePlayer.animFrame);
          
          // Detect large frame jumps (network lag protection)
          // If frame jumped more than 1 integer frame, we might have skipped audio triggers
          const frameJump = currFrame - prevFrame;
          const skippedFrames = frameJump > 1; // Jumped 2+ frames (e.g., 2→4 or 2→5)
          
          if (skippedFrames) {
            // Network lag caused frame skip - manually trigger missed audio frames
            const meleeAudioData = MELEE_ATTACK_DATA[remotePlayer.animKey];
            if (meleeAudioData) {
              const audioTriggerFrames = meleeAudioData.audioTriggerFrames && meleeAudioData.audioTriggerFrames.length > 0
                ? meleeAudioData.audioTriggerFrames
                : [meleeAudioData.audioTriggerFrame ?? 1];
              
              // Check if we skipped over any audio trigger frames
              for (const triggerFrame of audioTriggerFrames) {
                if (prevFrame < triggerFrame && currFrame >= triggerFrame) {
                  // Would have missed this trigger, so fire it now
                  playMeleeSwingSound(meleeAudioData.soundType);
                  
                  // Visual effects for kicks
                  const kickAnimations = [
                    'unarmed_kick_high',
                    'unarmed_kick_low',
                    'unarmed_reverse_kick',
                    'unarmed_salto_kick'
                  ];
                  const isKick = kickAnimations.includes(remotePlayer.animKey);
                  
                  if (isKick) {
                    const facing = remotePlayer.facingRight ? 1 : -1;
                    const hitX = remotePlayer.position.x + facing * 40;
                    const hitY = remotePlayer.position.y;
                    shockwaves.push({ x: hitX, y: hitY, r: 12, lifeMs: 220, thickness: 3, color: '#ffffff' });
                  }
                  break; // Only trigger once even if multiple frames were skipped
                }
              }
            }
          }
          
          // Store for hit detection
          (remotePlayer as any).prevAnimFrame = prevFrame;
          (remotePlayer as any).currAnimFrame = currFrame;
          
          // ===== Audio Triggers for Remote Players =====
          // Play swing sounds when remote players cross audio trigger frames
          const meleeAudioData = MELEE_ATTACK_DATA[remotePlayer.animKey];
          if (meleeAudioData) {
            const audioTriggerFrames = meleeAudioData.audioTriggerFrames && meleeAudioData.audioTriggerFrames.length > 0
              ? meleeAudioData.audioTriggerFrames
              : [meleeAudioData.audioTriggerFrame ?? 1];
            
            const audioTriggeredThisStep = audioTriggerFrames.some(frame => prevFrame < frame && currFrame >= frame);
            
            if (audioTriggeredThisStep) {
              // Play swing sound for remote player attack
              playMeleeSwingSound(meleeAudioData.soundType);
              
              // Visual effects for kicks
              const kickAnimations = [
                'unarmed_kick_high',
                'unarmed_kick_low',
                'unarmed_reverse_kick',
                'unarmed_salto_kick'
              ];
              const isKick = kickAnimations.includes(remotePlayer.animKey);
              
              if (isKick) {
                // Shockwave at remote player's hit location
                const facing = remotePlayer.facingRight ? 1 : -1;
                const hitX = remotePlayer.position.x + facing * 40;
                const hitY = remotePlayer.position.y;
                shockwaves.push({ x: hitX, y: hitY, r: 12, lifeMs: 220, thickness: 3, color: '#ffffff' });
              }
            }
          }
          
          // Handle looping/completion (same logic as local player)
          if (clip.loop) {
            const totalFrames = clip.images.length;
            while (remotePlayer.animFrame >= totalFrames) {
              remotePlayer.animFrame -= totalFrames;
            }
          } else {
            const wasComplete = remotePlayer.animFrame >= clip.images.length;
            remotePlayer.animFrame = Math.min(remotePlayer.animFrame, clip.images.length - 0.01);
          }
        });
      }

      // ===== Multiplayer: PvP Hit Detection =====
      // Frame-perfect hitbox collision for attacks
      // NOTE: Gun attacks use bullet collision, not melee hitboxes
      if (multiplayerStateRef.current.isMultiplayerGame) {
        
        // ===== LOCAL PLAYER ATTACKS REMOTE PLAYERS =====
        const isAttacking = player.animKey.includes('_jab') ||
                           player.animKey.includes('_kick') ||
                           player.animKey.includes('_uppercut') ||
                           player.animKey.includes('_salto') ||
                           player.animKey.includes('_slash') ||
                           player.animKey.includes('_block');
        
        if (isAttacking) {
          // Get attack data or use intelligent fallback
          const attackData = MELEE_ATTACK_DATA[player.animKey];
          
          const currentRemotePlayers = remotePlayersRef.current;
          
          currentRemotePlayers.forEach((remotePlayer) => {
            // Initialize hit tracking set for multi-hit attacks
            if (!(remotePlayer as any).hitKeys) {
              (remotePlayer as any).hitKeys = new Set<string>();
            }
            
            // Clear hit tracking when animation changes OR when animation restarts/loops
            const prevFrame = (player as any).prevAnimFrame || 0;
            const currFrame = (player as any).currAnimFrame || 0;
            const animationRestarted = currFrame < prevFrame; // Frame decreased = animation looped
            
            if ((remotePlayer as any).lastAttackAnim !== player.animKey || animationRestarted) {
              (remotePlayer as any).hitKeys.clear();
              (remotePlayer as any).lastAttackAnim = player.animKey;
            }
            
            // ===== Hitbox Generation: Use defined data or create intelligent fallback =====
            let hitboxes: CollisionUtils.AttackHitbox[] = [];
            
            if (attackData?.hitboxes) {
              // Use explicitly defined hitboxes
              hitboxes = attackData.hitboxes;
            } else {
              // Create intelligent fallback hitbox based on attack type
              const isKick = player.animKey.includes('_kick');
              const isPunch = player.animKey.includes('_jab') || player.animKey.includes('_punch');
              const isSlash = player.animKey.includes('_slash') || player.animKey.includes('sword_');
              const isSalto = player.animKey.includes('_salto');
              const isUppercut = player.animKey.includes('_uppercut');
              const isBlock = player.animKey.includes('_block');
              
              // Skip blocks - they don't deal damage
              if (isBlock) {
                hitboxes = [];
              } else {
              
              // Determine damage, knockback, and visual effects
              let damage = 15;
              let knockback = 200;
              let cameraShake = 40;
              let hitStun = 30;
              let effectColor = '#6dd6ff';
              let effectIntensity = 1.5;
              let range = 85;
              
              if (isKick) {
                damage = 22;
                knockback = 280;
                cameraShake = 45;
                hitStun = 35;
                range = 100;
                effectColor = '#9f7aff';
                effectIntensity = 1.8;
              } else if (isUppercut) {
                damage = 28;
                knockback = 400;
                cameraShake = 70;
                hitStun = 50;
                range = 75;
                effectColor = '#ffb366';
                effectIntensity = 2.5;
              } else if (isSalto) {
                damage = 35;
                knockback = 550;
                cameraShake = 90;
                hitStun = 70;
                range = 110;
                effectColor = '#ff66aa';
                effectIntensity = 3.0;
              } else if (isSlash) {
                damage = 30;
                knockback = 350;
                cameraShake = 65;
                hitStun = 45;
                range = 95;
                effectColor = '#b9a9ff';
                effectIntensity = 2.2;
              } else if (isPunch) {
                damage = 18;
                knockback = 200;
                cameraShake = 42;
                hitStun = 30;
                range = 80;
                effectColor = '#6dd6ff';
                effectIntensity = 1.6;
              }
              
              // Create generic hitbox (melee only)
              hitboxes = [{
                shape: isKick || isSalto ? 'arc' : 'rectangle',
                offsetX: range * 0.4,
                offsetY: isUppercut ? -30 : (isKick ? 0 : -12),
                width: range * 0.9,
                height: isKick ? 50 : 42,
                radius: 50,
                arcRadius: isKick || isSalto ? range : undefined,
                arcStartAngle: isKick || isSalto ? -Math.PI / 3 : undefined,
                arcEndAngle: isKick || isSalto ? Math.PI / 3 : undefined,
                damage,
                knockback,
                activeFrameStart: Math.floor(player.animFrame) - 0.5,
                activeFrameEnd: Math.floor(player.animFrame) + 1.5,
                hitStun,
                cameraShake,
                invulnFrames: 80,
                effectColor,
                effectIntensity
              }];
              }
            }
            
            // Test each hitbox (defined or generated)
            for (let hitboxIndex = 0; hitboxIndex < hitboxes.length; hitboxIndex++) {
              const hitbox = hitboxes[hitboxIndex];
              
              // Use frame-crossing logic (same as audio triggers) to detect when hitbox becomes active
              // This ensures each hitbox triggers exactly once when animation crosses its activeFrameStart
              const prevFrame = (player as any).prevAnimFrame || 0;
              const currFrame = (player as any).currAnimFrame || 0;
              const frameCrossed = prevFrame < hitbox.activeFrameStart && currFrame >= hitbox.activeFrameStart;
              
              if (!frameCrossed) continue;
              
              // Prevent double-hits: unique key per hitbox per animation cycle
              // Each hitbox can only hit once per full animation (allows multi-hit combos like double punch)
              const attackKey = `${player.animKey}_${hitboxIndex}`;
              const hitKeysSet = (remotePlayer as any).hitKeys as Set<string>;
              if (hitKeysSet.has(attackKey)) continue;
              
              // Precise shape-based collision detection (rectangle/circle/arc)
              const hit = CollisionUtils.checkHitboxCollision(
                remotePlayer.position.x,
                remotePlayer.position.y,
                player.radius,
                player.position.x,
                player.position.y,
                player.facing,
                hitbox,
                collisionSettingsRef.current,
                settingsRef.current.debug as CollisionUtils.DebugSettings
              );
              
              if (!hit) continue;
              
              // ===== Hit Confirmed - Process Damage and Effects =====
              
              const dx = remotePlayer.position.x - player.position.x;
              const dy = remotePlayer.position.y - player.position.y;
              
              // Dynamic knockback based on attack type (180 for punches, 600+ for heavy attacks)
              const knockbackX = player.facing * hitbox.knockback;
              const knockbackY = hitbox.knockbackAngle 
                ? Math.sin(hitbox.knockbackAngle) * hitbox.knockback 
                : -180;
              
              // Transmit hit event to victim with full effect parameters
                const channel = multiplayerStateRef.current.roomChannel;
              if (!channel) break;
              
                  safeChannelPublish(channel, 'playerHit', {
                    victimId: remotePlayer.id,
                    attackerId: localPlayerId.current,
                damage: hitbox.damage,
                    attackType: player.animKey,
                knockbackX,
                knockbackY,
                hitPosition: { x: remotePlayer.position.x, y: remotePlayer.position.y },
                cameraShake: hitbox.cameraShake,
                hitStun: hitbox.hitStun,
                effectColor: hitbox.effectColor,
                effectIntensity: hitbox.effectIntensity,
                    timestamp: Date.now()
                  });
                  
              // ===== Attacker-Side Local Feedback =====
              // Immediate visual feedback when hit lands (frames 3 and 8 for double punch)
              
              // Update remote player's health bar immediately
              setRemotePlayers(prev => {
                const updated = new Map(prev);
                const victim = updated.get(remotePlayer.id);
                if (victim) {
                  victim.health = Math.max(0, victim.health - hitbox.damage);
                  updated.set(remotePlayer.id, victim);
                }
                return updated;
              });
              
              // Show damage number at hit location
              spawnText(
                remotePlayer.position.x, 
                remotePlayer.position.y - player.radius - 20, 
                `-${hitbox.damage}`, 
                hitbox.effectColor
              );
              
              // Award score for landing the hit
              player.score += Math.floor(hitbox.damage * 0.5);
              
              // Play hit sounds for attacker feedback
              playHitEffect();
              playMeleeImpact();
              
              // Camera shake for hit confirmation
              cameraShake.ms = Math.max(cameraShake.ms, 80);
              cameraShake.magnitude = Math.max(cameraShake.magnitude, 6);
              
              // Sword slash trail (attacker-only effect)
              if (proton && player.animKey.includes('slash')) {
                ParticleEffects.createArcaneSlashTrail(
                  proton,
                  player.position.x + player.facing * 30,
                  player.position.y - 20,
                  player.facing > 0 ? 0 : Math.PI,
                  80
                );
              }
              
              // Mark this remote player as hit for this specific hitbox
              hitKeysSet.add(attackKey);
              
              // Continue checking other hitboxes (allows multi-hit attacks)
              // Each hitbox can only hit once, but multiple hitboxes can hit in sequence
              // (e.g., double punch: first punch at frames 3-4.5, second at frames 8-9.5)
            }
          });
        }
        
        // ===== REMOTE PLAYERS ATTACK LOCAL PLAYER =====
        // Check if any remote player is hitting the local player
        const currentRemotePlayers = remotePlayersRef.current;
        
        currentRemotePlayers.forEach((remotePlayer) => {
          // Check if remote player is attacking
          const isRemoteAttacking = remotePlayer.animKey.includes('_jab') ||
                                    remotePlayer.animKey.includes('_kick') ||
                                    remotePlayer.animKey.includes('_uppercut') ||
                                    remotePlayer.animKey.includes('_salto') ||
                                    remotePlayer.animKey.includes('_slash');
          
          if (!isRemoteAttacking) return;
          if (player.invulnMs > 0) return; // Local player is invulnerable
          
          // Get attack data for remote player's animation
          const attackData = MELEE_ATTACK_DATA[remotePlayer.animKey];
          if (!attackData) return;
          
          // Initialize hit tracking for this remote player
          if (!(remotePlayer as any).localPlayerHitKeys) {
            (remotePlayer as any).localPlayerHitKeys = new Set<string>();
          }
          
          // Clear hit tracking when animation changes OR restarts
          const prevFrame = (remotePlayer as any).prevAnimFrame || 0;
          const currFrame = (remotePlayer as any).currAnimFrame || 0;
          const animationRestarted = currFrame < prevFrame;
          
          if ((remotePlayer as any).lastLocalHitAnim !== remotePlayer.animKey || animationRestarted) {
            (remotePlayer as any).localPlayerHitKeys.clear();
            (remotePlayer as any).lastLocalHitAnim = remotePlayer.animKey;
          }
          
          // Check each hitbox
          const hitboxes = attackData.hitboxes || [];
          for (let hitboxIndex = 0; hitboxIndex < hitboxes.length; hitboxIndex++) {
            const hitbox = hitboxes[hitboxIndex];
            
            // Use frame-crossing logic (same as audio triggers)
            const frameCrossed = prevFrame < hitbox.activeFrameStart && currFrame >= hitbox.activeFrameStart;
            if (!frameCrossed) continue;
            
            // Prevent double-hits
            const attackKey = `${remotePlayer.animKey}_${hitboxIndex}`;
            const hitKeysSet = (remotePlayer as any).localPlayerHitKeys as Set<string>;
            if (hitKeysSet.has(attackKey)) continue;
            
            // Check collision with local player
            const facing = remotePlayer.facingRight ? 1 : -1;
            const hit = CollisionUtils.checkHitboxCollision(
              player.position.x,
              player.position.y,
              player.radius,
              remotePlayer.position.x,
              remotePlayer.position.y,
              facing,
              hitbox,
              collisionSettingsRef.current,
              settingsRef.current.debug as CollisionUtils.DebugSettings
            );
            
            if (hit) {
              // Calculate knockback
              const knockbackX = facing * hitbox.knockback;
              const knockbackY = hitbox.knockbackAngle 
                ? Math.sin(hitbox.knockbackAngle) * hitbox.knockback 
                : -180;
              
              // Apply damage locally with full effects
              applyPvPDamage(hitbox.damage, knockbackX, knockbackY, {
                cameraShake: hitbox.cameraShake,
                hitStun: hitbox.hitStun,
                effectColor: hitbox.effectColor,
                effectIntensity: hitbox.effectIntensity
              });
              
              // Play hit sound
              playHitEffect();
              playMeleeImpact();
              
              // Mark as hit
              hitKeysSet.add(attackKey);
              
              // Break after first hit
              break;
            }
          }
        });
      }

      // Player death -> lives system
      if (player.hp <= 0) {
        // Trigger death animation
        triggerDeathAnimation(player);
        player.hp = 0; // Ensure HP is exactly 0
        
        // Check if death animation is complete
        const dieClip = globalClips.clips[player.animKey];
        const isDeathComplete = player.animKey.includes('die') && dieClip && player.animFrame >= dieClip.images.length - 0.5;
        
        if (isDeathComplete && lives > 0) {
          lives -= 1;
          player.hp = player.maxHp;
          player.invulnMs = 1200;
          player.position.y = groundYAt(player.position.x) - player.radius - 2;
          cameraShake.ms = 0;
          // stickman.reset removed - will be added with finalized stickman module
        } else {
          runningRef.current = false;
          setIsPaused(true);
        }
      }

      // Stickman update removed - will be added with finalized stickman module

      // Afterimage trail when in overdrive
      afterimageTimerMs += dt * 1000;
      if (overdriveMs > 0 && afterimageTimerMs > 60) {
        afterimageTimerMs = 0;
        afterimages.push({ x: player.position.x, y: player.position.y, age: 0, max: 280 });
        if (afterimages.length > MAX_AFTERIMAGES) afterimages.splice(0, afterimages.length - MAX_AFTERIMAGES);
      }
      // Update casings
      for (let i = casings.length - 1; i >= 0; i--) {
        const c = casings[i];
        c.life -= dt * 1000;
        c.vy += 1800 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.rot += c.vr * dt;
        const gy = groundYAt(c.x);
        if (c.y >= gy - 2) {
          c.y = gy - 2; c.vy *= -0.2; c.vx *= 0.6; c.vr *= 0.4;
          if (Math.abs(c.vy) < 30) { c.vy = 0; }
        }
        if (c.life <= 0) casings.splice(i, 1);
      }

      // Dynamic lights decay
      for (let i = dynamicLights.length - 1; i >= 0; i--) {
        const L = dynamicLights[i];
        L.a = Math.max(0, L.a - L.decay);
        L.r = Math.max(0, L.r - 2);
        if (L.a <= 0 || L.r <= 5) dynamicLights.splice(i, 1);
      }

      // Afterimages aging
      for (let i = afterimages.length - 1; i >= 0; i--) {
        const a = afterimages[i];
        a.age += dt * 1000;
        if (a.age >= a.max) afterimages.splice(i, 1);
      }

      // Expose UI snapshot for React overlay
      try {
        (canvas as any)._ui = {
          hp: player.hp,
          maxHp: player.maxHp,
          shield: playerShield,
          overdriveMs,
          combo,
          comboTimerMs,
          weapon: player.weapons[player.currentWeapon]?.type || 'pistol',
          kills: player.kills,
          wave,
          waveInProgress,
          waveTimerMs,
          score: player.score,
          highScore,
          playerName: player.name || 'YOU',
          lives,
          ammo: player.ammo,
          maxAmmo: player.maxAmmo,
        };
      } catch {}
    };
    
    // ======= Vector Model Helpers =======
    const drawCapsule = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, stroke: string, lw = 2) => {
      const r = Math.min(w, h) / 2;
      c.save();
      c.translate(x, y);
      c.beginPath();
      c.moveTo(-w / 2 + r, -h / 2);
      c.lineTo(w / 2 - r, -h / 2);
      c.arc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0);
      c.lineTo(w / 2, h / 2 - r);
      c.arc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2);
      c.lineTo(-w / 2 + r, h / 2);
      c.arc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI);
      c.lineTo(-w / 2, -h / 2 + r);
      c.arc(-w / 2 + r, -h / 2 + r, r, Math.PI, -Math.PI / 2);
      c.closePath();
      c.fillStyle = fill;
      c.fill();
      c.lineWidth = lw;
      c.strokeStyle = stroke;
      c.stroke();
      c.restore();
    }

    const drawLimb = (c: CanvasRenderingContext2D, x: number, y: number, len: number, thickness: number, angle: number, color = "#122") => {
      c.save();
      c.translate(x, y);
      c.rotate(angle);
      c.strokeStyle = color;
      c.lineCap = 'round';
      c.lineWidth = thickness;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(len, 0);
      c.stroke();
      c.restore();
    }
    const drawGun = (c: CanvasRenderingContext2D, x: number, y: number, angle: number, baseColor = "#0ef") => {
      c.save();
      c.translate(x, y);
      c.rotate(angle);
      c.fillStyle = "#2b0a0a";
      c.strokeStyle = baseColor;
      c.lineWidth = 2;
      c.beginPath();
      c.rect(0, -4, 20, 8);
      c.rect(18, -3, 10, 6);
      c.fill();
      c.stroke();
      c.globalAlpha = 0.6;
      c.fillStyle = baseColor;
      c.fillRect(2, -2, 14, 4);
      c.globalAlpha = 1;
      c.restore();
    }

    const drawShadow = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => {
      c.save();
      c.globalAlpha = 0.2;
      c.fillStyle = '#000';
      c.beginPath();
      c.ellipse(x, y + 8, r * 1.2, r * 0.4, 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      c.restore();
    }

    const drawPickups = () => {
      ctx.save();
      
      // ===== PERFORMANCE: Viewport Culling - inline check to avoid filter() array creation =====
      const vLeft = camera.x - 100;
      const vRight = camera.x + canvas.clientWidth + 100;
      const vTop = camera.y - 100;
      const vBottom = camera.y + canvas.clientHeight + 100;
      
      for (const p of pickups) {
        // Inline viewport check
        if (p.x < vLeft - 22 || p.x > vRight + 22 ||
            p.y < vTop - 22 || p.y > vBottom + 22) {
          continue;
        }
        const emoji = p.type === 'medkit' ? '💊' : p.type === 'shield' ? '🛡️' : p.type === 'overdrive' ? '⚡' : p.type === 'coin' ? '🪙' : '⛽';
      drawEmojiSprite(emoji, p.x, p.y, 22, HUD_MONO_THEME.foreground);
      }
      ctx.restore();
    }
    const collideCircleWithTerrain = (pos: Vector, radius: number, carrier: { onGround: boolean; velocity: Vector }) => {
      // Rooftop-sunset map has no terrain - only platforms
      const currentMap = currentMapRef.current;
      if (currentMap.id === 'rooftop-sunset') {
        carrier.onGround = false;
        return;
      }
      
      const samples: number = 3;
      let maxGround = -Infinity;
      for (let i = 0; i < samples; i++) {
        const t = samples === 1 ? 0.5 : i / (samples - 1);
        const xSample = pos.x + (t - 0.5) * radius * 1.5;
        const gy = groundYAt(xSample);
        if (gy > maxGround) maxGround = gy;
      }
      const feetY = pos.y + radius;
      const penetration = feetY - maxGround;
      if (penetration > 0) {
        pos.y -= penetration;
        carrier.velocity.y = Math.min(0, carrier.velocity.y);
        carrier.onGround = true;
      } else {
        carrier.onGround = false;
      }
    }

    const collideCircleWithPlatformsTop = (pos: Vector, radius: number, carrier: { onGround: boolean; velocity: Vector }) => {
      // Prefer the highest valid platform directly under feet to avoid snapping into lower ones first
      let bestTop = -Infinity;
      const isRooftopMap = currentMapRef.current.id === 'rooftop-sunset';
      
      // ===== PERFORMANCE: Use spatial hash grid instead of checking ALL platforms =====
      // This is called for player + EVERY enemy EVERY frame!
      // Old: 21 characters × 100 platforms = 2,100 checks per frame
      // New: 21 characters × ~5-10 nearby platforms = ~100-210 checks (10-20x faster!)
      const nearbyPlatforms = platformGrid.query(pos.x, pos.y, radius + 200);
      
      // Check nearby platforms only
      for (const p of nearbyPlatforms) {
        if (p.active === false) continue;
        if (isRooftopMap && p.isRooftopFeature) continue;
        
        const isWithinX = pos.x + radius > p.x && pos.x - radius < p.x + p.width;
        if (!isWithinX) continue;
        
        const top = p.y;
        const collisionDepth = p.isRooftop ? (p.height || 44) : Math.min(p.height || 40, 40);
        const feet = pos.y + radius;
        
        if (feet > top && feet < top + collisionDepth && carrier.velocity.y > 0) {
          if (top > bestTop) bestTop = top;
        }
      }
      
      // Check suburbia interactive platforms
      if (currentMapRef.current.id === 'suburban-day' && suburbiaState) {
        const suburbiaPlatforms = SuburbiaMap.getCollisionPlatforms(suburbiaState, totalTimeMs);
        for (const sp of suburbiaPlatforms) {
          const isWithinX = pos.x + radius > sp.x && pos.x - radius < sp.x + sp.width;
        if (!isWithinX) continue;
          const top = sp.y;
          const feet = pos.y + radius;
          if (feet > top && feet < top + 20 && carrier.velocity.y > 0) {
            if (top > bestTop) bestTop = top;
          }
        }
      }
      
      if (bestTop !== -Infinity) {
        pos.y = bestTop - radius;
          carrier.velocity.y = 0;
          carrier.onGround = true;
      }
    }

    // Multiplayer: Sync player state to other players
    const syncPlayerToNetwork = () => {
      const mpState = multiplayerStateRef.current;
      if (!mpState.isMultiplayerGame || !mpState.roomChannel) return;
      
      const now = Date.now();
      const timeSinceLastSync = now - lastSyncTime.current;
      
      // Rate limit: 50ms minimum (20 Hz max)
      if (timeSinceLastSync < 50) return;
      
      const syncData = {
        id: localPlayerId.current,
        x: player.position.x,
        y: player.position.y,
        vx: player.velocity.x,
        vy: player.velocity.y,
        health: player.hp,
        maxHealth: player.maxHp,
        animKey: player.animKey,
        animFrame: player.animFrame,
        facingRight: player.facing > 0,
        // Include input state for replication
        inputs: {
          punch: player.jabPressed,
          kickHigh: player.kickHighPressed,
          kickLow: player.kickLowPressed,
          reverseKick: player.reverseKickPressed,
          uppercut: player.uppercutPressed,
          saltoKick: player.saltoKickPressed,
          jabHighDouble: player.jabHighDoublePressed,
          shoot: player.shootPressed,
          slash: player.slashPressed,
          block: player.blockPressed
        },
        timestamp: now
      };
      
      safeChannelPublish(mpState.roomChannel, 'playerSync', syncData);
      lastSyncTime.current = now;
    };
    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      // Update performance estimator
      const now = performance.now();
      const pr = perfRef.current;
      const dtMsPerf = now - (pr.lastNow || now);
      pr.lastNow = now;
      const instFps = 1000 / Math.max(1, dtMsPerf);
      pr.avgFps = pr.avgFps * 0.9 + instFps * 0.1;

      // ===== PERFORMANCE: Auto-degradation DISABLED =====
      // With our optimizations (spatial hash, viewport culling, batching),
      // the game runs at 60-120+ FPS without quality reduction!
      // No need to disable visual features - we maintain performance with all quality enabled!

      // Reset canvas state to avoid residual alpha/composite/filter effects
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'rgba(0,0,0,0)';

      // Sky (animated color cycle)
      if (settingsRef.current.debug.renderSky) {
        const sky = cachedSkyGradient(width, height, totalTimeMs);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, width, height);
      }

      // Distant screen-space layers (map-specific)
      const currentMap = currentMapRef.current;
      const isCityStyle = currentMap.id === 'city-platformer' || currentMap.id === 'rooftop-sunset';
      
      // Draw sun for sunset map
      if (currentMap.id === 'rooftop-sunset' && settingsRef.current.debug.renderSky) {
        RooftopsMap.drawRooftopSun(ctx, canvas, totalTimeMs);
      }
      
      // Draw sun for suburban map (daytime)
      if (currentMap.id === 'suburban-day' && settingsRef.current.debug.renderSky) {
        SuburbiaMap.drawSuburbanSun(ctx, canvas, totalTimeMs);
      }
      
      // Draw suburban background layers
      if (currentMap.id === 'suburban-day' && settingsRef.current.debug.renderSky) {
        SuburbiaMap.drawSuburbanBackground(ctx, camera, canvas, totalTimeMs);
      }
      
      if (settingsRef.current.debug.renderCityscape && currentMap.id === 'city-platformer') {
        MetropolisMap.drawMetropolisCityscape(ctx, camera, canvas, totalTimeMs, settingsRef.current.visual);
      }
      // Draw background cityscape for rooftop-sunset
      if (settingsRef.current.debug.renderCityscape && currentMap.id === 'rooftop-sunset') {
        RooftopsMap.drawRooftopCityscape(ctx, camera, canvas, totalTimeMs, settingsRef.current.visual);
      }
      // Draw stars for city maps
      if (settingsRef.current.debug.renderStars && isCityStyle) {
        RooftopsMap.drawStars(ctx, canvas, camera, stars, totalTimeMs, settingsRef.current.visual);
      }
      
      // Draw clouds for each map
      if (settingsRef.current.debug.renderClouds && settingsRef.current.visual.clouds) {
        if (currentMap.id === 'suburban-day') {
          SuburbiaMap.drawSuburbanClouds(ctx, canvas, perlin.noise.bind(perlin), totalTimeMs, settingsRef.current.visual);
        } else if (currentMap.id === 'rooftop-sunset') {
          RooftopsMap.drawRooftopClouds(ctx, canvas, perlin.noise.bind(perlin), totalTimeMs, settingsRef.current.visual);
        } else if (currentMap.id === 'city-platformer') {
          MetropolisMap.drawMetropolisClouds(ctx, canvas, perlin.noise.bind(perlin), totalTimeMs, settingsRef.current.visual);
        }
      }
      
      // NYC rooftop map animated environmental elements
      if (currentMap.id === 'rooftop-sunset' && settingsRef.current.debug.renderClouds) {
        RooftopsMap.drawNYCEnvironmentalElements(ctx, canvas, totalTimeMs);
      }
      
      // Atmospheric effects for metropolis map
      if (currentMap.id === 'city-platformer' && settingsRef.current.debug.renderSky) {
        MetropolisMap.drawMetropolisFog(ctx, canvas);
      }
      
      // Atmospheric effects for sunset map
      if (currentMap.id === 'rooftop-sunset' && settingsRef.current.debug.renderSky) {
        RooftopsMap.drawRooftopAtmosphericEffects(ctx, canvas, totalTimeMs);
      }
      
      // Atmospheric effects for suburban map
      if (currentMap.id === 'suburban-day' && settingsRef.current.debug.renderSky) {
        SuburbiaMap.drawSuburbanAtmosphericEffects(ctx, canvas, totalTimeMs);
      }
      
      // Dynamic shadows and lighting for suburban map
      if (currentMap.id === 'suburban-day') {
        SuburbiaMap.drawSuburbanLighting(ctx, camera, canvas, platforms, totalTimeMs);
      }

      ctx.save();
      
      // Apply zoom effect
      if (zoomEffect.scale !== 1.0) {
        const centerX = width / 2;
        const centerY = height / 2;
        ctx.translate(centerX, centerY);
        ctx.scale(zoomEffect.scale, zoomEffect.scale);
        ctx.translate(-centerX, -centerY);
      }
      
      ctx.translate(-camera.x, -camera.y);

      // Ground
      // Scorch decals (draw underneath entities)
      // ===== PERFORMANCE: Viewport culling + gradient optimization =====
      const viewportLeft = camera.x - 200;
      const viewportRight = camera.x + canvas.clientWidth + 200;
      const viewportTop = camera.y - 200;
      const viewportBottom = camera.y + canvas.clientHeight + 200;
      
      // ===== PERFORMANCE: Minimize save/restore by setting alpha once =====
      for (let i = scorchDecals.length - 1; i >= 0; i--) {
        const s = scorchDecals[i];
        s.a -= 0.0025; // slow fade
        if (s.a <= 0) { scorchDecals.splice(i, 1); continue; }
        
        // Skip if off-screen (save gradient creation!)
        if (s.x + s.r < viewportLeft || s.x - s.r > viewportRight ||
            s.y + s.r < viewportTop || s.y - s.r > viewportBottom) {
          continue;
        }
        
        // Only create gradient if visible
        ctx.globalAlpha = Math.max(0, Math.min(0.6, s.a));
        const rg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        rg.addColorStop(0, 'rgba(0,0,0,0.6)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1; // Reset once at end

      if (settingsRef.current.debug.renderGround) {
        if (currentMap.id === 'suburban-day') {
          SuburbiaMap.drawSuburbanGround(ctx, camera, canvas); // FIXED: New flat street system
        } else if (currentMap.id === 'city-platformer') {
          MetropolisMap.drawMetropolisGround(ctx, camera, canvas, world, perlin.noise.bind(perlin));
        }
      }
      
      // ALWAYS render suburban street system (not just in debug mode)
      if (currentMap.id === 'suburban-day') {
        SuburbiaMap.drawSuburbanGround(ctx, camera, canvas);
      }

      if (currentMap.id === 'suburban-day') SuburbiaMap.drawSuburbanDecor(ctx, camera, world, canvas, totalTimeMs);
      if (isCityStyle && currentMap.id !== 'rooftop-sunset') MetropolisMap.drawCityStreetDecor(ctx, camera, world, canvas);
      
      if (currentMap.id === 'suburban-day' && suburbiaState) {
        SuburbiaMap.drawSuburbiaInteractivePlatforms(ctx, suburbiaState, totalTimeMs, camera, canvas);
        // RENDER NEW PERSISTENT NEIGHBORHOOD SYSTEM
        SuburbiaMap.renderSuburbiaNeighborhood(ctx, suburbiaState, camera, canvas);
      }

      if (currentMap.id === 'rooftop-sunset') RooftopsMap.drawRooftopBuildings(ctx, currentMapRef.current, camera, world, canvas, totalTimeMs);

      if (settingsRef.current.debug.renderPlatforms) {
        // Platform rendering is now async due to caching
        drawPlatforms().catch(console.error);
      }

      if (currentMap.boundaries) {
        if (currentMap.id === 'city-platformer') {
          MetropolisMap.drawMetropolisBoundaryWalls(ctx, currentMap.boundaries, camera, world, canvas);
        } else if (currentMap.id === 'suburban-day') {
          SuburbiaMap.drawSuburbanBoundaryWalls(ctx, currentMap.boundaries, camera, world, canvas);
        }
      }
      // Pickups
      drawPickups();

      // Skybridges connecting nearby buildings
      if (isCityStyle) {
        MetropolisMap.drawMetropolisSkybridges(ctx, camera, canvas, platforms);
      }

      // Player
      if (settingsRef.current.debug.renderPlayer) drawPlayer();

      // Remote players (multiplayer)
      drawRemotePlayers();

      // Enemies
      if (settingsRef.current.debug.renderEnemies) drawEnemies();

      // Debug collision boxes
      drawCollisionBoxes();

      // Bullets
      if (settingsRef.current.debug.renderBullets) drawBullets();

      // Particles
      if (settingsRef.current.debug.renderParticles) drawParticles();

      // Proton particles (world space with camera transform)
      ctx.save();
      ctx.translate(-camera.x, -camera.y);
      if (proton.renderers && proton.renderers.length > 0) {
        proton.renderers[0].onProtonUpdate();
      }
      ctx.restore();

      // Shell casings
      // ===== PERFORMANCE: Viewport culling + reduced save/restore =====
      // Group casings by color to minimize state changes
      const casingsByColor = new Map<string, typeof casings>();
      for (const c of casings) {
        if (c.x < viewportLeft - 20 || c.x > viewportRight + 20 ||
            c.y < viewportTop - 20 || c.y > viewportBottom + 20) {
          continue;
        }
        if (!casingsByColor.has(c.color)) {
          casingsByColor.set(c.color, []);
        }
        casingsByColor.get(c.color)!.push(c);
      }
      
      // Draw all casings of same color together (fewer fillStyle changes)
      ctx.save();
      for (const [color, colorCasings] of casingsByColor) {
        ctx.fillStyle = color;
        for (const c of colorCasings) {
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(c.rot);
          ctx.fillRect(-c.size, -c.size*0.4, c.size*2, c.size*0.8);
          ctx.restore();
        }
      }
      ctx.restore();

      // Overdrive afterimages
      // ===== PERFORMANCE: Viewport culling for afterimages =====
      for (const a of afterimages) {
        const t = 1 - Math.max(0, Math.min(1, a.age / a.max));
        const ax = player.position.x + (a.x - player.position.x) * t;
        const ay = player.position.y + (a.y - player.position.y) * t;
        
        // Skip if off-screen
        if (ax < viewportLeft - 50 || ax > viewportRight + 50 ||
            ay < viewportTop - 50 || ay > viewportBottom + 50) {
          continue;
        }
        
        ctx.save();
        ctx.globalAlpha = 0.25 * t;
        ctx.fillStyle = '#ff41a4';
        drawCapsule(ctx, ax, ay, player.radius * 1.5, player.radius * 2.1, '#ff41a4', '#ff98cb');
        ctx.restore();
      }
      // Floating world-space texts
      // ===== PERFORMANCE: Set font/textAlign once, group by color =====
      ctx.save();
      ctx.font = `bold 12px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      
      // Group by color to minimize fillStyle changes
      const textsByColor = new Map<string, Array<{text: string; x: number; y: number; alpha: number; size?: number}>>();
      for (const ft of floatingTexts) {
        if (ft.x < viewportLeft - 50 || ft.x > viewportRight + 50 ||
            ft.y < viewportTop - 50 || ft.y > viewportBottom + 50) {
          continue;
        }
        
        if (!textsByColor.has(ft.color)) {
          textsByColor.set(ft.color, []);
        }
        const a = Math.max(0, Math.min(1, ft.life / 900));
        textsByColor.get(ft.color)!.push({text: ft.text, x: ft.x, y: ft.y, alpha: a, size: ft.size});
      }
      
      // Draw all texts of same color together
      for (const [color, colorTexts] of textsByColor) {
        ctx.fillStyle = color;
        for (const t of colorTexts) {
          if (t.size && t.size !== 12) {
            ctx.font = `bold ${t.size}px ui-monospace, monospace`;
          }
          ctx.globalAlpha = t.alpha;
          ctx.fillText(t.text, t.x, t.y);
          if (t.size && t.size !== 12) {
            ctx.font = `bold 12px ui-monospace, monospace`; // Reset to default
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      ctx.restore();

      // Weapon beam FX
      drawWeaponFX();

      // Lightning arcs
      // ===== PERFORMANCE: Viewport culling for lightning arcs =====
      if (settingsRef.current.debug.renderEffects && lightningArcs.length > 0) {
        ctx.save();
        // Apply camera transform for world-space lightning coordinates
        ctx.translate(-camera.x, -camera.y);
        ctx.strokeStyle = 'rgba(155,224,255,0.8)';
        ctx.lineWidth = 2;
        for (let i=lightningArcs.length-1;i>=0;i--) {
          const arc = lightningArcs[i];
          arc.lifeMs -= 16;
          
          // ===== PERFORMANCE: Skip if arc is completely off-screen =====
          // Get arc bounds from points
          if (arc.points.length >= 2) {
            const x1 = arc.points[0];
            const y1 = arc.points[1];
            const x2 = arc.points[arc.points.length - 2];
            const y2 = arc.points[arc.points.length - 1];
            const minX = Math.min(x1, x2);
            const maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2);
            const maxY = Math.max(y1, y2);
            
            if (maxX < viewportLeft || minX > viewportRight ||
                maxY < viewportTop || minY > viewportBottom) {
              if (arc.lifeMs<=0) lightningArcs.splice(i,1);
              continue;
            }
          }
          
          const pts = arc.points;
          ctx.beginPath();
          for (let j=0;j<pts.length;j+=2) {
            const x = pts[j], y = pts[j+1];
            if (j===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
          }
          ctx.stroke();
          if (arc.lifeMs<=0) lightningArcs.splice(i,1);
        }
        ctx.restore();
      }

      // Additive bloom pass (cheap): blur sampled copy and add
      if (settingsRef.current.debug.renderBloom && settingsRef.current.visual.bloom) {
        try {
          post2Ctx.clearRect(0, 0, post2.width, post2.height);
          post2Ctx.globalAlpha = settingsRef.current.visual.bloomAlpha;
          // Copy scene into low-res buffer
          post2Ctx.drawImage(canvas, 0, 0, post2.width, post2.height);
          // Cheap blur using canvas filter without readbacks
          post2Ctx.filter = `blur(${Math.max(1, settingsRef.current.visual.bloomRadius)}px)`;
          post2Ctx.drawImage(post2, 0, 0);
          post2Ctx.filter = 'none';
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(post2, 0, 0, canvas.width, canvas.height);
          ctx.globalCompositeOperation = 'source-over';
          post2Ctx.globalAlpha = 1;
        } catch {}
      }
      // Pixelate the composed scene before UI/overlays
      const retro = settingsRef.current.retro;
      const visual = settingsRef.current.visual;
      if (retro.pixelate) {
        postCtx.imageSmoothingEnabled = false;
        postCtx.clearRect(0, 0, post.width, post.height);
        postCtx.drawImage(canvas, 0, 0, post.width, post.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (visual.chromaticAberration) {
          ctx.filter = 'contrast(1.04) saturate(1.18)';
          ctx.drawImage(post, 0, 0, canvas.width, canvas.height);
          const dx = retro.pixelScale * visual.aberrationPx;
          ctx.globalAlpha = 0.5; ctx.filter = 'hue-rotate(16deg)';
          ctx.drawImage(post, dx, 0, canvas.width, canvas.height);
          ctx.filter = 'hue-rotate(-16deg)';
          ctx.drawImage(post, -dx, 0, canvas.width, canvas.height);
          ctx.globalAlpha = 1; ctx.filter = 'none';
        } else {
          ctx.drawImage(post, 0, 0, canvas.width, canvas.height);
        }
      }

      // Rain overlay (screen space)
      if (settingsRef.current.debug.renderRain && visual.rain) {
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = '#ff6666';
        ctx.lineWidth = 1;
        for (const r of rainDrops) {
          ctx.beginPath();
          ctx.moveTo(r.x, r.y);
          ctx.lineTo(r.x - 4, r.y + 10);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Dynamic lights overlay (additive) - convert world -> screen by subtracting camera
      // ===== PERFORMANCE: Viewport culling + gradient optimization =====
      if (dynamicLights.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const L of dynamicLights) {
          const sx = L.x - camera.x;
          const sy = L.y - camera.y;
          
          // ===== PERFORMANCE: Skip if light is off-screen =====
          // Check in screen space (sx, sy are already screen-relative)
          if (sx + L.r < -200 || sx - L.r > canvas.clientWidth + 200 ||
              sy + L.r < -200 || sy - L.r > canvas.clientHeight + 200) {
            continue;
          }
          
          // Only create gradient if we're actually drawing
          const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, L.r);
          const base = L.color.replace(/\,1\)/, `,${Math.max(0, Math.min(1, L.a))})`);
          rg.addColorStop(0, base);
          rg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(sx, sy, L.r, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
      }

      // UI overlay
      if (settingsRef.current.debug.renderHUD) {
        drawHUD();
        drawWeaponWheel();
      }

      // CRT scanlines + vignette overlay
      if (settingsRef.current.debug.renderCRT) drawCRT();

      // Film grain (cached noise buffer for performance)
      if (visual.grainAlpha > 0) {
        const w = canvas.width, h = canvas.height;
        if (noise.width !== w || noise.height !== h) {
          noise.width = w; noise.height = h;
          // regenerate noise
          const id = noiseCtx.createImageData(w, h);
          const data = id.data;
          for (let i = 0; i < data.length; i += 4) {
            const v = Math.random() * 255;
            data[i] = data[i+1] = data[i+2] = v;
            data[i+3] = 255;
          }
          noiseCtx.putImageData(id, 0, 0);
        }
        ctx.globalAlpha = visual.grainAlpha;
        ctx.drawImage(noise, 0, 0);
        ctx.globalAlpha = 1;
      }

      // Intro overlay
      drawIntroOverlay();

      // Pause/game over overlay
      drawPauseOverlay();
    };
    
    // Helper functions for color manipulation
    function lightenColor(color: string, percent: number): string {
      const num = parseInt(color.replace("#",""), 16);
      const amt = Math.round(2.55 * percent);
      const R = (num >> 16) + amt;
      const G = (num >> 8 & 0x00FF) + amt;
      const B = (num & 0x0000FF) + amt;
      return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255)).toString(16).slice(1);
    }
    
    function darkenColor(color: string, percent: number): string {
      const num = parseInt(color.replace("#",""), 16);
      const amt = Math.round(2.55 * percent);
      const R = (num >> 16) - amt;
      const G = (num >> 8 & 0x00FF) - amt;
      const B = (num & 0x0000FF) - amt;
      return "#" + (0x1000000 + (R<1?0:R>255?255:R)*0x10000 + (G<1?0:G>255?255:G)*0x100 + (B<1?0:B>255?255:B)).toString(16).slice(1);
    }
    
    // ========== PERFORMANCE OPTIMIZATION: Gradient Cache ==========
    // Create gradients once instead of recreating them every frame
    const gradientCache = new Map<string, CanvasGradient>();
    
    
    const skylineCache: { rects: {x:number;y:number;w:number;h:number}[]; seedW:number; x0:number; x1:number } = { rects: [], seedW: 0, x0: 0, x1: 0 };
    function drawSkyline() {
      if (!settingsRef.current.visual.skyline) return;
      const x0 = camera.x - 50;
      const x1 = camera.x + canvas.clientWidth + 50;
      const baseY = world.baseGroundY + 60;
      // Recompute cached skyline segments only when range changes a lot
      if (skylineCache.rects.length === 0 || x0 < skylineCache.x0 + 100 || x1 > skylineCache.x1 - 100) {
        skylineCache.rects.length = 0;
        const start = Math.floor(x0 / 140) * 140;
        for (let x = start; x <= x1; x += 140) {
          const w = 80 + Math.random() * 100;
          const h = 140 + Math.random() * 180;
          skylineCache.rects.push({ x, y: baseY - h, w, h });
        }
        skylineCache.x0 = x0; skylineCache.x1 = x1;
      }
      ctx.fillStyle = '#252525';
      for (const r of skylineCache.rects) {
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      // Simple window pass using deterministic stride (no per-frame random)
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (const r of skylineCache.rects) {
        for (let wx = r.x + 10; wx < r.x + r.w - 10; wx += 16) {
          for (let wy = r.y + 12; wy < baseY - 8; wy += 14) {
            // sparse pattern: every 3rd in x and 2nd in y
            const ix = Math.floor((wx - r.x) / 16);
            const iy = Math.floor((wy - r.y) / 14);
            if (((ix + iy) % 3) === 0) ctx.fillRect(wx, wy, 8, 6);
          }
        }
      }
      const grad = ctx.createLinearGradient(0, baseY - 40, 0, baseY + 40);
      grad.addColorStop(0, 'rgba(100,100,100,0.25)');
      grad.addColorStop(1, 'rgba(100,100,100,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0, baseY - 40, (x1 - x0), 80);
    }
    function drawCRT() {
      // Subtle scanlines + vignette
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      // Scanlines
      ctx.globalAlpha = settingsRef.current.retro.crtScanlineAlpha;
      for (let y = 0; y < h; y += 4) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, y, w, 1);
      }
      ctx.globalAlpha = 1;
      // Vignette
      const rg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(1, `rgba(0,0,0,${settingsRef.current.retro.vignetteAlpha})`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    function drawParallaxLayer(scale: number, amplitude: number, color: string, offsetYFactor: number, stepPx: number) {
      const x0 = camera.x - 50;
      const x1 = camera.x + canvas.clientWidth + 50;
      ctx.beginPath();
      for (let x = Math.floor(x0 / stepPx) * stepPx; x <= x1; x += stepPx) {
        const n = perlin.noise(x * scale);
        const y = world.baseGroundY * offsetYFactor + (n - 0.5) * 2 * amplitude;
        if (x === Math.floor(x0 / stepPx) * stepPx) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(x1, canvas.clientHeight + camera.y + 2000);
      ctx.lineTo(x0, canvas.clientHeight + camera.y + 2000);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    // drawGround moved to respective map modules (suburbia.ts, metropolis.ts)
    // Metropolis rendering functions now in metropolis.ts module
    // NOTE: drawRooftopBuildings() wrapper removed - use RooftopsMap.drawRooftopBuildings() directly
    
    /**
     * Render a suburban house to an offscreen canvas for caching
     * This extracts all the complex house rendering logic into a cacheable format
     */
    async function renderSuburbanHouseToCache(
      platform: Platform, 
      pSeed: number, 
      pw: number, 
      ph: number, 
      totalTimeMs: number
    ): Promise<ImageBitmap> {
      const margin = 50;
      const { canvas: offscreenCanvas, ctx: offCtx } = createOffscreenCanvas(pw + margin * 2, ph + margin * 2);
      
      // Translate to center in the offscreen canvas
      offCtx.translate(margin, margin);
      
      // ===== SUBURBAN HOUSE RENDERING (extracted from original code) =====
      const houseColors = ['#FFE5CC', '#E8F5E9', '#FFF9C4', '#F3E5F5', '#E1F5FE', '#FFCDD2', '#C8E6C9'];
      const roofColors = ['#D84315', '#BF360C', '#5D4037', '#616161', '#37474F', '#1976D2'];
      const trimColors = ['#FFFFFF', '#F5F5F5', '#EEEEEE'];
      const houseColorIndex = Math.abs(pSeed) % houseColors.length;
      const roofColorIndex = Math.abs(pSeed) % roofColors.length;
      const houseStyle = seededRand(pSeed, 200);
      
      // House shadow on ground
      offCtx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      offCtx.beginPath();
      offCtx.ellipse(pw/2, ph + 2, pw * 0.6, 8, 0, 0, Math.PI * 2);
      offCtx.fill();
      
      // House body with gradient for depth
      const baseColor = houseColors[houseColorIndex];
      const gradKey = `house_${houseColorIndex}_${pw}`;
      let houseGrad = gradientCache.get(gradKey);
      if (!houseGrad) {
        houseGrad = offCtx.createLinearGradient(0, 0, pw, 0);
        houseGrad.addColorStop(0, baseColor);
        houseGrad.addColorStop(0.5, lightenColor(baseColor, 10));
        houseGrad.addColorStop(1, darkenColor(baseColor, 10));
        gradientCache.set(gradKey, houseGrad);
      }
      offCtx.save();
      offCtx.translate(0, ph * 0.25);
      offCtx.fillStyle = houseGrad;
      offCtx.fillRect(0, 0, pw, ph * 0.75);
      offCtx.restore();
      
      // House side panel for 3D effect
      offCtx.fillStyle = darkenColor(baseColor, 20);
      offCtx.beginPath();
      offCtx.moveTo(pw, ph * 0.25);
      offCtx.lineTo(pw + 8, ph * 0.2);
      offCtx.lineTo(pw + 8, ph - 5);
      offCtx.lineTo(pw, ph);
      offCtx.closePath();
      offCtx.fill();
      
      // Check for special building styles
      const bStyle = platform.buildingStyle || 0;
      if (bStyle >= 10 && bStyle < 20) {
        // MANSION STYLE
        const level = bStyle - 10;
        
        // Fancy roof with multiple peaks
        offCtx.fillStyle = roofColors[roofColorIndex];
        offCtx.beginPath();
        offCtx.moveTo(-15, ph * 0.25);
        offCtx.lineTo(pw * 0.3, -10);
        offCtx.lineTo(pw * 0.5, 5);
        offCtx.lineTo(pw * 0.7, -10);
        offCtx.lineTo(pw + 15, ph * 0.25);
        offCtx.closePath();
        offCtx.fill();
        
        // Columns for ground floor
        if (level === 0) {
          offCtx.fillStyle = '#F5F5F5';
          for (let col = 0; col < 4; col++) {
            const colX = 20 + col * (pw - 40) / 3;
            offCtx.fillRect(colX, ph * 0.4, 8, ph * 0.6);
            // Column capital
            offCtx.fillRect(colX - 2, ph * 0.4, 12, 6);
          }
        }
        
        // Large windows for upper floors
        if (level > 0) {
          const windowRows = 2;
          const windowCols = Math.floor(pw / 60);
          for (let row = 0; row < windowRows; row++) {
            for (let col = 0; col < windowCols; col++) {
              const wx = 20 + col * (pw - 40) / windowCols;
              const wy = ph * 0.3 + row * ph * 0.3;
              
              // Floor-to-ceiling windows
              offCtx.fillStyle = '#E3F2FD';
              offCtx.fillRect(wx, wy, 40, ph * 0.25);
              
              // Window frame
              offCtx.strokeStyle = '#757575';
              offCtx.lineWidth = 2;
              offCtx.strokeRect(wx, wy, 40, ph * 0.25);
              
              // Window glare
              offCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
              offCtx.fillRect(wx, wy, 15, 8);
            }
          }
        }
        
        // Decorative elements
        offCtx.fillStyle = '#FFD700';
        offCtx.beginPath();
        offCtx.arc(pw / 2, 10, 8, 0, Math.PI * 2);
        offCtx.fill();
        
      } else if (bStyle === 20) {
        // GARAGE STYLE
        offCtx.fillStyle = '#8D6E63';
        offCtx.fillRect(0, ph * 0.3, pw, ph * 0.7);
        
        // Garage door
        offCtx.fillStyle = '#6D4C41';
        offCtx.fillRect(10, ph * 0.4, pw - 20, ph * 0.6);
        
        // Garage door panels
        offCtx.strokeStyle = '#5D4037';
        offCtx.lineWidth = 2;
        for (let panel = 0; panel < 4; panel++) {
          const panelY = ph * 0.4 + panel * ph * 0.15;
          offCtx.beginPath();
          offCtx.moveTo(10, panelY);
          offCtx.lineTo(pw - 10, panelY);
          offCtx.stroke();
        }
        
        // Garage window
        offCtx.fillStyle = '#B3E5FC';
        offCtx.fillRect(pw / 2 - 20, ph * 0.5, 40, 15);
        
      } else if (bStyle === 30) {
        // TREEHOUSE STYLE
        // Wood texture
        const woodGrad = offCtx.createLinearGradient(0, 0, 0, ph);
        woodGrad.addColorStop(0, '#8D6E63');
        woodGrad.addColorStop(0.5, '#A1887F');
        woodGrad.addColorStop(1, '#795548');
        offCtx.fillStyle = woodGrad;
        offCtx.fillRect(0, 0, pw, ph);
        
        // Wood planks
        offCtx.strokeStyle = '#6D4C41';
        offCtx.lineWidth = 1;
        for (let plank = 0; plank < ph / 8; plank++) {
          offCtx.beginPath();
          offCtx.moveTo(0, plank * 8);
          offCtx.lineTo(pw, plank * 8);
          offCtx.stroke();
        }
        
        // Rope railings
        offCtx.strokeStyle = '#5D4037';
        offCtx.lineWidth = 3;
        offCtx.beginPath();
        offCtx.moveTo(0, -5);
        offCtx.lineTo(pw, -5);
        offCtx.stroke();
        
        // Support posts
        offCtx.fillStyle = '#6D4C41';
        offCtx.fillRect(-5, 0, 10, ph);
        offCtx.fillRect(pw - 5, 0, 10, ph);
        
      } else if (bStyle === 40) {
        // PLAYGROUND STYLE
        // Colorful metal structure
        const colors = ['#FF5252', '#2196F3', '#4CAF50', '#FFEB3B'];
        const colorIndex = Math.floor(platform.seed * colors.length) % colors.length;
        
        offCtx.fillStyle = colors[colorIndex];
        offCtx.fillRect(0, 0, pw, ph);
        
        // Metal shine
        offCtx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        offCtx.fillRect(0, 0, pw, 5);
        
        // Safety padding
        offCtx.fillStyle = '#424242';
        offCtx.fillRect(0, ph - 10, pw, 10);
        
        // Bolts
        offCtx.fillStyle = '#757575';
        for (let bolt = 0; bolt < 4; bolt++) {
          const bx = 10 + bolt * (pw - 20) / 3;
          offCtx.beginPath();
          offCtx.arc(bx, 10, 3, 0, Math.PI * 2);
          offCtx.fill();
        }
        
      } else if (bStyle === 50) {
        // POOL DECK STYLE
        // Concrete deck
        offCtx.fillStyle = '#E0E0E0';
        offCtx.fillRect(0, 0, pw, ph);
        
        // Pool water effect
        const waterGrad = offCtx.createLinearGradient(0, 0, 0, ph);
        waterGrad.addColorStop(0, 'rgba(33, 150, 243, 0.6)');
        waterGrad.addColorStop(1, 'rgba(21, 101, 192, 0.8)');
        offCtx.fillStyle = waterGrad;
        offCtx.fillRect(20, 5, pw - 40, ph - 10);
        
        // Water ripples (static for cache - dynamic version in main render)
        offCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        offCtx.lineWidth = 1;
        for (let ripple = 0; ripple < 3; ripple++) {
          const rx = pw / 2;
          const ry = ph / 2;
          const rr = 10 + ripple * 15;
          offCtx.beginPath();
          offCtx.arc(rx, ry, rr, 0, Math.PI * 2);
          offCtx.stroke();
        }
        
      } else if (bStyle === 51) {
        // POOL HOUSE STYLE
        offCtx.fillStyle = '#FFCCBC';
        offCtx.fillRect(0, ph * 0.3, pw, ph * 0.7);
        
        // Striped awning
        offCtx.fillStyle = '#FF5722';
        offCtx.fillRect(-10, ph * 0.25, pw + 20, 10);
        offCtx.fillStyle = '#FFFFFF';
        for (let stripe = 0; stripe < 5; stripe++) {
          offCtx.fillRect(-10 + stripe * (pw + 20) / 5, ph * 0.25, (pw + 20) / 10, 10);
        }
        
        // Glass doors
        offCtx.fillStyle = 'rgba(158, 235, 252, 0.8)';
        offCtx.fillRect(15, ph * 0.5, pw - 30, ph * 0.5);
        
      } else {
        // NORMAL HOUSE STYLE
        
        // Roof (triangle)
        offCtx.fillStyle = roofColors[roofColorIndex];
        offCtx.beginPath();
        offCtx.moveTo(-10, ph * 0.25);
        offCtx.lineTo(pw / 2, 0);
        offCtx.lineTo(pw + 10, ph * 0.25);
        offCtx.closePath();
        offCtx.fill();
        
        // Roof outline
        offCtx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        offCtx.lineWidth = 2;
        offCtx.stroke();
        
        // Windows
        const cols = Math.max(2, Math.min(4, Math.floor(pw / 50)));
        const windowWidth = 18;
        const windowHeight = 22;
        const spacing = (pw - cols * windowWidth) / (cols + 1);
        
        for (let i = 0; i < cols; i++) {
          const wx = spacing * (i + 1) + windowWidth * i;
          const wy = ph * 0.45;
          
          // Window frame
          offCtx.fillStyle = '#FFFFFF';
          offCtx.fillRect(wx, wy, windowWidth, windowHeight);
          
          // Window panes (light blue/cyan)
          offCtx.fillStyle = '#B3E5FC';
          offCtx.fillRect(wx + 2, wy + 2, windowWidth - 4, windowHeight - 4);
          
          // Window cross
          offCtx.strokeStyle = '#FFFFFF';
          offCtx.lineWidth = 2;
          offCtx.beginPath();
          offCtx.moveTo(wx + windowWidth / 2, wy);
          offCtx.lineTo(wx + windowWidth / 2, wy + windowHeight);
          offCtx.moveTo(wx, wy + windowHeight / 2);
          offCtx.lineTo(wx + windowWidth, wy + windowHeight / 2);
          offCtx.stroke();
        }
        
        // Door
        const doorWidth = 14;
        const doorHeight = ph * 0.35;
        const doorX = pw / 2 - doorWidth / 2;
        const doorY = ph - doorHeight;
        
        offCtx.fillStyle = '#8D6E63';
        offCtx.fillRect(doorX, doorY, doorWidth, doorHeight);
        
        // Door knob
        offCtx.fillStyle = '#FFD54F';
        offCtx.beginPath();
        offCtx.arc(doorX + doorWidth - 4, doorY + doorHeight / 2, 2, 0, Math.PI * 2);
        offCtx.fill();
        
        // House outline
        offCtx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        offCtx.lineWidth = 2;
        offCtx.strokeRect(0, ph * 0.25, pw, ph * 0.75);
        
        // Chimney (sometimes)
        if (seededRand(pSeed, 100) > 0.5) {
          const chimneyX = pw * 0.75;
          const chimneyY = ph * 0.1;
          offCtx.fillStyle = roofColors[roofColorIndex];
          offCtx.fillRect(chimneyX, chimneyY, 8, ph * 0.2);
          offCtx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
          offCtx.strokeRect(chimneyX, chimneyY, 8, ph * 0.2);
        }
      }
      
      // Platform surface (clean line on top)
      offCtx.strokeStyle = "#81C784";
      offCtx.lineWidth = 3;
      offCtx.beginPath();
      offCtx.moveTo(0, 0);
      offCtx.lineTo(pw, 0);
      offCtx.stroke();
      
      return await canvasToImageBitmap(offscreenCanvas);
    }
    
    /**
     * Draw dynamic thruster effects for hover platforms (can't be cached)
     */
    function drawSuburbanHouseThrusters(
      ctx: CanvasRenderingContext2D,
      px: number,
      py: number,
      pw: number,
      ph: number,
      pSeed: number,
      totalTimeMs: number
    ): void {
      const thrusterCount = Math.max(2, Math.floor(pw / 220));
      const flameBaseY = py + ph;
      
      for (let t = 0; t < thrusterCount; t++) {
        const tRatio = (t + 0.5) / thrusterCount;
        const thrusterX = px + tRatio * pw;
        const flicker = Math.sin(totalTimeMs * 0.02 + pSeed * 0.4 + t * 1.7);
        const flameLength = 48 + flicker * 10;
        
        // Thruster housing
        ctx.fillStyle = '#424242';
        ctx.fillRect(thrusterX - 12, flameBaseY - 6, 24, 12);
        ctx.fillStyle = '#616161';
        ctx.fillRect(thrusterX - 8, flameBaseY - 2, 16, 6);
        
        // Flame
        const flameGrad = ctx.createLinearGradient(thrusterX, flameBaseY, thrusterX, flameBaseY + flameLength);
        flameGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        flameGrad.addColorStop(0.2, 'rgba(255, 213, 79, 0.9)');
        flameGrad.addColorStop(0.55, 'rgba(255, 111, 0, 0.75)');
        flameGrad.addColorStop(1, 'rgba(255, 61, 0, 0)');
        ctx.fillStyle = flameGrad;
        ctx.beginPath();
        ctx.moveTo(thrusterX, flameBaseY);
        ctx.quadraticCurveTo(thrusterX - 10, flameBaseY + flameLength * 0.6, thrusterX - 4, flameBaseY + flameLength);
        ctx.lineTo(thrusterX + 4, flameBaseY + flameLength);
        ctx.quadraticCurveTo(thrusterX + 10, flameBaseY + flameLength * 0.6, thrusterX, flameBaseY);
        ctx.fill();
        
        // Exhaust glow
        ctx.fillStyle = 'rgba(255, 183, 77, 0.35)';
        ctx.beginPath();
        ctx.ellipse(thrusterX, flameBaseY + flameLength * 0.85, 14, 6 + flicker * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    async function drawPlatforms() {
      const left = camera.x - 100;
      const right = camera.x + canvas.clientWidth + 100;
      const top = camera.y - 200;
      const bottom = camera.y + canvas.clientHeight + 200;
      const currentMap = currentMapRef.current;
      visiblePlatformDrawCount = 0;
      
      // For rooftop map, DON'T draw any platforms - buildings are drawn separately
      if (currentMap.id === 'rooftop-sunset') {
        return; // Exit early, no platform rendering needed
      }
      
      for (const p of platforms) {
        if (p.x + p.width < left || p.x > right || p.y + p.height < top || p.y > bottom) continue;
        visiblePlatformDrawCount++;
        
        // Round all coordinates to prevent subpixel rendering glitches
        const px = Math.round(p.x);
        const py = Math.round(p.y);
        const pw = Math.round(p.width);
        const ph = Math.round(p.height);
        
        // Use platform's x position as a deterministic seed
        const pSeed = Math.floor(px / 10);
        
        // Platform rendering for other maps
        if (currentMap.id === 'suburban-day') {
          // ===== PERFORMANCE: Platform Caching System =====
          // Each suburban house normally requires 20-50+ canvas operations per frame
          // With caching, this becomes a single ctx.drawImage() call
          
          const cacheKey = platformCacheManager.generateCacheKey(p, currentMap.id);
          let cachedHouse = platformCacheManager.get(cacheKey);
          
          if (!cachedHouse) {
            // Render house to offscreen canvas for caching
            cachedHouse = await renderSuburbanHouseToCache(p, pSeed, pw, ph, totalTimeMs);
            platformCacheManager.set(cacheKey, cachedHouse);
          }
          
          // Ultra-fast single drawImage call!
          const margin = 50;
          ctx.drawImage(cachedHouse, px - margin, py - margin);
          
          // Handle dynamic elements separately (can't be cached)
          if (p.kind === 'hover' && (p.hasThrusters || p.motion)) {
            drawSuburbanHouseThrusters(ctx, px, py, pw, ph, pSeed, totalTimeMs);
          }
          
          continue; // Skip the old rendering code - now using cached version
          
        } else {
          // CITY BUILDINGS - Style varies by map
          const isRooftopSunset = currentMap.id === 'rooftop-sunset';
          
          // Building base color - warmer for sunset, dark for night
          ctx.fillStyle = isRooftopSunset ? "rgba(60,35,50,0.95)" : "rgba(20,20,20,0.95)";
          ctx.fillRect(px, py, pw, ph);
          
          // Top highlight - warmer glow for sunset
          ctx.fillStyle = isRooftopSunset ? "rgba(255,150,150,0.12)" : "rgba(255,255,255,0.08)";
          ctx.fillRect(px, py, pw, 4);
          
          // Side shadow
          ctx.fillStyle = isRooftopSunset ? "rgba(40,20,30,0.2)" : "rgba(0,0,0,0.15)";
          ctx.fillRect(px + pw - 3, py, 3, ph);

          // Facade vertical columns/mullions
          ctx.fillStyle = 'rgba(100,100,100,0.15)';
          for (let vx = px + 8; vx < px + pw - 8; vx += 30) {
            ctx.fillRect(Math.round(vx), py + 6, 2, ph - 12);
          }

          // Windows grid
          const cols = Math.max(2, Math.floor(pw / 40));
          const rows = Math.max(2, Math.floor(ph / 40));
          const padX = (pw - cols * 20) / (cols + 1);
          const padY = (ph - rows * 16) / (rows + 1);
          for (let cx = 0; cx < cols; cx++) {
            for (let ry = 0; ry < rows; ry++) {
              const wx = Math.round(px + padX * (cx + 1) + 20 * cx);
              const wy = Math.round(py + padY * (ry + 1) + 16 * ry);
              const windowSeed = seededRand(pSeed, cx * 100 + ry);
              // Window frame - darker for night, purple-tinted for sunset
              ctx.fillStyle = isRooftopSunset 
                ? (windowSeed < 0.3 ? "#1a0a1a" : "#0f050f")
                : (windowSeed < 0.3 ? "#0a0a0a" : "#050505");
              ctx.fillRect(wx, wy, 20, 16);
              // Window light - warm orange/yellow glow for sunset, cool white for night
              ctx.fillStyle = isRooftopSunset
                ? "rgba(255,180,100,0.25)"
                : "rgba(255,255,255,0.20)";
              ctx.fillRect(wx + 2, wy + 2, 16, 12);
            }
          }

          // Roof highlight/platform line - warmer for sunset
          ctx.strokeStyle = isRooftopSunset ? "rgba(255,150,150,0.5)" : "rgba(200,200,200,0.4)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + pw, py);
          ctx.stroke();

          if (seededRand(pSeed, 400) > 0.8) {
            const lampBaseX = px + (seededRand(pSeed, 401) * pw);
            const lampBaseY = py + ph;
            const lampHeight = 80 + seededRand(pSeed, 402) * 120;
            const lampColor = 'rgba(255, 230, 180, 0.85)';

            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = '#555555';
            ctx.lineWidth = 4;
            ctx.moveTo(lampBaseX, lampBaseY);
            ctx.lineTo(lampBaseX, lampBaseY - lampHeight);
            ctx.stroke();

            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(lampBaseX, lampBaseY - lampHeight);
            ctx.lineTo(lampBaseX + 12, lampBaseY - lampHeight + 6);
            ctx.stroke();

            ctx.beginPath();
            ctx.fillStyle = lampColor;
            ctx.arc(lampBaseX + 12, lampBaseY - lampHeight + 6, 10, 0, Math.PI * 2);
            ctx.fill();

            ctx.shadowColor = lampColor;
            ctx.shadowBlur = 25;
            ctx.beginPath();
            ctx.arc(lampBaseX + 12, lampBaseY - lampHeight + 6, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();
          }
        }

        // Rooftop props (vents, tanks, antennas via emoji) - deterministic placement
        const propSeed1 = seededRand(pSeed, 1);
        const propSeed2 = seededRand(pSeed, 2);
        const propSeed3 = seededRand(pSeed, 3);
        if (propSeed1 < 0.25) drawEmojiSprite('???', Math.round(px + 10 + seededRand(pSeed, 4) * (pw - 20)), py - 10, 18, HUD_MONO_THEME.accentMuted);
        if (propSeed2 < 0.2) drawEmojiSprite('??', Math.round(px + 10 + seededRand(pSeed, 5) * (pw - 20)), py - 12, 18, HUD_MONO_THEME.accentMuted);
        if (propSeed3 < 0.2) drawEmojiSprite('???', Math.round(px + 10 + seededRand(pSeed, 6) * (pw - 20)), py - 8, 16, HUD_MONO_THEME.accentMuted);


      }
    }
    // drawSkybridges moved to metropolis.ts
    function drawStickFigure(c: CanvasRenderingContext2D, color: string) {
      c.save();
      c.strokeStyle = color;
      c.lineWidth = 3;
      c.lineCap = 'round';
      // Head
      c.beginPath(); c.arc(0, -12, 6, 0, Math.PI*2); c.stroke();
      // Body
      c.beginPath(); c.moveTo(0, -6); c.lineTo(0, 12); c.stroke();
      // Arms
      c.beginPath(); c.moveTo(0, 0); c.lineTo(10, 4); c.moveTo(0,0); c.lineTo(-10,4); c.stroke();
      // Legs
      c.beginPath(); c.moveTo(0,12); c.lineTo(8,24); c.moveTo(0,12); c.lineTo(-8,24); c.stroke();
      c.restore();
    }
    function drawPlayer() {
      drawShadow(ctx, player.position.x, player.position.y + player.radius, player.radius);

      const bodyColor = player.invulnMs > 0 ? "#ffa6d0" : "#ff41a4";
      if (player.bloodOverlay > 0) {
        const overlay = Math.min(1.15, player.bloodOverlay);
        ctx.save();
        ctx.globalAlpha = overlay * 0.45;
        const grad = ctx.createRadialGradient(
          player.position.x,
          player.position.y - player.radius * 0.2,
          player.radius * 0.3,
          player.position.x,
          player.position.y - player.radius * 0.2,
          Math.max(220, player.radius * 8)
        );
        grad.addColorStop(0, 'rgba(140,0,0,0.95)');
        grad.addColorStop(0.45, 'rgba(110,0,0,0.4)');
        grad.addColorStop(1, 'rgba(90,0,0,0)');
        ctx.fillStyle = grad;
        const bleedRadius = Math.max(220, player.radius * 8);
        ctx.fillRect(player.position.x - bleedRadius, player.position.y - bleedRadius, bleedRadius * 2, bleedRadius * 2);
        ctx.restore();
      }
      const activeWeapon = player.weapons[player.currentWeapon]?.type || 'pistol';
      const offsets = getWeaponOffsets(activeWeapon as WeaponType);
      const fx = WEAPON_FX[activeWeapon] || WEAPON_FX.pistol;
      const emj = WEAPON_EMOJI[activeWeapon as WeaponType] || '??';
      // Restrict aim angle to horizontal only based on facing direction
      const aimAngle = player.facing > 0 ? 0 : Math.PI;
      const kickT = weaponKickMs > 0 ? weaponKickMs / 120 : 0;
      const backOffset = 6 * kickT;
      const gripX = player.radius + offsets.grip - backOffset;
      const muzzleX = player.radius + offsets.muzzle - backOffset;

      // Draw stickman sprite or fallback to circle
      ctx.save();
      ctx.translate(player.position.x, player.position.y);

      // Draw stickman sprite if loaded
      if (globalClips.ready) {
        const clip = globalClips.clips[player.animKey];
        if (clip && clip.images.length > 0) {
          // Clamp frame index to valid range
          let frameIndex = Math.floor(player.animFrame);
          frameIndex = Math.max(0, Math.min(clip.images.length - 1, frameIndex));

          const image = clip.images[frameIndex];
          if (image) {
            const scale = BASE_SPRITE_SCALE * (player.radius / DEFAULT_PLAYER_RADIUS);
            const offsetX = BASE_OFFSET_X * (player.radius / DEFAULT_PLAYER_RADIUS);
            const offsetY = BASE_OFFSET_Y * (player.radius / DEFAULT_PLAYER_RADIUS);

            const intrinsicWidth = (image as ImageBitmap).width ?? (image as HTMLImageElement).naturalWidth ?? 0;
            const intrinsicHeight = (image as ImageBitmap).height ?? (image as HTMLImageElement).naturalHeight ?? 0;
            const drawWidth = intrinsicWidth > 0 ? intrinsicWidth * scale : 0;
            const drawHeight = intrinsicHeight > 0 ? intrinsicHeight * scale : 0;

            ctx.save();
            ctx.scale(player.facing, 1);
            if (drawWidth > 0 && drawHeight > 0) {
              ctx.drawImage(image as any, -offsetX, player.radius - offsetY, drawWidth, drawHeight);
            } else {
              ctx.drawImage(image as any, -offsetX, player.radius - offsetY);
            }
            ctx.restore();
          }
        }
      } else {
        // Fallback circle body while animations load
      ctx.beginPath();
      ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
      ctx.fillStyle = bodyColor;
          ctx.shadowColor = '#ff98cb';
          ctx.shadowBlur = 12;
          ctx.fill();
      ctx.shadowBlur = 0;
      }

      ctx.save();
      ctx.rotate(aimAngle);
      // Semi-circle direction indicator
      const indicatorRadius = 38;
      const arcSpread = Math.PI * 0.3; // 30% of a circle
      const baseX = gripX - 2;
      
      // Outer glow arc
      ctx.strokeStyle = 'rgba(255,80,80,0.25)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, indicatorRadius, -arcSpread, arcSpread);
      ctx.stroke();

      // Inner brighter arc
      ctx.strokeStyle = 'rgba(255,120,120,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, indicatorRadius, -arcSpread * 0.7, arcSpread * 0.7);
      ctx.stroke();

      // muzzle glow when shooting
      if (muzzleFxMs > 0) {
        const a = Math.max(0, Math.min(1, muzzleFxMs / 110));
        ctx.globalAlpha = a;
        const coneLen = 22;
        const coneWide = 9;
        const coneStart = indicatorRadius - 2;
        const grad = ctx.createLinearGradient(coneStart, 0, coneStart + coneLen, 0);
        grad.addColorStop(0, 'rgba(255,120,90,0.35)');
        grad.addColorStop(1, 'rgba(255,120,90,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(coneStart, -coneWide * 0.5);
        ctx.lineTo(coneStart + coneLen, -coneWide);
        ctx.lineTo(coneStart + coneLen, coneWide);
        ctx.lineTo(coneStart, coneWide * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      ctx.font = "600 13px 'Rajdhani', 'Share Tech Mono', ui-monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#d3f6ff";
      // Account for 3x scaled sprite height
      const spriteHeight = STICKMAN_BOUNDS.visibleHeight * BASE_SPRITE_SCALE * (player.radius / DEFAULT_PLAYER_RADIUS);
      ctx.fillText(player.name || "YOU", 0, -spriteHeight / 2 - 105);
      const w = 70;
      const h = 6;
      const hpRatio = Math.max(0, player.hp / player.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(-w / 2, -spriteHeight / 2 - 95, w, h);
      ctx.fillStyle = "#2fd159";
      ctx.fillRect(-w / 2, -spriteHeight / 2 - 95, w * hpRatio, h);
      if (playerShield > 0) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = '#ff6666';
        ctx.lineWidth = 3;
        ctx.beginPath();
        // Shield circle should surround the visible sprite
        ctx.arc(0, 0, spriteHeight / 2 + 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (overdriveMs > 0) {
        const pulse = 0.6 + 0.4 * Math.sin(totalTimeMs * 0.02);
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.25 * pulse;
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Overdrive aura should surround the sprite
        ctx.arc(0, 0, spriteHeight / 2 + 16 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }

    // Draw remote players in multiplayer
    function drawRemotePlayers() {
      const mpState = multiplayerStateRef.current;
      if (!mpState.isMultiplayerGame) return;
      
      const currentRemotePlayers = remotePlayersRef.current;
      currentRemotePlayers.forEach((remotePlayer) => {
        // Draw shadow using interpolated render position
        drawShadow(ctx, remotePlayer.renderPosition.x, remotePlayer.renderPosition.y + player.radius, player.radius * 0.9);
        
        ctx.save();
        ctx.translate(remotePlayer.renderPosition.x, remotePlayer.renderPosition.y);
        
        // Flash effect if recently damaged (check if health is low or recently updated)
        const flashAlpha = remotePlayer.health < remotePlayer.maxHealth * 0.3 ? 0.2 : 0;
        if (flashAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = flashAlpha;
          ctx.fillStyle = '#ff0000';
          ctx.beginPath();
          ctx.arc(0, 0, player.radius + 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        
        // Draw remote player sprite (using same logic as local player)
        if (globalClips.ready) {
          const clip = globalClips.clips[remotePlayer.animKey];
          if (clip && clip.images.length > 0) {
            let frameIndex = Math.floor(remotePlayer.animFrame);
            frameIndex = Math.max(0, Math.min(clip.images.length - 1, frameIndex));
            
            const image = clip.images[frameIndex];
            if (image) {
              const scale = BASE_SPRITE_SCALE * (player.radius / DEFAULT_PLAYER_RADIUS);
              const offsetX = BASE_OFFSET_X * (player.radius / DEFAULT_PLAYER_RADIUS);
              const offsetY = BASE_OFFSET_Y * (player.radius / DEFAULT_PLAYER_RADIUS);
              
              const intrinsicWidth = (image as ImageBitmap).width ?? (image as HTMLImageElement).naturalWidth ?? 0;
              const intrinsicHeight = (image as ImageBitmap).height ?? (image as HTMLImageElement).naturalHeight ?? 0;
              const drawWidth = intrinsicWidth > 0 ? intrinsicWidth * scale : 0;
              const drawHeight = intrinsicHeight > 0 ? intrinsicHeight * scale : 0;
              
              ctx.save();
              // Use facing direction like local player (1 or -1)
              ctx.scale(remotePlayer.facingRight ? 1 : -1, 1);
              
              if (drawWidth > 0 && drawHeight > 0) {
                // Draw at same position as local player
                ctx.drawImage(image as any, -offsetX, player.radius - offsetY, drawWidth, drawHeight);
              } else {
                ctx.drawImage(image as any, -offsetX, player.radius - offsetY);
              }
              ctx.restore();
            }
          }
        }
        
        // Draw username above player (using same positioning as local player)
        ctx.font = "600 13px 'Rajdhani', 'Share Tech Mono', ui-monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffd700";
        const spriteHeight = STICKMAN_BOUNDS.visibleHeight * BASE_SPRITE_SCALE * (player.radius / DEFAULT_PLAYER_RADIUS);
        ctx.fillText(remotePlayer.username || "Player", 0, -spriteHeight / 2 - 105);
        
        // Draw health bar above username
        const w = 70;
        const h = 6;
        const hpRatio = Math.max(0, remotePlayer.health / remotePlayer.maxHealth);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(-w / 2, -spriteHeight / 2 - 95, w, h);
        ctx.fillStyle = "#ff6666";
        ctx.fillRect(-w / 2, -spriteHeight / 2 - 95, w * hpRatio, h);
        
        ctx.restore();
      });
    }
    function drawEnemies() {
      ctx.save();
      
      // ===== PERFORMANCE: Viewport Culling - inline check to avoid filter() array creation =====
      const vLeft = camera.x - 50;
      const vRight = camera.x + canvas.clientWidth + 50;
      const vTop = camera.y - 50;
      const vBottom = camera.y + canvas.clientHeight + 50;
      
      for (const e of enemies) {
        // Inline viewport check (faster than filter + new array)
        const enemyBounds = e.radius * 3;
        if (e.position.x + enemyBounds < vLeft || e.position.x - enemyBounds > vRight ||
            e.position.y + enemyBounds < vTop - enemyBounds * 2 || e.position.y - enemyBounds > vBottom) {
          continue;
        }
        drawShadow(ctx, e.position.x, e.position.y + e.radius, e.radius * 0.9);
        
        const flashA = e.flashMs ? Math.max(0, Math.min(1, e.flashMs / 120)) : 0;
        
        // Draw enemy stick figure sprite if loaded
        ctx.save();
        ctx.translate(e.position.x, e.position.y);
        
        if (globalClips.ready) {
          const clip = globalClips.clips[e.animKey];
          if (clip && clip.images.length > 0) {
            // Clamp frame index to valid range
            let frameIndex = Math.floor(e.animFrame);
            frameIndex = Math.max(0, Math.min(clip.images.length - 1, frameIndex));

            const image = clip.images[frameIndex];
            if (image) {
              const scale = BASE_SPRITE_SCALE * (e.radius / DEFAULT_PLAYER_RADIUS);
              const offsetX = BASE_OFFSET_X * (e.radius / DEFAULT_PLAYER_RADIUS);
              const offsetY = BASE_OFFSET_Y * (e.radius / DEFAULT_PLAYER_RADIUS);

              const intrinsicWidth = (image as ImageBitmap).width ?? (image as HTMLImageElement).naturalWidth ?? 0;
              const intrinsicHeight = (image as ImageBitmap).height ?? (image as HTMLImageElement).naturalHeight ?? 0;
              const drawWidth = intrinsicWidth > 0 ? intrinsicWidth * scale : 0;
              const drawHeight = intrinsicHeight > 0 ? intrinsicHeight * scale : 0;

              // Apply enemy glow and flash
        ctx.shadowColor = ENEMY_GLOW[e.aiType!] || '#9be0ff';
        ctx.shadowBlur = 16 + flashA * 20;
              
              ctx.save();
              ctx.scale(e.facing, 1);
              if (drawWidth > 0 && drawHeight > 0) {
                ctx.drawImage(image as any, -offsetX, e.radius - offsetY, drawWidth, drawHeight);
              } else {
                ctx.drawImage(image as any, -offsetX, e.radius - offsetY);
              }
              ctx.restore();
              ctx.shadowBlur = 0;
            }
          }
        } else {
          // Fallback circle while animations load
          ctx.shadowColor = ENEMY_GLOW[e.aiType!] || '#9be0ff';
          ctx.shadowBlur = 16 + flashA * 20;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fillStyle = ENEMY_GLOW[e.aiType!] || '#9be0ff';
        ctx.fill();
        ctx.shadowBlur = 0;
        }
        
        ctx.restore();
 
        // Account for 3x scaled sprite height
        const enemySpriteHeight = STICKMAN_BOUNDS.visibleHeight * BASE_SPRITE_SCALE * (e.radius / DEFAULT_PLAYER_RADIUS);
 
        ctx.font = "bold 11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#d3f6ff";
        const debugState = e.aiState ? ` [${e.aiState.toUpperCase()}]` : '';
        ctx.fillText(e.name + debugState, e.position.x, e.position.y - enemySpriteHeight / 2 - 105);
        const debugLines = e.aiData?.debugLines;
        if (debugLines && debugLines.length > 0) {
          debugLines.forEach((line, idx) => {
            ctx.fillText(line, e.position.x, e.position.y - enemySpriteHeight / 2 - 105 - 14 * (idx + 1));
          });
        }
        const w = 50; const h = 5;
        const hpRatio = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(e.position.x - w / 2, e.position.y - enemySpriteHeight / 2 - 95, w, h);
        ctx.fillStyle = "#ff4d6d";
        ctx.fillRect(e.position.x - w / 2, e.position.y - enemySpriteHeight / 2 - 95, w * hpRatio, h);
      }
      ctx.restore();
    }
    function drawCollisionBoxes() {
      if (!settingsRef.current.debug.showCollisionBoxes) return;
      
      ctx.save();
      ctx.lineWidth = 2;
      
      // Draw player hurtbox (collision box)
      const playerBox = collisionSettingsRef.current.player;
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
      ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
      const playerX = player.position.x + playerBox.offsetX;
      const playerY = player.position.y + playerBox.offsetY;
      ctx.fillRect(playerX - playerBox.width / 2, playerY - playerBox.height / 2, playerBox.width, playerBox.height);
      ctx.strokeRect(playerX - playerBox.width / 2, playerY - playerBox.height / 2, playerBox.width, playerBox.height);
      
      // Draw player hitboxes if attacking
      if (player.attackCooldown > 0 || player.animKey.includes('slash') || player.animKey.includes('jab') || 
          player.animKey.includes('kick') || player.animKey.includes('uppercut') || player.animKey.includes('salto')) {
        const attackData = MELEE_ATTACK_DATA[player.animKey];
        if (attackData) {
          const currentFrame = Math.floor(player.animFrame);
          
          for (const hitbox of attackData.hitboxes) {
            // Check if hitbox is active this frame
            if (currentFrame >= hitbox.activeFrameStart && currentFrame <= hitbox.activeFrameEnd) {
              ctx.strokeStyle = 'rgba(255, 255, 0, 0.9)';
              ctx.fillStyle = 'rgba(255, 255, 0, 0.2)';
              
              if (hitbox.shape === 'circle') {
                const centerX = player.position.x + (hitbox.offsetX || 0) * player.facing;
                const centerY = player.position.y + (hitbox.offsetY || 0);
                const radius = hitbox.radius || 40;
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
              } else if (hitbox.shape === 'rectangle') {
                const rectX = player.position.x + (hitbox.offsetX || 0) * player.facing;
                const rectY = player.position.y + (hitbox.offsetY || 0);
                const rectWidth = hitbox.width || 40;
                const rectHeight = hitbox.height || 30;
                
                ctx.fillRect(rectX - rectWidth / 2, rectY - rectHeight / 2, rectWidth, rectHeight);
                ctx.strokeRect(rectX - rectWidth / 2, rectY - rectHeight / 2, rectWidth, rectHeight);
              } else if (hitbox.shape === 'arc') {
                const centerX = player.position.x + (hitbox.offsetX || 0) * player.facing;
                const centerY = player.position.y + (hitbox.offsetY || 0);
                const arcRadius = hitbox.arcRadius || 60;
                const startAngle = hitbox.arcStartAngle || 0;
                const endAngle = hitbox.arcEndAngle || Math.PI / 2;
                
                // Draw arc - when facing left, mirror the angles
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                if (player.facing > 0) {
                  // Facing right
                  ctx.arc(centerX, centerY, arcRadius, startAngle, endAngle);
                } else {
                  // Facing left - mirror around vertical axis
                  ctx.arc(centerX, centerY, arcRadius, Math.PI - endAngle, Math.PI - startAngle);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
              }
            }
          }
        }
      }
      
      // Draw enemy hurtboxes
      const enemyBox = collisionSettingsRef.current.enemy;
      ctx.strokeStyle = 'rgba(255, 100, 0, 0.8)';
      ctx.fillStyle = 'rgba(255, 100, 0, 0.1)';
      for (const e of enemies) {
        const enemyX = e.position.x + enemyBox.offsetX;
        const enemyY = e.position.y + enemyBox.offsetY;
        ctx.fillRect(enemyX - enemyBox.width / 2, enemyY - enemyBox.height / 2, enemyBox.width, enemyBox.height);
        ctx.strokeRect(enemyX - enemyBox.width / 2, enemyY - enemyBox.height / 2, enemyBox.width, enemyBox.height);
        
        // Draw enemy hitboxes if attacking
        if (e.attackCooldown > 0 || e.animKey.includes('slash') || e.animKey.includes('jab') || 
            e.animKey.includes('kick') || e.animKey.includes('uppercut') || e.animKey.includes('salto')) {
          const attackData = MELEE_ATTACK_DATA[e.animKey];
          if (attackData) {
            const currentFrame = Math.floor(e.animFrame);
            
            for (const hitbox of attackData.hitboxes) {
              if (currentFrame >= hitbox.activeFrameStart && currentFrame <= hitbox.activeFrameEnd) {
                ctx.strokeStyle = 'rgba(255, 150, 0, 0.9)';
                ctx.fillStyle = 'rgba(255, 150, 0, 0.2)';
                
                if (hitbox.shape === 'circle') {
                  const centerX = e.position.x + (hitbox.offsetX || 0) * e.facing;
                  const centerY = e.position.y + (hitbox.offsetY || 0);
                  const radius = hitbox.radius || 40;
                  ctx.beginPath();
                  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.stroke();
                } else if (hitbox.shape === 'rectangle') {
                  const rectX = e.position.x + (hitbox.offsetX || 0) * e.facing;
                  const rectY = e.position.y + (hitbox.offsetY || 0);
                  const rectWidth = hitbox.width || 40;
                  const rectHeight = hitbox.height || 30;
                  
                  ctx.fillRect(rectX - rectWidth / 2, rectY - rectHeight / 2, rectWidth, rectHeight);
                  ctx.strokeRect(rectX - rectWidth / 2, rectY - rectHeight / 2, rectWidth, rectHeight);
                } else if (hitbox.shape === 'arc') {
                  const centerX = e.position.x + (hitbox.offsetX || 0) * e.facing;
                  const centerY = e.position.y + (hitbox.offsetY || 0);
                  const arcRadius = hitbox.arcRadius || 60;
                  const startAngle = hitbox.arcStartAngle || 0;
                  const endAngle = hitbox.arcEndAngle || Math.PI / 2;
                  
                  // Draw arc - when facing left, mirror the angles
                  ctx.beginPath();
                  ctx.moveTo(centerX, centerY);
                  if (e.facing > 0) {
                    // Facing right
                    ctx.arc(centerX, centerY, arcRadius, startAngle, endAngle);
                  } else {
                    // Facing left - mirror around vertical axis
                    ctx.arc(centerX, centerY, arcRadius, Math.PI - endAngle, Math.PI - startAngle);
                  }
                  ctx.closePath();
                  ctx.fill();
                  ctx.stroke();
                }
              }
            }
          }
        }
      }
      
      ctx.restore();
    }
    function drawBullets() {
      ctx.save();
      
      // ===== PERFORMANCE: Viewport Culling - inline check to avoid filter() array creation =====
      const vLeft = camera.x - 100;
      const vRight = camera.x + canvas.clientWidth + 100;
      const vTop = camera.y - 100;
      const vBottom = camera.y + canvas.clientHeight + 100;
      
      for (const b of bullets) {
        // Inline viewport check
        if (b.position.x < vLeft - 30 || b.position.x > vRight + 30 ||
            b.position.y < vTop - 30 || b.position.y > vBottom + 30) {
          continue;
        }
        const x = b.position.x;
        const y = b.position.y;
        const angle = Math.atan2(b.velocity.y, b.velocity.x);
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        
        switch (b.type) {
          case 'pistol':
          case 'rifle':
          case 'minigun':
            // Classic bullet - yellow/gold with black tip
            const bulletSize = b.type === 'minigun' ? 6 : b.type === 'rifle' ? 8 : 7;
            const bulletLength = b.type === 'minigun' ? 10 : b.type === 'rifle' ? 14 : 12;
            // Glow
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#ffaa00';
            // Bullet casing (gold)
            ctx.fillStyle = '#ffaa00';
            ctx.fillRect(-bulletLength/2, -bulletSize/2, bulletLength * 0.7, bulletSize);
            // Bullet tip (dark)
            ctx.fillStyle = '#444';
            ctx.beginPath();
            ctx.moveTo(bulletLength/2 - bulletLength * 0.3, 0);
            ctx.lineTo(bulletLength/2, -bulletSize/2);
            ctx.lineTo(bulletLength/2, bulletSize/2);
            ctx.closePath();
            ctx.fill();
            break;
            
          case 'shotgun':
            // Shotgun pellets - small orange spheres
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ff6600';
            const grad1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 5);
            grad1.addColorStop(0, '#ffaa44');
            grad1.addColorStop(1, '#ff6600');
            ctx.fillStyle = grad1;
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();
            break;
            
          case 'rocket':
            // Rocket - red with flame trail
            ctx.shadowBlur = 16;
            ctx.shadowColor = '#ff0000';
            // Rocket body
            ctx.fillStyle = '#cc0000';
            ctx.fillRect(-12, -4, 20, 8);
            // Rocket nose
            ctx.fillStyle = '#ff3333';
            ctx.beginPath();
            ctx.moveTo(8, 0);
            ctx.lineTo(12, -4);
            ctx.lineTo(12, 4);
            ctx.closePath();
            ctx.fill();
            // Flame exhaust
            const flameGrad = ctx.createLinearGradient(-12, 0, -20, 0);
            flameGrad.addColorStop(0, 'rgba(255, 200, 0, 0.9)');
            flameGrad.addColorStop(0.5, 'rgba(255, 100, 0, 0.6)');
            flameGrad.addColorStop(1, 'rgba(255, 0, 0, 0)');
            ctx.fillStyle = flameGrad;
            ctx.fillRect(-20, -6, 8, 12);
            break;
            
          case 'grenade':
          case 'bomb':
            // Grenade - dark green sphere with highlight
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#00ff00';
            const grenadeGrad = ctx.createRadialGradient(-2, -2, 0, 0, 0, 9);
            grenadeGrad.addColorStop(0, '#88ff88');
            grenadeGrad.addColorStop(0.4, '#44aa44');
            grenadeGrad.addColorStop(1, '#226622');
            ctx.fillStyle = grenadeGrad;
            ctx.beginPath();
            ctx.arc(0, 0, 9, 0, Math.PI * 2);
            ctx.fill();
            // Fuse indicator
            ctx.fillStyle = '#ff3333';
            ctx.fillRect(-2, -10, 4, 4);
            break;
            
          case 'flame':
            // Flame particle - orange/red fireball
            const flameSize = 8 + Math.random() * 4;
            ctx.shadowBlur = 16;
            ctx.shadowColor = '#ff6600';
            const flameParticleGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, flameSize);
            flameParticleGrad.addColorStop(0, '#ffff88');
            flameParticleGrad.addColorStop(0.3, '#ffaa00');
            flameParticleGrad.addColorStop(0.7, '#ff6600');
            flameParticleGrad.addColorStop(1, 'rgba(255, 0, 0, 0)');
            ctx.fillStyle = flameParticleGrad;
            ctx.beginPath();
            ctx.arc(0, 0, flameSize, 0, Math.PI * 2);
            ctx.fill();
            break;
            
          case 'ice':
            // Ice shard - cyan/blue crystalline
            ctx.shadowBlur = 14;
            ctx.shadowColor = '#00ffff';
            const iceGrad = ctx.createLinearGradient(-8, 0, 8, 0);
            iceGrad.addColorStop(0, '#aaffff');
            iceGrad.addColorStop(0.5, '#00ffff');
            iceGrad.addColorStop(1, '#0088ff');
            ctx.fillStyle = iceGrad;
            ctx.beginPath();
            ctx.moveTo(10, 0);
            ctx.lineTo(-8, -6);
            ctx.lineTo(-6, 0);
            ctx.lineTo(-8, 6);
            ctx.closePath();
            ctx.fill();
            // Inner highlight
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.beginPath();
            ctx.moveTo(6, 0);
            ctx.lineTo(-4, -3);
            ctx.lineTo(-3, 0);
            ctx.lineTo(-4, 3);
            ctx.closePath();
            ctx.fill();
            break;
            
          case 'laser':
            // Laser beam - red glowing bolt
            ctx.shadowBlur = 18;
            ctx.shadowColor = '#ff0000';
            // Outer glow
            const laserOuterGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 8);
            laserOuterGrad.addColorStop(0, 'rgba(255, 100, 100, 0.8)');
            laserOuterGrad.addColorStop(1, 'rgba(255, 0, 0, 0)');
            ctx.fillStyle = laserOuterGrad;
            ctx.beginPath();
            ctx.arc(0, 0, 8, 0, Math.PI * 2);
            ctx.fill();
            // Core beam
            const laserCoreGrad = ctx.createLinearGradient(-10, 0, 10, 0);
            laserCoreGrad.addColorStop(0, '#ff8888');
            laserCoreGrad.addColorStop(0.5, '#ff0000');
            laserCoreGrad.addColorStop(1, '#ff8888');
            ctx.fillStyle = laserCoreGrad;
            ctx.fillRect(-10, -3, 20, 6);
            // Bright core
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-6, -1, 12, 2);
            break;
            
          case 'plasma':
            // Plasma ball - purple/pink energy sphere
            ctx.shadowBlur = 16;
            ctx.shadowColor = '#ff00ff';
            const plasmaGrad = ctx.createRadialGradient(-2, -2, 0, 0, 0, 10);
            plasmaGrad.addColorStop(0, '#ffffff');
            plasmaGrad.addColorStop(0.2, '#ff88ff');
            plasmaGrad.addColorStop(0.6, '#aa00ff');
            plasmaGrad.addColorStop(1, 'rgba(128, 0, 255, 0)');
            ctx.fillStyle = plasmaGrad;
            ctx.beginPath();
            ctx.arc(0, 0, 10, 0, Math.PI * 2);
            ctx.fill();
            // Energy crackle
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(0, 0, 6, 0, Math.PI * 2);
            ctx.stroke();
            break;
            
          case 'bow':
          case 'crossbow':
          case 'spear':
            // Arrow/spear - brown shaft with silver tip
            const arrowLength = b.type === 'spear' ? 24 : 20;
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#ffffff';
            // Shaft
            ctx.fillStyle = b.type === 'spear' ? '#888888' : '#8B4513';
            ctx.fillRect(-arrowLength/2, -2, arrowLength * 0.8, 4);
            // Arrowhead
            ctx.fillStyle = '#c0c0c0';
            ctx.beginPath();
            ctx.moveTo(arrowLength/2 - arrowLength * 0.2, 0);
            ctx.lineTo(arrowLength/2, -4);
            ctx.lineTo(arrowLength/2, 4);
            ctx.closePath();
            ctx.fill();
            // Fletching
            ctx.fillStyle = '#ff4444';
            ctx.beginPath();
            ctx.moveTo(-arrowLength/2, 0);
            ctx.lineTo(-arrowLength/2 + 6, -4);
            ctx.lineTo(-arrowLength/2 + 6, 4);
            ctx.closePath();
            ctx.fill();
            break;
          case 'boomerang':
            // Boomerang - rotating curved shape
            const boomerangAngle = (Date.now() * 0.02) % (Math.PI * 2);
            ctx.rotate(boomerangAngle);
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#ffaa00';
            ctx.fillStyle = '#ffaa00';
            ctx.beginPath();
            ctx.arc(0, -8, 8, 0, Math.PI);
            ctx.arc(0, 8, 8, Math.PI, Math.PI * 2);
            ctx.fill();
            // Highlight
            ctx.fillStyle = '#ffdd88';
            ctx.fillRect(-2, -8, 4, 16);
            break;
            
          case 'wand':
            // Magic projectile - sparkly star
            ctx.shadowBlur = 18;
            ctx.shadowColor = '#ffff00';
            const starGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
            starGrad.addColorStop(0, '#ffffff');
            starGrad.addColorStop(0.4, '#ffff88');
            starGrad.addColorStop(0.7, '#ff88ff');
            starGrad.addColorStop(1, 'rgba(255, 100, 255, 0)');
            ctx.fillStyle = starGrad;
            // Draw star shape
            for (let i = 0; i < 5; i++) {
              const ang = (i * Math.PI * 2 / 5) - Math.PI / 2;
              const r = i % 2 === 0 ? 10 : 4;
              const px = Math.cos(ang) * r;
              const py = Math.sin(ang) * r;
              if (i === 0) ctx.beginPath();
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            break;
            
          case 'axe':
          case 'chainsaw':
            // Spinning blade
            const bladeAngle = (Date.now() * 0.03) % (Math.PI * 2);
            ctx.rotate(bladeAngle);
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ff0000';
            // Blade
            ctx.fillStyle = '#c0c0c0';
            ctx.fillRect(-12, -3, 24, 6);
            ctx.fillRect(-3, -12, 6, 24);
            // Handle/center
            ctx.fillStyle = '#8B4513';
            ctx.beginPath();
            ctx.arc(0, 0, 4, 0, Math.PI * 2);
            ctx.fill();
            // Blade edge highlights
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-12, -1);
            ctx.lineTo(12, -1);
            ctx.moveTo(-1, -12);
            ctx.lineTo(-1, 12);
            ctx.stroke();
            break;
            
          case 'railgun':
            // Railgun spike - cyan energy bolt
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#00ffff';
            const railGrad = ctx.createLinearGradient(-12, 0, 12, 0);
            railGrad.addColorStop(0, 'rgba(0, 255, 255, 0)');
            railGrad.addColorStop(0.3, '#00ffff');
            railGrad.addColorStop(0.7, '#ffffff');
            railGrad.addColorStop(1, '#00ffff');
            ctx.fillStyle = railGrad;
            ctx.fillRect(-12, -4, 24, 8);
            // Core
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-8, -2, 16, 4);
            break;
            
          case 'cluster':
            // Cluster bomb - dark with glowing veins
            ctx.shadowBlur = 14;
            ctx.shadowColor = '#ff9900';
            const clusterGrad = ctx.createRadialGradient(-2, -2, 0, 0, 0, 10);
            clusterGrad.addColorStop(0, '#ffaa44');
            clusterGrad.addColorStop(0.5, '#ff6600');
            clusterGrad.addColorStop(1, '#331100');
            ctx.fillStyle = clusterGrad;
            ctx.beginPath();
            ctx.arc(0, 0, 10, 0, Math.PI * 2);
            ctx.fill();
            // Glowing segments
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2;
            for (let i = 0; i < 4; i++) {
              const ang = (i / 4) * Math.PI * 2;
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(Math.cos(ang) * 8, Math.sin(ang) * 8);
              ctx.stroke();
            }
            break;
            
          case 'enemy_bullet':
          default:
            // Default enemy bullet - red glowing orb
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#ff0000';
            const defaultGrad = ctx.createRadialGradient(-2, -2, 0, 0, 0, 8);
            defaultGrad.addColorStop(0, '#ffaaaa');
            defaultGrad.addColorStop(0.5, '#ff4444');
            defaultGrad.addColorStop(1, '#aa0000');
            ctx.fillStyle = defaultGrad;
            ctx.beginPath();
            ctx.arc(0, 0, 8, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        
        ctx.restore();
      }
      ctx.restore();
    }
    function drawWeaponFX() {
      ctx.save();
      // Rail beams are in world coordinates; apply camera transform
      ctx.translate(-camera.x, -camera.y);
      ctx.lineCap = "round";
      
      // ===== PERFORMANCE: Viewport culling for rail beams =====
      const vLeft = camera.x - 100;
      const vRight = camera.x + canvas.clientWidth + 100;
      const vTop = camera.y - 100;
      const vBottom = camera.y + canvas.clientHeight + 100;
      
      for (let i = railBeams.length - 1; i >= 0; i--) {
        const rb = railBeams[i];
        rb.lifeMs -= 16;
        
        // Skip if beam is completely off-screen
        const minX = Math.min(rb.x1, rb.x2);
        const maxX = Math.max(rb.x1, rb.x2);
        const minY = Math.min(rb.y1, rb.y2);
        const maxY = Math.max(rb.y1, rb.y2);
        
        if (maxX < vLeft || minX > vRight || maxY < vTop || minY > vBottom) {
          if (rb.lifeMs <= 0) railBeams.splice(i, 1);
          continue;
        }
        
        const t = Math.max(0, rb.lifeMs / 120);
        // Outer glow
        ctx.strokeStyle = `rgba(155, 224, 255, ${t * 0.35})`;
        ctx.lineWidth = 12 * t + 2;
        ctx.beginPath();
        ctx.moveTo(rb.x1, rb.y1);
        ctx.lineTo(rb.x2, rb.y2);
        ctx.stroke();
        // Core beam
        ctx.strokeStyle = `rgba(200, 245, 255, ${t})`;
        ctx.lineWidth = 4 * t + 1;
        ctx.beginPath();
        ctx.moveTo(rb.x1, rb.y1);
        ctx.lineTo(rb.x2, rb.y2);
        ctx.stroke();
        if (rb.lifeMs <= 0) railBeams.splice(i, 1);
      }
      ctx.restore();
      ctx.save();
      // Shockwaves are also world-space; apply camera
      // ===== PERFORMANCE: Viewport culling for shockwaves =====
      ctx.translate(-camera.x, -camera.y);
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i];
        sw.lifeMs -= 16;
        sw.r += 14;
        
        // Skip if shockwave is completely off-screen
        if (sw.x + sw.r < vLeft || sw.x - sw.r > vRight ||
            sw.y + sw.r < vTop || sw.y - sw.r > vBottom) {
          if (sw.lifeMs <= 0) shockwaves.splice(i, 1);
          continue;
        }
        
        const a = Math.max(0, sw.lifeMs / 350);
        ctx.globalAlpha = a;
        ctx.strokeStyle = sw.color;
        ctx.lineWidth = sw.thickness * a;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
        ctx.stroke();
        if (sw.lifeMs <= 0) shockwaves.splice(i, 1);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    function drawParticles() {
      ctx.save();
      
      // ===== PERFORMANCE: Viewport Culling - inline check to avoid filter() array creation =====
      const vLeft = camera.x - 50;
      const vRight = camera.x + canvas.clientWidth + 50;
      const vTop = camera.y - 50;
      const vBottom = camera.y + canvas.clientHeight + 50;
      
      for (const p of particles) {
        // Inline viewport check
        if (p.position.x < vLeft - p.size || p.position.x > vRight + p.size ||
            p.position.y < vTop - p.size || p.position.y > vBottom + p.size) {
          continue;
        }
        const alpha = Math.max(0, Math.min(1, p.lifeMs * p.fade));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.position.x, p.position.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    function drawHUD() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const showHelp = !!helpRef.current;
      const wheelOpen = !!wheel.open;
      const cx = input.mouse.x - camera.x;
      const cy = input.mouse.y - camera.y;
      ctx.strokeStyle = 'rgba(255,0,0,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
      ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
      ctx.stroke();
      // Crosshair center dot
      ctx.fillStyle = 'rgba(255,0,0,0.6)';
      ctx.fillRect(cx - 1, cy - 1, 2, 2);
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const drawRoundedRect = (x: number, y: number, width: number, height: number, radius = 8) => {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      };

      // Bottom action tiles HUD (hidden during weapon wheel)
      if (wheelOpen) { ctx.restore(); return; }
      const centerX = w / 2;

      // ========== MODERN WEAPON HUD REDESIGN ==========
      // Context-sensitive, minimal, AAA-style weapon display

      const hudBottomPad = 18;
      const hudGap = 8;

      const modes: { key: string; type: 'unarmed' | 'pistol' | 'sword'; label: string; icon: string }[] = [
        { key: '1', type: 'unarmed', label: 'MELEE', icon: '👊' },
        { key: '2', type: 'pistol', label: 'WEAPONS', icon: '🔫' },
        { key: '3', type: 'sword', label: 'SWORD', icon: '⚔️' },
      ];

      const bubbleHeight = 42;
      const bubbleWidth = 120;
      const bubbleGap = 10;

      const labelFontFamily = "'Rajdhani', ui-monospace";
      const keyFont = "700 11px 'Rajdhani', ui-monospace";

      const meleeButtonSize = 52;
      const meleePanelPadX = 20;
      const meleePanelPadY = 34;
      const meleeLabelHeight = 18;
      const keyChipHeight = 16;
      const keyChipGap = 6;
      const meleeActions: { key: string; label: string; icon: string; inputFlag: keyof typeof input }[] = [
        { key: 'Z', label: 'JAB', icon: '🥊', inputFlag: 'jab' },
        { key: 'X', label: 'HIGH', icon: '🦶', inputFlag: 'kickHigh' },
        { key: 'C', label: 'KICK', icon: '💥', inputFlag: 'kickLow' },
        { key: 'V', label: 'LOW', icon: '↘️', inputFlag: 'reverseKick' },
        { key: 'Q', label: 'UPPER', icon: '⬆️', inputFlag: 'uppercut' },
        { key: 'E', label: 'SALTO', icon: '🌀', inputFlag: 'saltoKick' },
      ];
      const actionsWidth = meleeActions.length * (meleeButtonSize + hudGap) - hudGap;
      const meleePanelWidth = actionsWidth + meleePanelPadX * 2;
      const meleePanelHeight = meleeButtonSize + meleePanelPadY + keyChipHeight + keyChipGap;

      const weaponPanelWidth = 300;
      const weaponPanelHeight = 116;

      const hasMeleePanel = player.animWeapon === 'unarmed' || player.animWeapon === 'sword';
      const hasWeaponPanel = player.animWeapon === 'pistol';
      const activeBottomPanelHeight = hasWeaponPanel ? weaponPanelHeight : hasMeleePanel ? meleePanelHeight : 0;
      const activeBottomPanelWidth = hasWeaponPanel ? weaponPanelWidth : hasMeleePanel ? meleePanelWidth : 320;

      const modeRowWidth = modes.length * bubbleWidth + (modes.length - 1) * bubbleGap;
      // Position everything from bottom edge up - touching the bottom
      const bottomPanelTopY = h - activeBottomPanelHeight;
      const modeRowY = h - activeBottomPanelHeight - bubbleHeight - (activeBottomPanelHeight > 0 ? 8 : 16);
      const modeRowX = centerX - modeRowWidth / 2;

      ctx.save();

      for (let i = 0; i < modes.length; i++) {
        const mode = modes[i];
        const x = modeRowX + i * (bubbleWidth + bubbleGap);
        const y = modeRowY;
        const isActive = player.animWeapon === mode.type;

        const currentWeaponType = player.weapons[player.currentWeapon]?.type || 'pistol';
        const highlightColor = mode.type === 'pistol' ? (WEAPON_COLOR[currentWeaponType] || HUD_MONO_THEME.accent) : HUD_MONO_THEME.accent;

        const bgGrad = ctx.createLinearGradient(x, y, x, y + bubbleHeight);
        if (isActive) {
          bgGrad.addColorStop(0, 'rgba(74,74,74,0.96)');
          bgGrad.addColorStop(1, 'rgba(16,16,16,0.92)');
        } else {
          bgGrad.addColorStop(0, 'rgba(36,36,36,0.88)');
          bgGrad.addColorStop(1, 'rgba(14,14,14,0.9)');
        }
        ctx.fillStyle = bgGrad;
        drawRoundedRect(x, y, bubbleWidth, bubbleHeight, 14);
        ctx.fill();

        ctx.strokeStyle = isActive ? highlightColor : 'rgba(120,120,120,0.45)';
        ctx.lineWidth = isActive ? 2 : 1.1;
        if (isActive) {
          ctx.shadowColor = HUD_MONO_THEME.glow;
          ctx.shadowBlur = 14;
        }
        drawRoundedRect(x, y, bubbleWidth, bubbleHeight, 14);
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = isActive ? highlightColor + '44' : 'rgba(255,255,255,0.08)';
        drawRoundedRect(x + 10, y + 6, bubbleWidth - 20, 2.5, 2);
        ctx.fill();

        ctx.save();
        ctx.globalAlpha = isActive ? 0.36 : 0.2;
        const highlightGrad = ctx.createLinearGradient(x, y, x, y + bubbleHeight);
        highlightGrad.addColorStop(0, 'rgba(255,255,255,0.75)');
        highlightGrad.addColorStop(0.45, 'rgba(255,255,255,0.28)');
        highlightGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = highlightGrad;
        drawRoundedRect(x + 8, y + 5, bubbleWidth - 16, (bubbleHeight - 10) * 0.55, 10);
        ctx.fill();
        ctx.restore();

        if (activeBottomPanelHeight > 0) {
          const connectorHeight = bottomPanelTopY - (y + bubbleHeight);
          if (connectorHeight > 4) {
            const connectorX = x + bubbleWidth / 2 - 3;
            const connectorGrad = ctx.createLinearGradient(connectorX, y + bubbleHeight, connectorX, bottomPanelTopY);
            connectorGrad.addColorStop(0, highlightColor + '55');
            connectorGrad.addColorStop(1, 'rgba(18,18,18,0)');
            ctx.fillStyle = connectorGrad;
            drawRoundedRect(connectorX, y + bubbleHeight - 2, 6, connectorHeight + 4, 3);
            ctx.fill();
          }
        }

        const iconCenterX = x + 28;
        const iconCenterY = y + bubbleHeight / 2;
        ctx.fillStyle = isActive ? highlightColor + '2c' : 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.arc(iconCenterX, iconCenterY, 19, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isActive ? highlightColor : 'rgba(200,200,200,0.18)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.textBaseline = 'middle';
        ctx.font = "26px 'Segoe UI Emoji'";
        ctx.fillStyle = isActive ? HUD_MONO_THEME.foreground : HUD_MONO_THEME.accentMuted;
        ctx.textAlign = 'center';
        ctx.fillText(mode.icon, iconCenterX, iconCenterY - 1);

        const textAreaLeft = x + 62;
        const textAreaRight = x + bubbleWidth - 14;
        const textAreaWidth = textAreaRight - textAreaLeft;

        let labelFontSize = 17;
        ctx.textAlign = 'left';
        ctx.fillStyle = isActive ? highlightColor : HUD_MONO_THEME.captionMuted;
        let labelFont = `800 ${labelFontSize}px ${labelFontFamily}`;
        ctx.font = labelFont;
        while (ctx.measureText(mode.label).width > textAreaWidth && labelFontSize > 12) {
          labelFontSize -= 1;
          labelFont = `800 ${labelFontSize}px ${labelFontFamily}`;
          ctx.font = labelFont;
        }
        const labelY = y + bubbleHeight / 2 - 8;
        ctx.fillText(mode.label, textAreaLeft, labelY);

        const chipHeight = 16;
        const chipPaddingX = 12;
        ctx.font = keyFont;
        const keyChipText = `[${mode.key}]`;
        const keyTextWidth = ctx.measureText(keyChipText).width;
        const chipWidth = Math.min(textAreaWidth, keyTextWidth + chipPaddingX * 2);
        const chipX = textAreaLeft;
        const chipY = y + bubbleHeight / 2 + 4;
        ctx.fillStyle = isActive ? highlightColor + '24' : 'rgba(255,255,255,0.06)';
        drawRoundedRect(chipX, chipY, chipWidth, chipHeight, 7);
        ctx.fill();
        const chipOutlineGrad = ctx.createLinearGradient(chipX, chipY, chipX, chipY + chipHeight);
        if (isActive) {
          chipOutlineGrad.addColorStop(0, highlightColor + '88');
          chipOutlineGrad.addColorStop(1, highlightColor + '33');
        } else {
          chipOutlineGrad.addColorStop(0, 'rgba(255,255,255,0.18)');
          chipOutlineGrad.addColorStop(1, 'rgba(255,255,255,0.05)');
        }
        ctx.strokeStyle = chipOutlineGrad;
        ctx.lineWidth = 0.9;
        drawRoundedRect(chipX, chipY, chipWidth, chipHeight, 7);
        ctx.stroke();
        ctx.fillStyle = isActive ? highlightColor : HUD_MONO_THEME.caption;
        ctx.textAlign = 'center';
        ctx.fillText(keyChipText, chipX + chipWidth / 2, chipY + chipHeight / 2 + 0.5);
      }
      ctx.restore();
      
      // ========== CONTEXT-SENSITIVE: MELEE ACTIONS (only in melee/sword mode) ==========
      if (hasMeleePanel) {
        const panelWidth = meleePanelWidth;
        const panelHeight = meleePanelHeight;
        const panelX = centerX - panelWidth / 2;
        const panelY = bottomPanelTopY;

        // Panel backdrop with retro arcade vibes
        ctx.save();
        const panelGrad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelHeight);
        panelGrad.addColorStop(0, HUD_MONO_THEME.panelTop);
        panelGrad.addColorStop(1, HUD_MONO_THEME.panelBottom);
        ctx.fillStyle = panelGrad;
        drawRoundedRect(panelX, panelY, panelWidth, panelHeight, 16);
      ctx.fill();
        ctx.strokeStyle = HUD_MONO_THEME.borderStrong;
          ctx.lineWidth = 2;
        ctx.shadowColor = HUD_MONO_THEME.glow;
        ctx.shadowBlur = 18;
        drawRoundedRect(panelX, panelY, panelWidth, panelHeight, 16);
      ctx.stroke();
        ctx.shadowBlur = 0;

        // Panel top label
        const labelText = player.animWeapon === 'sword' ? 'SWORD COMBOS' : 'MELEE COMBOS';
        ctx.font = "900 14px 'Press Start 2P', monospace";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = HUD_MONO_THEME.caption;
        ctx.fillText(labelText, panelX + 20, panelY + 12);

        // Decorative underline
        ctx.fillStyle = HUD_MONO_THEME.borderSoft;
        ctx.fillRect(panelX + 20, panelY + 28, 120, 2);
      
        for (let i = 0; i < meleeActions.length; i++) {
        const a = meleeActions[i];
          const x = panelX + meleePanelPadX + i * (meleeButtonSize + hudGap);
          const y = panelY + meleeLabelHeight + 10;
        const isActive = input[a.inputFlag] === true;
        
          // Button layers for extra depth
          const baseGrad = ctx.createLinearGradient(x, y, x, y + meleeButtonSize);
        if (isActive) {
            baseGrad.addColorStop(0, 'rgba(70, 70, 70, 0.65)');
            baseGrad.addColorStop(1, 'rgba(20, 20, 20, 0.85)');
        } else {
            baseGrad.addColorStop(0, 'rgba(30, 30, 30, 0.85)');
            baseGrad.addColorStop(1, 'rgba(14, 14, 14, 0.92)');
        }
          ctx.fillStyle = baseGrad;
          drawRoundedRect(x, y, meleeButtonSize, meleeButtonSize, 10);
        ctx.fill();

          // Outer border with neon pulse
          ctx.strokeStyle = isActive ? HUD_MONO_THEME.borderStrong : 'rgba(80, 80, 80, 0.7)';
          ctx.lineWidth = isActive ? 3 : 2;
          if (isActive) {
            ctx.shadowColor = HUD_MONO_THEME.glow;
            ctx.shadowBlur = 20;
          }
          drawRoundedRect(x, y, meleeButtonSize, meleeButtonSize, 10);
        ctx.stroke();
        ctx.shadowBlur = 0;

          // Inner border for depth
          ctx.strokeStyle = isActive ? 'rgba(255,255,255,0.6)' : 'rgba(180,180,180,0.25)';
          ctx.lineWidth = 1.5;
          drawRoundedRect(x + 6, y + 6, meleeButtonSize - 12, meleeButtonSize - 12, 8);
          ctx.stroke();
        
          // Icon + label
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
          ctx.font = `28px 'Segoe UI Emoji'`;
          ctx.fillStyle = isActive ? HUD_MONO_THEME.foreground : HUD_MONO_THEME.foregroundMuted;
          ctx.fillText(a.icon, x + meleeButtonSize / 2, y + meleeButtonSize / 2 - 6);

          ctx.font = "800 14px 'Rajdhani', ui-monospace";
          ctx.fillStyle = isActive ? HUD_MONO_THEME.foreground : HUD_MONO_THEME.captionMuted;
          ctx.fillText(a.label, x + meleeButtonSize / 2, y + meleeButtonSize / 2 + 20);

          // Key chip
          const keyChipY = y + meleeButtonSize + 8;
          ctx.fillStyle = HUD_MONO_THEME.chipFill;
          drawRoundedRect(x + 10, keyChipY, meleeButtonSize - 20, 18, 6);
          ctx.fill();
          ctx.strokeStyle = HUD_MONO_THEME.chipStroke;
          ctx.lineWidth = 1;
          drawRoundedRect(x + 10, keyChipY, meleeButtonSize - 20, 18, 6);
          ctx.stroke();
          ctx.font = "700 11px 'Rajdhani', ui-monospace";
          ctx.fillStyle = HUD_MONO_THEME.caption;
          ctx.textBaseline = 'middle';
          ctx.fillText(`[${a.key}]`, x + meleeButtonSize / 2, keyChipY + 9);
        }

        ctx.restore();
      }
      // ========== CENTER BOTTOM: WEAPON & AMMO DISPLAY (Gun mode only) ==========
      if (player.animWeapon === 'pistol') {
        const weaponPanelX = centerX - weaponPanelWidth / 2;
        const weaponPanelY = bottomPanelTopY;

        const currentWeaponType = player.weapons[player.currentWeapon]?.type || 'pistol';
        const weaponName = currentWeaponType.toUpperCase();
        const hl = WEAPON_COLOR[currentWeaponType] || HUD_MONO_THEME.accent;
        const ammoPercent = Math.max(0, Math.min(1, player.ammo / player.maxAmmo));
        const isLowAmmo = ammoPercent < 0.25;

        ctx.save();

        // Panel background (echo the melee panel aesthetic)
        const panelGrad = ctx.createLinearGradient(weaponPanelX, weaponPanelY, weaponPanelX, weaponPanelY + weaponPanelHeight);
        panelGrad.addColorStop(0, HUD_MONO_THEME.panelTop);
        panelGrad.addColorStop(1, HUD_MONO_THEME.panelBottom);
        ctx.fillStyle = panelGrad;
        drawRoundedRect(weaponPanelX, weaponPanelY, weaponPanelWidth, weaponPanelHeight, 18);
        ctx.fill();

        ctx.strokeStyle = `${hl}55`;
        ctx.lineWidth = 2;
        ctx.shadowColor = `${hl}88`;
        ctx.shadowBlur = 22;
        drawRoundedRect(weaponPanelX, weaponPanelY, weaponPanelWidth, weaponPanelHeight, 18);
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        // Header label
        ctx.font = "900 16px 'Press Start 2P', monospace";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = hl;
        ctx.fillText('WEAPON SYSTEM', weaponPanelX + 28, weaponPanelY + 16);
        ctx.fillStyle = `${hl}66`;
        ctx.fillRect(weaponPanelX + 28, weaponPanelY + 34, 140, 2);

        // Weapon emoji badge (top-right) with glow
        const weaponEmoji = currentWeaponType === 'rocket' ? '🚀' :
                            currentWeaponType === 'shotgun' ? '🔫' :
                            currentWeaponType === 'railgun' ? '⚡' :
                            currentWeaponType === 'flame' ? '🔥' :
                            currentWeaponType === 'ice' ? '❄️' :
                            currentWeaponType === 'laser' ? '🔴' :
                            currentWeaponType === 'grenade' ? '💣' :
                            currentWeaponType === 'bow' ? '🏹' :
                            '🔫';
        ctx.font = "42px 'Segoe UI Emoji'";
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.shadowColor = `${hl}aa`;
        ctx.shadowBlur = 18;
        ctx.fillStyle = HUD_MONO_THEME.foreground;
        ctx.fillText(weaponEmoji, weaponPanelX + weaponPanelWidth - 28, weaponPanelY + 14);
        ctx.shadowBlur = 0;

        // Weapon name badge in center
        ctx.font = "900 24px 'Rajdhani', ui-monospace";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = HUD_MONO_THEME.foreground;
        ctx.fillText(weaponName, centerX, weaponPanelY + 56);

        // Ammo display capsule
        const ammoCapsuleWidth = 220;
        const ammoCapsuleHeight = 78;
        const ammoCapsuleX = centerX - ammoCapsuleWidth / 2;
        const ammoCapsuleY = weaponPanelY + 82;

        const capsuleGrad = ctx.createLinearGradient(ammoCapsuleX, ammoCapsuleY, ammoCapsuleX, ammoCapsuleY + ammoCapsuleHeight);
        capsuleGrad.addColorStop(0, HUD_MONO_THEME.bubbleTop);
        capsuleGrad.addColorStop(1, HUD_MONO_THEME.bubbleBottom);
        ctx.fillStyle = capsuleGrad;
        drawRoundedRect(ammoCapsuleX, ammoCapsuleY, ammoCapsuleWidth, ammoCapsuleHeight, 22);
        ctx.fill();

        ctx.strokeStyle = isLowAmmo ? HUD_MONO_THEME.warning : hl;
        ctx.lineWidth = 3;
        ctx.shadowColor = isLowAmmo ? HUD_MONO_THEME.warningGlow : hl;
        ctx.shadowBlur = isLowAmmo ? 28 : 18;
        drawRoundedRect(ammoCapsuleX, ammoCapsuleY, ammoCapsuleWidth, ammoCapsuleHeight, 22);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Ammo numbers (primary focus)
        ctx.font = "900 48px 'Rajdhani', ui-monospace";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isLowAmmo ? HUD_MONO_THEME.warning : HUD_MONO_THEME.foreground;
        ctx.fillText(Math.max(0, Math.floor(player.ammo)).toString(), centerX, ammoCapsuleY + ammoCapsuleHeight / 2 - 6);

        // Max ammo + label underneath
        ctx.font = "700 16px 'Rajdhani', ui-monospace";
        ctx.fillStyle = HUD_MONO_THEME.captionMuted;
        ctx.fillText(`MAX ${Math.floor(player.maxAmmo)}`, centerX, ammoCapsuleY + ammoCapsuleHeight / 2 + 26);

        // Ammo bar under capsule
        const barW = ammoCapsuleWidth - 40;
        const barH = 8;
        const barX = centerX - barW / 2;
        const barY = ammoCapsuleY + ammoCapsuleHeight - 18;
        ctx.fillStyle = 'rgba(40, 40, 40, 0.85)';
        drawRoundedRect(barX, barY, barW, barH, 4);
        ctx.fill();

        if (ammoPercent > 0) {
          const barFillColor = isLowAmmo ? HUD_MONO_THEME.warning : (ammoPercent < 0.5 ? HUD_MONO_THEME.accentMuted : hl);
          ctx.fillStyle = barFillColor;
          drawRoundedRect(barX, barY, barW * ammoPercent, barH, 4);
          ctx.fill();
        }

        ctx.restore();
      }
      
      // End tiles
      ctx.restore();
    }

    function drawWeaponWheel() {
      // Only show weapon wheel in gun mode
      if (!wheel.open || player.animWeapon !== 'pistol') return;
      if (player.weapons.length === 0) return;
      
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      
      // Position wheel centered on screen
      const cx = w / 2;
      const cy = h / 2;
      
      // Only show first 7 weapons (mapped to keys 4-0)
      const availableWeapons = player.weapons.slice(0, 7);
      
      // Compact size - about 180px diameter (double character size)
      const R = 90;
      const rInner = 35;
      const n = availableWeapons.length;
      const slice = (Math.PI * 2) / n;
      
      // Semi-transparent backdrop (lighter than before)
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      // Center circle
      ctx.fillStyle = 'rgba(20,20,20,0.95)';
      ctx.beginPath();
      ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = HUD_MONO_THEME.borderSoft;
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Weapon segments
      for (let i = 0; i < n; i++) {
        const a0 = i * slice - Math.PI / 2;
        const a1 = a0 + slice;
        const hovered = i === wheel.hoverIndex;
        const isCurrent = i === player.currentWeapon;
        
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a0) * rInner, cy + Math.sin(a0) * rInner);
        ctx.arc(cx, cy, rInner, a0, a1);
        ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
        ctx.arc(cx, cy, R, a1, a0, true);
        ctx.closePath();
        
        // Segment fill
        const radial = ctx.createRadialGradient(cx, cy, rInner, cx, cy, R);
        if (isCurrent) {
          radial.addColorStop(0, 'rgba(230,230,230,0.95)');
          radial.addColorStop(1, 'rgba(150,150,150,0.88)');
        } else if (hovered) {
          radial.addColorStop(0, 'rgba(140,140,140,0.65)');
          radial.addColorStop(1, 'rgba(80,80,80,0.85)');
        } else {
          radial.addColorStop(0, 'rgba(50,50,50,0.6)');
          radial.addColorStop(1, 'rgba(30,30,30,0.8)');
        }
        ctx.fillStyle = radial;
        ctx.fill();
        
        // Segment border
        if (isCurrent) {
          ctx.strokeStyle = HUD_MONO_THEME.foreground;
          ctx.lineWidth = 3;
        } else if (hovered) {
          ctx.strokeStyle = HUD_MONO_THEME.accent;
          ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = HUD_MONO_THEME.borderSoft;
          ctx.lineWidth = 1;
        }
        ctx.stroke();
        
        // Glow for hovered/current
        if (hovered || isCurrent) {
          ctx.shadowColor = isCurrent ? HUD_MONO_THEME.glow : HUD_MONO_THEME.borderSoft;
          ctx.shadowBlur = 12;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        // Weapon name
        const weapon = availableWeapons[i];
        const midA = (a0 + a1) / 2;
        const textDist = rInner + (R - rInner) * 0.6;
        const tx = cx + Math.cos(midA) * textDist;
        const ty = cy + Math.sin(midA) * textDist;
        
        ctx.font = "700 10px 'Rajdhani', 'Share Tech Mono', ui-monospace";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        if (isCurrent) {
          ctx.fillStyle = '#000000';
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = 4;
        } else if (hovered) {
          ctx.fillStyle = HUD_MONO_THEME.foreground;
          ctx.shadowColor = HUD_MONO_THEME.glow;
          ctx.shadowBlur = 6;
        } else {
          ctx.fillStyle = HUD_MONO_THEME.accentMuted;
          ctx.shadowBlur = 0;
        }
        
        ctx.fillText(weapon.type.toUpperCase(), tx, ty);
        ctx.shadowBlur = 0;
      }
      
      // Center current weapon name (only if within available range)
      if (player.currentWeapon < availableWeapons.length) {
        const currentWeapon = availableWeapons[player.currentWeapon];
        ctx.fillStyle = HUD_MONO_THEME.foreground;
        ctx.font = "800 12px 'Rajdhani', 'Share Tech Mono', ui-monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(255,100,0,1)';
        ctx.shadowBlur = 10;
        ctx.fillText(currentWeapon.type.toUpperCase(), cx, cy);
      ctx.shadowBlur = 0;
      }
      
      ctx.restore();
    }
    function drawWeaponIcon(type: WeaponType, x: number, y: number, glow: boolean) {
      ctx.save();
      if (glow) { 
        ctx.shadowColor = 'rgba(255,0,0,1)'; 
        ctx.shadowBlur = 18; 
      }
      drawEmojiSprite(WEAPON_EMOJI[type], x, y, glow ? 44 : 36, HUD_MONO_THEME.foreground);
      ctx.shadowBlur = 0; 
      ctx.restore();
    }
    function drawIntroOverlay() {
      if (startedRef.current) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    function drawPauseOverlay() {
      // Do not show pause overlay before game starts
      if (!startedRef.current) return;
      if (runningRef.current) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      
      // Dark overlay
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillRect(0, 0, width, height);
      
      const isGameOver = player.hp <= 0;
      
      // Arcade-style frame
      const frameW = Math.min(700, width * 0.85);
      const frameH = Math.min(500, height * 0.7);
      const frameX = (width - frameW) / 2;
      const frameY = (height - frameH) / 2;
      
      // Main frame background
      const grad = ctx.createLinearGradient(frameX, frameY, frameX, frameY + frameH);
      grad.addColorStop(0, 'rgba(20,20,20,0.95)');
      grad.addColorStop(1, 'rgba(10,10,10,0.95)');
      ctx.fillStyle = grad;
      ctx.fillRect(frameX, frameY, frameW, frameH);
      
      // Thick arcade border
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 4;
      ctx.strokeRect(frameX, frameY, frameW, frameH);
      
      // Inner glow
      ctx.strokeStyle = 'rgba(255,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(frameX + 6, frameY + 6, frameW - 12, frameH - 12);
      
      // Corner decorations
      const cornerSize = 20;
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 3;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(frameX + cornerSize, frameY);
      ctx.lineTo(frameX, frameY);
      ctx.lineTo(frameX, frameY + cornerSize);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(frameX + frameW - cornerSize, frameY);
      ctx.lineTo(frameX + frameW, frameY);
      ctx.lineTo(frameX + frameW, frameY + cornerSize);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(frameX, frameY + frameH - cornerSize);
      ctx.lineTo(frameX, frameY + frameH);
      ctx.lineTo(frameX + cornerSize, frameY + frameH);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(frameX + frameW - cornerSize, frameY + frameH);
      ctx.lineTo(frameX + frameW, frameY + frameH);
      ctx.lineTo(frameX + frameW, frameY + frameH - cornerSize);
      ctx.stroke();
      // Title text
      ctx.font = "bold 56px 'Press Start 2P', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.8)";
      ctx.fillText(isGameOver ? "GAME OVER" : "PAUSED", width / 2 + 4, frameY + 80 + 4);
      // Main text
      ctx.fillStyle = "#ff0000";
      ctx.fillText(isGameOver ? "GAME OVER" : "PAUSED", width / 2, frameY + 80);
      // Glow
      ctx.shadowColor = 'rgba(255,0,0,0.8)';
      ctx.shadowBlur = 20;
      ctx.fillText(isGameOver ? "GAME OVER" : "PAUSED", width / 2, frameY + 80);
      ctx.shadowBlur = 0;
      
      if (isGameOver) {
        // Stats display
        ctx.font = "bold 14px 'Press Start 2P', monospace";
        ctx.fillStyle = "#ff6600";
        const statsY = frameY + 160;
        const lineH = 40;
        
        ctx.fillText(`FINAL SCORE: ${player.score}`, width / 2, statsY);
        ctx.fillText(`WAVE REACHED: ${wave}`, width / 2, statsY + lineH);
        ctx.fillText(`KILLS: ${player.kills}`, width / 2, statsY + lineH * 2);
        
        // Continue prompt
        ctx.font = "bold 12px 'Press Start 2P', monospace";
        ctx.fillStyle = "#cc0000";
        const pulse = 0.6 + 0.4 * Math.sin(Date.now() * 0.003);
        ctx.globalAlpha = pulse;
        ctx.fillText("PRESS R TO RESTART", width / 2, frameY + frameH - 60);
        ctx.globalAlpha = 1;
      } else {
        // Pause instructions
        const instructY = frameY + 180;
        const lineSpacing = 50;
        
        // Resume
        ctx.font = "bold 14px 'Press Start 2P', monospace";
        ctx.fillStyle = "#ff6600";
        ctx.fillText("PRESS P TO RESUME", width / 2, instructY);
        
        // Restart
        ctx.font = "12px 'Press Start 2P', monospace";
        ctx.fillStyle = "#994444";
        ctx.fillText("PRESS R TO RESTART", width / 2, instructY + lineSpacing);
        
        // Host controls - arcade style with glow
        if (multiplayerStateRef.current.isMultiplayerGame && multiplayerStateRef.current.isHost) {
          // Separator line
          ctx.strokeStyle = 'rgba(255,100,0,0.3)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(width / 2 - 200, instructY + lineSpacing * 1.7);
          ctx.lineTo(width / 2 + 200, instructY + lineSpacing * 1.7);
          ctx.stroke();
          
          // Host badge
          ctx.font = "bold 10px 'Press Start 2P', monospace";
          ctx.fillStyle = "#ffaa00";
          ctx.fillText("HOST CONTROLS", width / 2, instructY + lineSpacing * 2.1);
          
          // End game option with pulse effect
          ctx.font = "bold 12px 'Press Start 2P', monospace";
          const hostPulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.004);
          ctx.globalAlpha = hostPulse;
          ctx.shadowColor = 'rgba(255,100,0,0.8)';
          ctx.shadowBlur = 15;
          ctx.fillStyle = "#ff6600";
          ctx.fillText("PRESS ESC TO END MATCH", width / 2, instructY + lineSpacing * 2.7);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
          
          // Subtitle
          ctx.font = "8px 'Press Start 2P', monospace";
          ctx.fillStyle = "#aa5500";
          ctx.fillText("(Returns all players to map selection)", width / 2, instructY + lineSpacing * 3.2);
        }
      }
      
      ctx.restore();
    }
    // Start loop
    lastTime = performance.now();
    rafId = requestAnimationFrame(step);
    // ========== Local helpers referencing closures above ==========

    function startGameWithName(name: string, cfg?: { difficulty: 'Easy'|'Normal'|'Hard'; mode: 'Infinite'|'PvP'; mapId?: string }) {
      player.name = name || "Player";
      if (cfg) {
        gameConfigRef.current = cfg;
        if (cfg.mapId) {
          const selectedMap = getMapById(cfg.mapId);
          if (selectedMap) {
            currentMapRef.current = selectedMap;
            platformCacheMapId = selectedMap.id;
            platformChunkCache.clear();
            chunkPlatformMap.clear();
            clearPlatformRenderCache();
            platforms.length = 0;
          }
        }
      }
      startedRef.current = true;
      runningRef.current = true;
      setIsPaused(false);
      // stickman.reset removed - will be added with finalized stickman module
      // Start audio on user gesture
      initAudio();
      try { audioCtx && audioCtx.resume(); } catch {}
      try { musicEl && musicEl.play(); } catch {}
    }
    // ===== Multiplayer: PvP Damage Reception =====
    // Applies damage from remote players with full visual/audio impact
    function applyPvPDamage(
      damage: number, 
      knockbackX: number, 
      knockbackY: number,
      hitData: { cameraShake: number; hitStun: number; effectColor: string; effectIntensity: number }
    ) {
      // Respect invulnerability frames
      if (player.invulnMs > 0) return;
      
      // ===== Apply Core Damage and Physics =====
      player.hp = Math.max(0, player.hp - damage);
      
      // Set velocity directly for consistent knockback (don't accumulate)
      player.velocity.x = knockbackX;
      player.velocity.y = knockbackY;
      
      // Grant temporary invulnerability to prevent hit-stunlock
      player.invulnMs = 600;
      
      // ===== Screen Effects: Match PvE Intensity =====
      // Camera shake scaled 2.5x for impact (punches: 125ms, heavy: 500ms+)
      cameraShake.ms = Math.max(cameraShake.ms, hitData.cameraShake * 2.5);
      cameraShake.magnitude = Math.max(cameraShake.magnitude, hitData.cameraShake * 2.2);
      
      // Hitstop: freeze-frame effect for heavy impacts (30-120ms)
      hitstopMs = Math.max(hitstopMs, hitData.hitStun);
      
      // Zoom punch effect (1.0 to 1.12x based on damage)
      zoomEffect.targetScale = 1.0 + Math.min(0.12, damage * 0.003);
      
      // Screen flash and damage vignette
      screenFlash.alpha = 0.4;
      screenFlash.color = '#ff0000';
      damageEdgePulse.alpha = 0.6;
      damageEdgePulse.maxAlpha = Math.min(0.8, damage / player.maxHp + 0.4);
      
      // ===== Particle Effects: Victim-Side Feedback =====
      // All particles spawn ONLY on victim side to prevent double visuals
      if (proton) {
        const knockbackAngle = Math.atan2(knockbackY, knockbackX);
        
        // Blood spray using Proton particle system
        ParticleEffects.createBloodSpray(
          proton,
          player.position.x,
          player.position.y - 20,
          knockbackAngle + Math.PI // Opposite of knockback direction
        );
        
        // Attack-specific colored burst (matches attack type)
        ParticleEffects.createHitBurst(
          proton,
          player.position.x,
          player.position.y - 20,
          hitData.effectColor,
          hitData.effectIntensity
        );
        
        // Additional blood particles for heavy impact feel
        for (let i = 0; i < 10; i++) {
          const spreadAngle = knockbackAngle + (Math.random() - 0.5) * Math.PI * 0.7;
          pushParticle({
            position: { x: player.position.x, y: player.position.y - 20 },
            velocity: { 
              x: Math.cos(spreadAngle) * (200 + Math.random() * 200),
              y: Math.sin(spreadAngle) * (150 + Math.random() * 150)
            },
            lifeMs: 450 + Math.random() * 300,
            size: 2 + Math.random() * 2,
            color: '#8b0000',
            gravity: 1600,
            fade: 0.003
          });
        }
      }
      
      // Accumulating blood overlay on screen edges
      player.bloodOverlay = Math.min(1.2, player.bloodOverlay + damage / player.maxHp * 0.5);
      
      // ===== Audio Impact =====
      playHitEffect();    // Generic hit sound
      playMeleeImpact();  // Melee-specific thud
      playDamage();       // Player grunt/damage vocalization
      
      // ===== Animation Response =====
      triggerHurtAnimation(player);
    }
    
    function restartGame() {
      // Reset player state with spawn offset to avoid rendering bug
      player.position.x = SPAWN_OFFSET_X;
      player.position.y = groundYAt(SPAWN_OFFSET_X) - player.radius - 2;
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.hp = diffMul.playerMaxHp;
      player.maxHp = diffMul.playerMaxHp;
      player.score = 0;
      player.kills = 0;
      player.invulnMs = 0;
      player.shootCooldownMs = 0;
      player.ammo = 60;
      player.maxAmmo = 120;
      player.currentWeapon = 0;
      player.animKey = "unarmed_idle";
      player.animFrame = 0;
      player.animHoldUntilEnd = false;
      player.animWeapon = 'unarmed';
      player.onGround = false;
      player.canDoubleJump = false;
      player.attackCooldown = 0;

      // Reset world state
      wave = 1;
      waveInProgress = true;
      waveNeedsSetup = true;
      waveTimerMs = 0;
      waveSpawnQueue.length = 0;
      waveInitialCount = 0;
      combo = 0;
      comboTimerMs = 0;
      lives = 3;
      playerShield = 0;
      overdriveMs = 0;
      hitstopMs = 0;
      lastSpawnX = SPAWN_OFFSET_X;
      progressionDistance = 800;

      // Clear arrays
      bullets.length = 0;
      enemies.length = 0;
      particles.length = 0;
      pickups.length = 0;
      floatingTexts.length = 0;
      platforms.length = 0;
      platformChunkCache.clear();
      chunkPlatformMap.clear();
      clearPlatformRenderCache();
      platformCacheMapId = currentMapRef.current.id;
      shockwaves.length = 0;
      railBeams.length = 0;
      scorchDecals.length = 0;
      dynamicLights.length = 0;
      casings.length = 0;
      afterimages.length = 0;
      lightningArcs.length = 0;
      // Reset camera (offset to match spawn position)
      camera.x = 1720;
      camera.y = 0;
      cameraShake.ms = 0;
      cameraShake.magnitude = 0;

      // Regenerate initial platforms
      ensurePlatformsAround(player.position.x);

      // Resume game
      runningRef.current = true;
      setIsPaused(false);

      // Resume audio
      try { audioCtx && audioCtx.resume(); } catch {}
      try { musicEl && musicEl.play(); } catch {}
    }


    // ===== Multiplayer: Remote Bullet Creation =====
    // Creates visual bullets from remote players for feedback
    function spawnRemoteBullet(
      position: { x: number; y: number },
      velocity: { x: number; y: number },
      weaponType: string,
      damage: number
    ) {
      const b: Bullet = {
        position: { ...position },
        velocity: { ...velocity },
        damage,
        from: "enemy", // Mark as remote so we don't check collision (shooter is authoritative)
        lifeMs: 3000,
        type: weaponType as any,
        radius: 4
      };
      
      bullets.push(b);
      if (bullets.length > MAX_BULLETS) bullets.splice(0, bullets.length - MAX_BULLETS);
    }

    // Expose to outer scope via DOM dataset for simplicity (avoids effect deps)
    (canvas as any)._startGameWithName = startGameWithName;
    (canvas as any)._restartGame = restartGame;
    (canvas as any)._resizePost = resize;
    (canvas as any)._applyPvPDamage = applyPvPDamage;
    (canvas as any)._spawnRemoteBullet = spawnRemoteBullet;
    (canvas as any)._hostEndGame = () => {
      // Return to map selection in multiplayer
      gameContext.hostEndGame();
      // Reset game state
      startedRef.current = false;
      runningRef.current = false;
      setGameStarted(false);
      setIsPaused(false);
    };
    
    (canvas as any)._resetToLobby = () => {
      // Reset canvas game state when returning to lobby
      startedRef.current = false;
      runningRef.current = false;
    };
    (canvas as any)._togglePause = () => {
      runningRef.current = !runningRef.current;
      setIsPaused(!runningRef.current);
    };
    (canvas as any)._updateAudioFromSettings = () => {
      // Update music and sfx volumes when settings change
      try {
        if (musicEl) {
          musicEl.volume = settingsRef.current.audio.muted ? 0 : Math.max(0, Math.min(1, settingsRef.current.audio.musicVolume));
        }
        if (masterGain) {
          const sfxVol = settingsRef.current.audio.muted ? 0 : Math.max(0, Math.min(1, settingsRef.current.audio.sfxVolume));
          masterGain.gain.value = sfxVol;
        }
      } catch {}
    };

    const visHandler = () => {
      // No-op; dt clamped when hidden
    };
    document.addEventListener("visibilitychange", visHandler);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("visibilitychange", visHandler);
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('wheel', wheelScroll as any);
      canvas.removeEventListener('contextmenu', onContextMenu as any);
      try { stats && document.body.removeChild(stats.dom); } catch {}
      try { delete (canvas as any)._hvaiGameInit; } catch {}
    };
  }, []);

  // Poll UI overlay data from canvas
  useEffect(() => {
    let prev: any = null;
    function changed(a: any, b: any) {
      if (!a || !b) return true;
      const keys = ['hp','maxHp','shield','overdriveMs','combo','comboTimerMs','weapon','kills','wave','waveInProgress','waveTimerMs','score','highScore','playerName','lives','ammo','maxAmmo'];
      for (const k of keys) { if (a[k] !== b[k]) return true; }
      return false;
    }
    const id = setInterval(() => {
      const c: any = canvasRef.current;
      if (!c || !c._ui) return;
      const next = c._ui;
      if (changed(prev, next)) {
        setUi(next);
        prev = next;
      }
    }, 120);
    return () => clearInterval(id);
  }, []);

  // Multiplayer lobby handlers
  const handleCreateLobby = useCallback(async (username: string) => {
    const sessionId = await gameContext.createMultiplayerLobby(username);
    if (sessionId) {
      setPlayerName(username);
      console.log('Lobby created:', sessionId);
    } else {
      setDialogMessage({ 
        title: 'Connection Error', 
        message: 'Could not connect to multiplayer. Please try again.',
        type: 'error' 
      });
    }
  }, [gameContext]);

  const handleJoinLobby = useCallback(async (sessionId: string, username: string) => {
    const success = await gameContext.joinMultiplayerLobby(sessionId, username);
    if (success) {
      setPlayerName(username);
      console.log('Joined lobby:', sessionId);
    } else {
      setDialogMessage({ 
        title: 'Connection Error', 
        message: 'Failed to join lobby. Check the session ID.', 
        type: 'error' 
      });
    }
  }, [gameContext]);

  const attemptedInviteRef = useRef(false);
  useEffect(() => {
    if (attemptedInviteRef.current || gameContext.gameState.isMultiplayerGame) return;

    const params = new URLSearchParams(window.location.search);
    const targetSession = getInvitedRoom(params);
    if (!targetSession) return;

    attemptedInviteRef.current = true;
    const guestName = params.get('name')?.trim() || params.get('username')?.trim()
      || `Player-${Math.floor(1000 + Math.random() * 9000)}`;
    void handleJoinLobby(targetSession, guestName.slice(0, 15)).finally(() => setAutoLobbyReady(true));
  }, [gameContext.gameState.isMultiplayerGame, handleJoinLobby]);

  const handleLeaveLobby = useCallback(async () => {
    await gameContext.leaveLobby();
    setGameStarted(false);
  }, [gameContext]);

  const handleHostStartGame = useCallback(() => {
    gameContext.hostStartGame();
    const canvas = canvasRef.current as any;
    if (canvas && canvas._startGameWithName) {
      canvas._startGameWithName(playerName || "Player", { 
        difficulty: 'Normal', 
        mode: 'PvP',
        mapId: gameContext.gameState.selectedMapId 
      });
    }
    setGameStarted(true);
  }, [gameContext, playerName]);

  // React overlay for intro with input/button
  const handleStart = () => {
    const name = (playerName || "Player").trim();
    setPlayerName(name);

    const remotePlayers = Math.max(gameContext.gameState.connectedPlayers.length - 1, 0);
    const activeBots = matchPlayers.filter(p => p.type === 'bot').length;
    const totalFighters = 1 + remotePlayers + (gameContext.gameState.isMultiplayerGame ? 1 : 0) + activeBots;

    if (totalFighters < 2) {
      setDialogMessage({ 
        title: 'Not Enough Fighters', 
        message: 'Need at least 2 fighters! Add a bot or wait for another player to join.', 
        type: 'warning' 
      });
      return;
    }

    if (gameContext.gameState.lobbyPhase === 'waiting') {
      gameContext.startMapSelection(activeBots);
      return;
    }

    // Start game with match setup and selected map
    const canvas = canvasRef.current as any;
    if (canvas && canvas._startGameWithName) {
      canvas._startGameWithName(name, { 
        difficulty: 'Normal', 
        mode: 'PvP',
        matchPlayers,
        matchStocks,
        matchTimeLimit,
        remotePlayers: gameContext.gameState.connectedPlayers,
        mapId: gameContext.gameState.selectedMapId
      });
    }
    setGameStarted(true);
  };

  // Also start on Enter within the input
  const handleNameKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") handleStart();
  };
  return (
    <div className="game-root" style={{ width: "100vw", height: "100vh", background: "#000", position: "relative" }}>
      {!gameStarted && gamePath('/') !== '/' && (
        <a className="game-hub-link" href="/">Back to Hub</a>
      )}
      <Head>
        <title>JRod Presents: Stickfigure Mayhem</title>
        <meta name="description" content="An action-packed stickfigure platformer game." />
        <meta name="keywords" content="JRod, Stickfigure, Mayhem, platformer, game" />
        <meta name="author" content="JRod" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet" />
        <style>{` 
          body { image-rendering: pixelated; }
          .pixel { font-family: 'Press Start 2P', ui-monospace, monospace; }
          .retro-text { font-family: 'Press Start 2P', monospace; text-rendering: optimizeLegibility; }
          
          @keyframes matrix-flicker {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.98; }
          }
          
          @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 20px rgba(255, 255, 255, 0.4), inset 0 0 20px rgba(255, 255, 255, 0.1); }
            50% { box-shadow: 0 0 30px rgba(255, 255, 255, 0.6), inset 0 0 30px rgba(255, 255, 255, 0.15); }
          }
          
          @keyframes matrix-glow {
            0%, 100% { box-shadow: 0 0 10px rgba(255, 255, 255, 0.3), inset 0 0 10px rgba(255, 255, 255, 0.1); }
            50% { box-shadow: 0 0 20px rgba(255, 255, 255, 0.6), inset 0 0 20px rgba(255, 255, 255, 0.2); }
          }
          
          @keyframes scanline {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(100vh); }
          }
          
          @keyframes slideInFromTop {
            0% { transform: translateY(-100px); opacity: 0; }
            100% { transform: translateY(0); opacity: 1; }
          }
          
          @keyframes slideInFromBottom {
            0% { transform: translateY(100px); opacity: 0; }
            100% { transform: translateY(0); opacity: 1; }
          }
          
          @keyframes fadeIn {
            0% { opacity: 0; }
            100% { opacity: 1; }
          }
          
          @keyframes fadeOut {
            0% { opacity: 1; }
            100% { opacity: 0; }
          }
          
          @keyframes cinematicIntro {
            0% { opacity: 1; }
            95% { opacity: 1; }
            100% { opacity: 0; }
          }
          
          @keyframes cinematicImageIn {
            0% { opacity: 0; transform: scale(1.1); }
            3% { opacity: 1; transform: scale(1); }
            97% { opacity: 1; transform: scale(1); }
            100% { opacity: 1; transform: scale(1); }
          }
          
          @keyframes letterboxSlideIn {
            0% { transform: scaleY(0); }
            8% { transform: scaleY(1); }
            92% { transform: scaleY(1); }
            100% { transform: scaleY(1); }
          }
          
          @keyframes filmGrain {
            0%, 100% { opacity: 0.03; }
            50% { opacity: 0.05; }
          }
          
          @keyframes glitch {
            0% { transform: translate(0); }
            20% { transform: translate(-2px, 2px); }
            40% { transform: translate(-2px, -2px); }
            60% { transform: translate(2px, 2px); }
            80% { transform: translate(2px, -2px); }
            100% { transform: translate(0); }
          }
          
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
          
          .menu-fade-in {
            animation: fadeIn 0.8s ease-out;
          }
          
          .menu-slide-top {
            animation: slideInFromTop 0.6s ease-out;
          }
          
          .menu-slide-bottom {
            animation: slideInFromBottom 0.6s ease-out 0.2s both;
          }
          
          .insert-coin {
            animation: blink 2s ease-in-out infinite;
          }
          
          @keyframes shine {
            0% { left: -100%; }
            20% { left: 100%; }
            100% { left: 100%; }
          }
          
          .matrix-button:hover .shine-effect {
            animation: shine 1.5s ease-in-out infinite;
          }
          
          .matrix-title {
            animation: matrix-flicker 2s ease-in-out infinite;
          }
          
          .matrix-card {
            background: linear-gradient(135deg, rgba(20,20,20,0.95) 0%, rgba(10,10,10,0.97) 100%);
            border: 2px solid rgba(255,255,255,0.7);
            border-radius: 16px;
            box-shadow: 
              0 0 25px rgba(255, 255, 255, 0.3),
              inset 0 0 20px rgba(0, 0, 0, 0.6);
            position: relative;
          }
          
          .matrix-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
              repeating-linear-gradient(
                0deg,
                rgba(255,255,255,0.03) 0px,
                transparent 1px,
                transparent 2px,
                rgba(255,255,255,0.03) 3px
              );
            pointer-events: none;
          }
          
          .corner-decor {
            position: absolute;
            width: 14px;
            height: 14px;
            border: 3px solid #ffffff;
            opacity: 0.8;
          }
          .corner-decor.tl { top: -1px; left: -1px; border-right: none; border-bottom: none; }
          .corner-decor.tr { top: -1px; right: -1px; border-left: none; border-bottom: none; }
          .corner-decor.bl { bottom: -1px; left: -1px; border-right: none; border-top: none; }
          .corner-decor.br { bottom: -1px; right: -1px; border-left: none; border-top: none; }
          
          .matrix-button {
            transition: all 0.1s ease;
            position: relative;
            box-shadow: 
              0 4px 0 rgba(100, 100, 100, 1),
              0 5px 10px rgba(0, 0, 0, 0.5);
          }
          
          .matrix-button:hover {
            box-shadow: 
              0 4px 0 rgba(180, 180, 180, 1),
              0 5px 15px rgba(255, 255, 255, 0.5),
              0 0 20px rgba(255, 255, 255, 0.3);
            transform: translateY(-1px);
          }
          
          .matrix-button:active {
            box-shadow: 
              0 2px 0 rgba(60, 60, 60, 1),
              0 3px 5px rgba(0, 0, 0, 0.5);
            transform: translateY(2px);
          }
          
          .matrix-input {
            background: rgba(0,0,0,0.9);
            border: 3px solid #666666;
            color: #ffffff;
            transition: all 0.15s ease;
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.2);
          }
          
          .matrix-input:focus {
            outline: none;
            border-color: #ffffff;
            box-shadow: 
              inset 0 2px 8px rgba(0, 0, 0, 0.8),
              0 0 0 2px rgba(255, 255, 255, 0.5),
              0 0 20px rgba(255, 255, 255, 0.3);
          }
          
          .matrix-input::placeholder {
            color: rgba(255, 255, 255, 0.3);
          }
          
          .scanline-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(to bottom, transparent, rgba(255, 255, 255, 0.3), transparent);
            animation: scanline 6s linear infinite;
            pointer-events: none;
            z-index: 1000;
          }

          /* Custom range slider styling */
          input[type="range"] {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 4px;
            background: rgba(0,0,0,0.6);
            outline: none;
            border-radius: 2px;
            border: 1px solid rgba(255,255,255,0.2);
          }
          
          input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 12px;
            height: 12px;
            background: linear-gradient(135deg, #ffffff, #cccccc);
            cursor: pointer;
            border-radius: 2px;
            box-shadow: 0 0 6px rgba(255,255,255,0.6);
            border: 1px solid rgba(255,255,255,0.8);
          }
          
          input[type="range"]::-moz-range-thumb {
            width: 12px;
            height: 12px;
            background: linear-gradient(135deg, #ffffff, #cccccc);
            cursor: pointer;
            border-radius: 2px;
            box-shadow: 0 0 6px rgba(255,255,255,0.6);
            border: 1px solid rgba(255,255,255,0.8);
          }
          
          input[type="range"]:hover::-webkit-slider-thumb {
            box-shadow: 0 0 10px rgba(255,255,255,0.9);
          }
          
          input[type="range"]:hover::-moz-range-thumb {
            box-shadow: 0 0 10px rgba(255,255,255,0.9);
          }
          
          /* Custom checkbox styling */
          input[type="checkbox"] {
            appearance: none;
            -webkit-appearance: none;
            width: 16px;
            height: 16px;
            background: rgba(0,0,0,0.6);
            border: 1px solid rgba(255,255,255,0.3);
            border-radius: 2px;
            cursor: pointer;
            position: relative;
          }
          
          input[type="checkbox"]:checked {
            background: linear-gradient(135deg, rgba(80,80,80,0.9), rgba(40,40,40,0.9));
            border-color: rgba(255,255,255,0.8);
          }
          
          input[type="checkbox"]:checked::after {
            content: 'X';
            position: absolute;
            color: #ffffff;
            font-size: 12px;
            font-family: 'Press Start 2P', monospace;
            top: -2px;
            left: 2px;
            text-shadow: 0 0 4px rgba(255,255,255,0.8);
          }
          
          /* Select dropdown styling */
          select option {
            background: #1a1a1a;
            color: #ffffff;
          }
        `}</style>
      </Head>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      <canvas
        ref={protonCanvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
      
      {/* Cinematic Intro Screen */}
      {showIntro && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backdropFilter: `blur(${INTRO_CONFIG.backdropBlur}px) brightness(${INTRO_CONFIG.backdropBrightness})`,
            WebkitBackdropFilter: `blur(${INTRO_CONFIG.backdropBlur}px) brightness(${INTRO_CONFIG.backdropBrightness})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            animation: `cinematicIntro ${INTRO_CONFIG.duration}ms ease-in-out forwards`,
          }}
        >
          {/* Film grain overlay */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='${INTRO_CONFIG.filmGrainOpacity}'/%3E%3C/svg%3E")`,
              animation: 'filmGrain 0.3s infinite',
              pointerEvents: 'none',
              zIndex: 10001,
              mixBlendMode: 'multiply',
            }}
          />
          
          {/* Vignette effect for extra cinematic feel */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%)',
              pointerEvents: 'none',
              zIndex: 10001,
            }}
          />
          
          {/* Top black bar (letterbox) */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: INTRO_CONFIG.letterboxHeight,
              background: '#000',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              zIndex: 10000,
              transformOrigin: 'top',
              animation: `letterboxSlideIn ${INTRO_CONFIG.duration}ms ease-out forwards`,
            }}
          />
          
          {/* Bottom black bar (letterbox) */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: INTRO_CONFIG.letterboxHeight,
              background: '#000',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
              zIndex: 10000,
              transformOrigin: 'bottom',
              animation: `letterboxSlideIn ${INTRO_CONFIG.duration}ms ease-out forwards`,
            }}
          />
          
          {/* Fight Image */}
          <img
            src={gameImagePath('/images/fight image main.png')}
            alt="Fight"
            style={{
              maxWidth: INTRO_CONFIG.imageMaxWidth,
              maxHeight: INTRO_CONFIG.imageMaxHeight,
              objectFit: 'contain',
              filter: 'drop-shadow(0 0 30px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 10px rgba(255, 255, 255, 0.3))',
              zIndex: 9999,
              animation: `cinematicImageIn ${INTRO_CONFIG.duration}ms ease-out forwards`,
            }}
          />
        </div>
      )}

      {/* Voice Chat - Persistent across all multiplayer phases */}
      {gameContext.gameState.isMultiplayerGame && gameContext.gameState.multiplayerSessionId && (
        <VoiceChat
          channel={gameContext.gameState.roomChannel}
          connectedPlayers={gameContext.gameState.connectedPlayers}
          localClientId={roomClient?.auth.clientId || null}
          inGame={gameStarted}
        />
      )}
      
      {/* Map Selection Screen */}
      {!gameStarted && gameContext.gameState.lobbyPhase === 'map-selection' && gameContext.gameState.isMultiplayerGame && (
        <MapSelectionScreen
          selectedMapId={gameContext.gameState.selectedMapId}
          onMapSelect={gameContext.selectMap}
          onConfirm={gameContext.confirmMapSelection}
          isHost={gameContext.gameState.isHost}
          connectedPlayers={gameContext.gameState.connectedPlayers}
          sessionId={gameContext.gameState.multiplayerSessionId}
        />
      )}

      {/* Ready Up Screen */}
      {!gameStarted && gameContext.gameState.lobbyPhase === 'ready-up' && (
        <ReadyUpScreen
          players={gameContext.gameState.connectedPlayers}
          selectedMapId={gameContext.gameState.selectedMapId}
          onToggleReady={gameContext.toggleReady}
          onStartGame={handleHostStartGame}
          isHost={gameContext.gameState.isHost}
          currentPlayerClientId={roomClient?.auth.clientId || ''}
          sessionId={gameContext.gameState.multiplayerSessionId}
          botCount={matchPlayers.filter(p => p.type === 'bot').length}
        />
      )}

      {!gameStarted && (!gameContext.gameState.lobbyPhase || gameContext.gameState.lobbyPhase === 'waiting') && (
        <div
          className="main-menu-screen"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "auto",
            background: 'radial-gradient(circle at 50% 12%, rgba(255,255,255,0.94), rgba(210,221,221,0.88) 28%, rgba(78,84,86,0.92) 58%, rgba(8,10,12,0.98) 100%)'
          }}
        >
          {/* Windows desktop pattern */}
          <div style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.03,
            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
            pointerEvents: 'none'
          }} />
          <div
            className="main-menu-shell menu-fade-in"
            style={{
              width: 'min(94vw, 980px)',
              display: 'grid',
              gap: 'clamp(10px, 2vh, 18px)',
              position: 'relative',
              zIndex: 1,
              margin: 'auto'
            }}
          >
            {/* Title image */}
            <div className="menu-slide-top" style={{ 
              position: 'relative',
              display: 'flex',
              justifyContent: 'center',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              marginBottom: `${contentLift}px`
            }}>
              <div
                className="game-title-plaque"
                aria-label="Stickfigure Mayhem"
                style={{
                  transform: `translate(${titleOffset}px, ${titleYOffset}px)`,
                }}
              >
                <div>
                  <div className="game-title-kicker">JRod Presents:</div>
                  <div className="game-title-main">STICKFIGURE<br />MAYHEM</div>
                </div>
              </div>
              {SHOW_TITLE_TUNING && (
              <div style={{ 
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  background: 'rgba(0,0,0,0.4)',
                  padding: '12px 14px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.3)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <span style={{ color: '#ffffff', fontSize: 10, fontFamily: 'Press Start 2P' }}>TITLE OFFSET X</span>
                    <input
                      type="range"
                      min={-200}
                      max={200}
                      value={titleOffset}
                      onChange={(e) => setTitleOffset(Number(e.target.value))}
                      style={{ width: 160 }}
                    />
                    <span style={{ color: '#cccccc', fontSize: 10, fontFamily: 'Press Start 2P', width: 50, textAlign: 'right' }}>{titleOffset}px</span>
                    <span style={{ color: '#ffffff', fontSize: 10, fontFamily: 'Press Start 2P', marginLeft: 14 }}>TITLE OFFSET Y</span>
                    <input
                      type="range"
                      min={-200}
                      max={200}
                      value={titleYOffset}
                      onChange={(e) => setTitleYOffset(Number(e.target.value))}
                      style={{ width: 160 }}
                    />
                    <span style={{ color: '#cccccc', fontSize: 10, fontFamily: 'Press Start 2P', width: 50, textAlign: 'right' }}>{titleYOffset}px</span>
              </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                    <span style={{ color: '#ffffff', fontSize: 10, fontFamily: 'Press Start 2P' }}>GROUP LIFT</span>
                    <input
                      type="range"
                      min={-400}
                      max={240}
                      value={contentLift}
                      onChange={(e) => setContentLift(Number(e.target.value))}
                      style={{ width: 240 }}
                    />
                    <span style={{ color: '#cccccc', fontSize: 10, fontFamily: 'Press Start 2P', width: 60, textAlign: 'right' }}>{contentLift >= 0 ? '+' : ''}{contentLift}px</span>
              </div>
                </div>
              )}
            </div>
            {/* Menu cards */}
            <div className="main-menu-grid menu-slide-bottom" style={{ transform: `translateY(${contentLift}px)` }}>
              {/* Player & Start */}
              <div style={{ 
                background: 'var(--grad-surface)', 
                border: '2px outset var(--bevel-mid)', 
                padding: '16px', 
                position: 'relative',
                boxShadow: 'var(--shadow-window)'
              }}>
                {/* Windows titlebar */}
                <div style={{
                  background: 'var(--grad-titlebar)',
                  color: 'var(--neutral-white)',
                  padding: '4px 8px',
                  marginBottom: 12,
                  marginTop: -16,
                  marginLeft: -16,
                  marginRight: -16,
                  fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                  fontSize: 11,
                  fontWeight: 700,
                  borderBottom: '1px solid var(--border-dark)'
                }}>
                  Stickfigure Mayhem
                </div>
                
                <label style={{
                  display: 'block',
                  color: 'var(--neutral-black)',
                  fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                  fontSize: 11,
                  fontWeight: 700,
                  marginBottom: 4
                }}>
                  Player Name:
                </label>
                <input 
                  value={playerName} 
                  onChange={(e) => setPlayerName(e.target.value)} 
                  onKeyDown={handleNameKeyDown} 
                  placeholder="Enter your name" 
                  style={{ 
                    width: '100%', 
                    padding: '4px 6px', 
                    marginBottom: 12, 
                    fontSize: 11, 
                    letterSpacing: 0,
                    textTransform: 'none',
                    color: 'var(--neutral-black)',
                    fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                    fontWeight: 400,
                    background: 'var(--neutral-white)',
                    border: '2px inset var(--bevel-mid)',
                    borderRadius: 0,
                    boxShadow: 'var(--shadow-sunken)',
                    textShadow: 'none'
                  }} 
                />
                
                {/* Action Buttons - Windows XP Style */}
                <div style={{ display: 'flex', gap: 8, width: '100%', marginBottom: 12 }}>
                <button
                  onClick={handleStart} 
                  disabled={!autoLobbyReady}
                      style={{ 
                      flex: 1,
                      padding: '8px 12px', 
                      border: '1px solid var(--border-dark)', 
                      background: autoLobbyReady ? 'var(--grad-titlebar)' : 'var(--grad-button)',
                      color: autoLobbyReady ? 'var(--neutral-white)' : 'var(--neutral-black)',
                        cursor: autoLobbyReady ? 'pointer' : 'not-allowed', 
                      fontWeight: 700, 
                      fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                      textShadow: autoLobbyReady ? '1px 1px 0 rgba(0,0,0,0.5)' : 'none', 
                      fontSize: 11, 
                      letterSpacing: 0,
                      borderRadius: 0,
                      boxShadow: 'var(--shadow-raised)',
                      transition: 'none',
                      opacity: autoLobbyReady ? 1 : 0.5
                    }}
                  >
                      {!autoLobbyReady
                      ? 'Loading...'
                        : gameContext.gameState.lobbyPhase === 'waiting'
                        ? 'Select Map'
                        : 'Start Game'}
                  </button>
          <button
            onClick={() => {
              if (!autoLobbyReady) {
                        setDialogMessage({ 
                          title: 'Please Wait', 
                          message: 'Still setting up lobby. Please wait a moment...', 
                          type: 'info' 
                        });
                return;
              }
                      setShowJoinPrompt(true);
            }}
            disabled={!autoLobbyReady}
                    style={{ 
                      flex: 1,
                      padding: '8px 12px', 
                      border: '1px solid var(--border-dark)', 
                      background: 'var(--grad-button)',
                      color: 'var(--neutral-black)',
              cursor: autoLobbyReady ? 'pointer' : 'not-allowed',
                      fontWeight: 700, 
                      fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                      textShadow: 'none', 
                      fontSize: 11, 
                      letterSpacing: 0,
                      borderRadius: 0,
                      boxShadow: 'var(--shadow-raised)',
                      transition: 'none',
                      opacity: autoLobbyReady ? 1 : 0.5
                    }}
                  >
                    Join Lobby
                  </button>
                </div>
                
                {/* Keybinds section - Windows groupbox style */}
                <div style={{ 
                  marginTop: 12,
                  padding: '8px',
                  border: '1px solid var(--bevel-dark)',
                  borderRadius: 0,
                  position: 'relative'
                }}>
                  <div style={{
                    position: 'absolute',
                    top: -6,
                    left: 8,
                    background: 'var(--grad-surface)',
                    padding: '0 4px',
                    color: 'var(--neutral-black)',
                    fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                  fontSize: 11, 
                    fontWeight: 700
                  }}>
                    Options
                  </div>
                    <button
                      onClick={() => setKeybindModalOpen(true)}
                      style={{
                        width: '100%',
                      padding: '6px 12px',
                        fontSize: 11,
                      letterSpacing: 0,
                      fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                        fontWeight: 700,
                        cursor: 'pointer',
                      border: '1px solid var(--border-dark)',
                      borderRadius: 0,
                      background: 'var(--grad-button)',
                      color: 'var(--neutral-black)',
                      transition: 'none',
                      boxShadow: 'var(--shadow-raised)',
                      textShadow: 'none'
                    }}
                  >
                    Customize Keybinds...
                    </button>
                </div>

                {/* Lobby Info - Windows panel style */}
                {gameContext.gameState.lobbyPhase && gameContext.gameState.multiplayerSessionId && (
                  <div style={{ 
                    marginTop: 12,
                    padding: '8px',
                    border: '2px inset var(--bevel-mid)',
                    borderRadius: 0,
                    background: 'var(--neutral-white)',
                    color: 'var(--neutral-black)',
                    fontSize: 11, 
                    fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif", 
                    fontWeight: 400,
                    lineHeight: 1.4, 
                    textAlign: 'left',
                    boxShadow: 'var(--shadow-sunken)'
                  }}>
                    <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--neutral-black)', textAlign: 'left', letterSpacing: 0, fontWeight: 700 }}>
                      {gameContext.gameState.isHost ? 'Hosting Lobby' : 'In Lobby'}
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11 }}>Session:</span>
                        <button
                          onClick={() => {
                            if (gameContext.gameState.multiplayerSessionId) {
                              navigator.clipboard.writeText(gameContext.gameState.multiplayerSessionId);
                            }
                          }}
                          style={{
                            background: 'var(--grad-button)',
                            border: '1px solid var(--border-dark)',
                            borderRadius: 0,
                            padding: '2px 6px',
                            color: 'var(--neutral-black)',
                            fontSize: 9,
                            fontFamily: "monospace",
                            cursor: 'pointer',
                            letterSpacing: 0,
                            fontWeight: 400,
                            boxShadow: 'var(--shadow-raised)'
                          }}
                        >
                          {gameContext.gameState.multiplayerSessionId}
                        </button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11 }}>Players:</span>
                        <span style={{ fontWeight: 700 }}>{gameContext.gameState.connectedPlayers.length}</span>
                      </div>
                      <button
                        onClick={async () => {
                          const room = gameContext.gameState.multiplayerSessionId;
                          if (!room) return;
                          const invite = new URL(gamePath('/'), window.location.origin);
                          invite.searchParams.set('room', room);
                          try {
                            await navigator.clipboard.writeText(invite.href);
                          } catch {
                            setDialogMessage({ title: 'Room invite', message: invite.href, type: 'info' });
                          }
                        }}
                      >
                        Copy invite link
                      </button>
                      <button onClick={() => { void handleLeaveLobby(); }}>Leave Lobby</button>
                      {gameContext.gameState.connectedPlayers.map((player, idx) => (
                        <div key={player.clientId} style={{ 
                          fontSize: 10, 
                          color: 'var(--neutral-black)',
                          paddingLeft: 8,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}>
                          <span style={{ opacity: 0.7 }}>●</span>
                          {player.username}
                          {idx === 0 && <span style={{ fontSize: 9, opacity: 0.7 }}>(HOST)</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* Match Setup - Windows XP Style */}
              <div style={{ display: 'grid', gap: 12, gridTemplateRows: 'auto auto auto' }}>
                {/* Player Slots */}
                  <div style={{
                  background: 'var(--grad-surface)', 
                  border: '2px outset var(--bevel-mid)', 
                  padding: 0, 
                  position: 'relative',
                  boxShadow: 'var(--shadow-window)'
                }}>
                  {/* Windows titlebar */}
                  <div style={{
                    background: 'var(--grad-titlebar)',
                    color: 'var(--neutral-white)',
                    padding: '4px 8px',
                    fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                    fontSize: 11,
                    fontWeight: 700,
                    borderBottom: '1px solid var(--border-dark)',
                    textAlign: 'center'
                  }}>Fighters</div>
                  
                  <div style={{ padding: 12 }}>

                  {matchPlayers.map((slot, idx) => (
                    <div
                      key={slot.id}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        marginBottom: idx < 3 ? 6 : 0,
                        fontSize: 11,
                        letterSpacing: 0,
                        fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                        fontWeight: 400,
                        background: slot.type === 'empty' ? 'var(--neutral-white)' : 'var(--grad-button)',
                        border: slot.type === 'empty'
                          ? '2px inset var(--bevel-mid)'
                          : '1px solid var(--border-dark)',
                        borderRadius: 0,
                        boxShadow: slot.type === 'empty'
                          ? 'var(--shadow-sunken)'
                          : 'var(--shadow-raised)',
                        color: 'var(--neutral-black)',
                        textShadow: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        transition: 'none',
                        cursor: 'pointer',
                        boxSizing: 'border-box'
                      }}
                      onClick={() => {
                        // Only allow toggling bot/empty, not remote players
                        if (idx === 0 || (slot.type === 'player' && slot.id !== 'p1')) return; // Don't modify local or remote players
                        
                        const newPlayers = [...matchPlayers];
                        if (slot.type === 'empty') {
                          newPlayers[idx] = { type: 'bot', name: `Bot ${idx + 1}`, id: `bot${idx}`, color: slot.color };
                        } else if (slot.type === 'bot') {
                          newPlayers[idx] = { type: 'empty', name: '', id: `s${idx + 1}`, color: slot.color };
                        }
                        setMatchPlayers(newPlayers);
                      }}
                    >
                      <span style={{ fontSize: 14 }}>
                        {slot.type === 'empty' ? '○' : slot.type === 'bot' ? '🤖' : '👤'}
                      </span>
                      <span style={{ flex: 1 }}>
                        {slot.type === 'empty' ? 'Empty Slot' : slot.name}
                      </span>
                      <span style={{ fontSize: 9, opacity: 0.6 }}>
                        {slot.type === 'empty' ? 'Click to add' : slot.type === 'bot' ? 'Bot' : 'Player'}
                      </span>
                    </div>
                  ))}
                  </div>
                </div>

                {/* Match Settings */}
                  <div style={{
                  background: 'var(--grad-surface)', 
                  border: '2px outset var(--bevel-mid)', 
                  padding: 0, 
                  position: 'relative',
                  boxShadow: 'var(--shadow-window)'
                }}>
                  {/* Windows titlebar */}
                  <div style={{
                    background: 'var(--grad-titlebar)',
                    color: 'var(--neutral-white)',
                    padding: '4px 8px',
                    fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                    fontSize: 11,
                    fontWeight: 700,
                    borderBottom: '1px solid var(--border-dark)',
                      textAlign: 'center'
                  }}>Match Rules</div>
                  
                  <div style={{ padding: 12 }}>

                  {/* Stock/Lives */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{
                      color: 'var(--neutral-black)',
                      fontSize: 11,
                      marginBottom: 4,
                      fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                      fontWeight: 700
                    }}>Lives per player:</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[1, 3, 5, 10].map(stock => (
                        <button
                          key={stock}
                          onClick={() => setMatchStocks(stock)}
                          style={{
                            flex: 1,
                            padding: '6px 4px',
                            fontSize: 11,
                            fontWeight: 700,
                            fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                            background: matchStocks === stock ? 'var(--grad-titlebar)' : 'var(--grad-button)',
                            border: '1px solid var(--border-dark)',
                            borderRadius: 0,
                            color: matchStocks === stock ? 'var(--neutral-white)' : 'var(--neutral-black)',
                            cursor: 'pointer',
                            transition: 'none',
                            boxShadow: 'var(--shadow-raised)',
                            textShadow: matchStocks === stock ? '1px 1px 0 rgba(0,0,0,0.5)' : 'none'
                          }}
                        >
                          {stock}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Time Limit */}
                  <div>
                    <div style={{
                      color: 'var(--neutral-black)',
                      fontSize: 11,
                      marginBottom: 4,
                      fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                      fontWeight: 700
                    }}>Match duration (minutes):</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[0, 2, 5, 10].map(time => (
                    <button
                          key={time}
                          onClick={() => setMatchTimeLimit(time)}
                      style={{
                            flex: 1,
                            padding: '6px 4px',
                            fontSize: 11,
                            fontWeight: 700,
                            fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                            background: matchTimeLimit === time ? 'var(--grad-titlebar)' : 'var(--grad-button)',
                            border: '1px solid var(--border-dark)',
                            borderRadius: 0,
                            color: matchTimeLimit === time ? 'var(--neutral-white)' : 'var(--neutral-black)',
                            cursor: 'pointer',
                            transition: 'none',
                            boxShadow: 'var(--shadow-raised)',
                            textShadow: matchTimeLimit === time ? '1px 1px 0 rgba(0,0,0,0.5)' : 'none'
                      }}
                    >
                          {time === 0 ? '∞' : `${time}m`}
                    </button>
                  ))}
                    </div>
                  </div>
                </div>
              </div>
                  </div>
            </div>
            {/* Footer credits */}
            <div style={{
              textAlign: 'center',
              marginTop: 30,
              fontSize: 8,
              fontFamily: 'Press Start 2P',
              color: '#666666',
              letterSpacing: 1,
              textShadow: '1px 1px 0 rgba(0,0,0,0.8)'
            }}>
              <div style={{ opacity: 0.6 }}>
                © 2025 JRod • STICKFIGURE MAYHEM
              </div>
            </div>
          </div>
        </div>
      )}
      {/* HUD overlay */}
      {gameStarted && (
        <>
          {/* Scanline effect */}
          <div className="scanline-overlay" />
          
          {/* Top HUD */}
          <div className="hud-layer" style={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            right: 0, 
            fontFamily: 'Press Start 2P',
            pointerEvents: 'none',
            padding: '16px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 16
          }}>
            {/* Wave, Score & Kills - Top Left */}
            <div className="hud-score-cluster hud-panel" style={{ 
              fontFamily: "'Rajdhani', 'Share Tech Mono', ui-monospace",
              display: 'flex', 
              gap: 24,
              padding: '10px 14px'
            }}>
              {/* Wave */}
              <div>
                <div className="hud-metric-label" style={{
                  fontSize: 12,
                  color: '#c0c0c0',
                  fontWeight: 800,
                  letterSpacing: 2,
                  textShadow: '0 0 15px rgba(255,255,255,0.6), 2px 2px 0 rgba(0,0,0,0.9)',
                  marginBottom: 4
                }}>
                  WAVE
                </div>
                <div className="hud-metric-value" style={{
                  fontSize: 36,
                  fontWeight: 900,
                  color: '#ffffff',
                  textShadow: '0 0 25px rgba(255,255,255,0.9), 4px 4px 0 rgba(0,0,0,0.9)',
                  letterSpacing: 3,
                  lineHeight: 1
                }}>
                  {ui.wave}
                </div>
              </div>

              {/* Score */}
              <div>
                  <div className="hud-metric-label" style={{ 
                  fontSize: 12,
                  color: '#c0c0c0',
                  fontWeight: 800,
                  letterSpacing: 2,
                  marginBottom: 4,
                  textShadow: '0 0 15px rgba(255,255,255,0.6), 2px 2px 0 rgba(0,0,0,0.9)'
                }}>
                  SCORE
                </div>
                <div className="hud-metric-value" style={{
                  fontSize: 36,
                  fontWeight: 900,
                  color: '#ffffff',
                  letterSpacing: 2,
                  textShadow: '0 0 25px rgba(255,255,255,0.9), 4px 4px 0 rgba(0,0,0,0.9)',
                  lineHeight: 1
                }}>
                  {Math.floor(ui.score).toString().padStart(7, '0')}
                </div>
              </div>

              {/* Kills */}
              <div>
                <div className="hud-metric-label" style={{
                  fontSize: 12,
                  color: '#c0c0c0',
                  fontWeight: 800,
                  letterSpacing: 2,
                  marginBottom: 4,
                  textShadow: '0 0 15px rgba(255,255,255,0.6), 2px 2px 0 rgba(0,0,0,0.9)'
                }}>
                  KILLS
                </div>
                <div className="hud-metric-value" style={{
                  fontSize: 36,
                  fontWeight: 900,
                  color: '#ffffff',
                  letterSpacing: 2,
                  textShadow: '0 0 25px rgba(255,255,255,0.9), 4px 4px 0 rgba(0,0,0,0.9)',
                  lineHeight: 1
                }}>
                  {ui.kills}
                </div>
              </div>
            </div>

            {/* Player Stats - Top Right */}
            <div className="hud-player-cluster hud-panel" style={{
              display: 'flex', 
              flexDirection: 'column',
              gap: 12,
              fontFamily: "'Rajdhani', 'Share Tech Mono', ui-monospace",
              textAlign: 'right',
              minWidth: 300
            }}>
              {/* Player name & Lives */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                <div style={{ 
                  fontSize: 21, 
                  color: '#ffffff', 
                  textShadow: '0 0 15px rgba(255,255,255,0.9), 2px 2px 0 rgba(0,0,0,0.9)',
                  letterSpacing: 1.5,
                  fontWeight: 900
                }}>
                  {ui.playerName || 'PLAYER 1'}
                </div>
                
                {/* Lives */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {Array.from({ length: ui.lives }).map((_, i) => (
                    <div key={i} style={{ 
                      width: 27, 
                      height: 27, 
                      background: 'linear-gradient(135deg, #ffffff, #cccccc)', 
                      clipPath: 'polygon(50% 0%, 61% 10%, 73% 10%, 83% 21%, 83% 36%, 50% 69%, 17% 36%, 17% 21%, 27% 10%, 39% 10%)', 
                      filter: 'drop-shadow(0 0 12px rgba(255,255,255,0.9))'
                    }} />
                  ))}
                </div>
              </div>
                
              {/* HP Bar */}
              <div>
                <div style={{ 
                  fontSize: 15, 
                  color: '#c0c0c0', 
                  marginBottom: 6, 
                  letterSpacing: 1.5,
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 800,
                  textShadow: '0 0 10px rgba(255,255,255,0.6), 2px 2px 0 rgba(0,0,0,0.9)'
                }}>
                  <span>HEALTH</span>
                  <span style={{ color: '#ffffff', textShadow: '0 0 15px rgba(255,255,255,0.9), 2px 2px 0 rgba(0,0,0,0.9)', fontWeight: 900 }}>{Math.ceil(ui.hp)}/{ui.maxHp}</span>
                </div>
                <div style={{ 
                  height: 24, 
                  background: 'rgba(0,0,0,0.9)', 
                  overflow: 'hidden', 
                  border: '3px solid rgba(200,200,200,0.7)', 
                  position: 'relative', 
                  borderRadius: 8,
                  boxShadow: '0 0 10px rgba(255,255,255,0.4), inset 0 2px 8px rgba(0,0,0,0.8)'
                }}>
                  <div style={{ 
                    height: '100%', 
                    width: `${Math.max(0, Math.min(1, ui.hp / ui.maxHp)) * 100}%`, 
                    background: ui.hp > ui.maxHp * 0.3 
                      ? 'linear-gradient(90deg, #ffffff, #e0e0e0)' 
                      : 'linear-gradient(90deg, #aaaaaa, #888888)',
                    boxShadow: '0 0 15px rgba(255,255,255,0.8), inset 0 1px 0 rgba(255,255,255,0.5)',
                    transition: 'width 0.2s ease, background 0.3s ease',
                    position: 'relative'
                  }}>
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.3), transparent 50%, rgba(0,0,0,0.2))' }} />
                  </div>
                </div>
              </div>

              {/* Shield - Compact horizontal */}
              <div style={{ display: 'flex', gap: 10 }}>
                {/* Shield */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: '#b0b0b0', marginBottom: 4, letterSpacing: 1, fontWeight: 800, textShadow: '0 0 8px rgba(255,255,255,0.5), 2px 2px 0 rgba(0,0,0,0.9)', textAlign: 'left' }}>SHIELD</div>
                  <div style={{ 
                    height: 10, 
                    background: 'rgba(0,0,0,0.9)', 
                    overflow: 'hidden', 
                    border: '2px solid rgba(180,180,180,0.6)', 
                    borderRadius: 6,
                    boxShadow: '0 0 8px rgba(255,255,255,0.3), inset 0 2px 6px rgba(0,0,0,0.8)'
                  }}>
                    <div style={{ 
                      height: '100%', 
                      width: `${Math.max(0, Math.min(1, ui.shield / 100)) * 100}%`, 
                      background: 'linear-gradient(90deg, #e0e0e0, #b0b0b0)', 
                      boxShadow: '0 0 12px rgba(220,220,220,0.8), inset 0 1px 0 rgba(255,255,255,0.4)',
                      transition: 'width 0.2s ease'
                    }} />
                  </div>
                </div>
                
                  </div>
                </div>
              </div>
          {/* Combo/Overdrive banner */}
          {(ui.combo > 0 || ui.overdriveMs > 0) && (
            <div style={{ 
              position: 'absolute', 
              top: '40%', 
              left: '50%', 
              transform: 'translate(-50%, -50%)', 
              padding: '16px 40px', 
              background: ui.overdriveMs > 0 
                ? 'rgba(255,200,0,0.15)' 
                : 'rgba(255,100,0,0.15)',
              backdropFilter: 'blur(8px)',
              border: '3px solid ' + (ui.overdriveMs > 0 ? '#ffcc00' : '#ff8800'),
              borderRadius: 6,
              color: ui.overdriveMs > 0 ? '#ffff00' : '#ffaa44', 
              fontWeight: 700, 
              boxShadow: ui.overdriveMs > 0 
                ? '0 0 40px rgba(255,200,0,0.6), 0 8px 30px rgba(0,0,0,0.5)'
                : '0 0 30px rgba(255,136,0,0.5), 0 8px 30px rgba(0,0,0,0.5)',
              textShadow: '0 0 20px ' + (ui.overdriveMs > 0 ? 'rgba(255,200,0,0.9)' : 'rgba(255,136,0,0.9)') + ', 2px 2px 4px rgba(0,0,0,0.9)', 
              fontSize: 18, 
              fontFamily: 'Press Start 2P', 
              letterSpacing: 2,
              animation: ui.overdriveMs > 0 ? 'pulse-glow 0.5s ease-in-out infinite' : 'none'
            }}>
              {ui.overdriveMs > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span style={{ fontSize: 20, filter: 'drop-shadow(0 0 10px rgba(255,200,0,0.8))' }}>*</span>
                  <span>OVERDRIVE</span>
                  <span style={{ fontSize: 20, filter: 'drop-shadow(0 0 10px rgba(255,200,0,0.8))' }}>*</span>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 14 }}>COMBO</span>
                  <span style={{ fontSize: 24, color: '#ffffff' }}>x{1 + Math.min(4, Math.floor(ui.combo / 5))}</span>
                  <span style={{ fontSize: 10, color: '#ffaa77', opacity: 0.8 }}>{(ui.comboTimerMs/1000).toFixed(1)}s</span>
                </div>
              )}
            </div>
          )}

          {/* Bottom-left corner UI: Pause button */}
          <div style={{
            position: 'absolute',
            bottom: 20,
            left: 20,
            pointerEvents: 'auto'
          }}>
            <button 
              onClick={() => { const c: any = canvasRef.current; if (c && c._togglePause) c._togglePause(); }} 
              className="matrix-button pixel hud-action-button" 
              style={{ 
                background: 'rgba(0,0,0,0.75)', 
                backdropFilter: 'blur(4px)',
                border: '2px solid rgba(200,200,200,0.6)', 
                borderRadius: 4,
                color: '#ffffff', 
                padding: '10px 18px', 
                fontFamily: 'Press Start 2P', 
                cursor: 'pointer', 
                textShadow: '0 0 8px rgba(255,255,255,0.6), 0 2px 6px rgba(0,0,0,0.8)', 
                fontSize: 9, 
                fontWeight: 700, 
                letterSpacing: 1,
                transition: 'all 0.2s ease',
                boxShadow: '0 0 15px rgba(255,255,255,0.2), 0 4px 15px rgba(0,0,0,0.5)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.9)';
                e.currentTarget.style.boxShadow = '0 0 20px rgba(255,255,255,0.5), 0 4px 15px rgba(0,0,0,0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(0,0,0,0.75)';
                e.currentTarget.style.borderColor = 'rgba(200,200,200,0.6)';
                e.currentTarget.style.boxShadow = '0 0 15px rgba(255,255,255,0.2), 0 4px 15px rgba(0,0,0,0.5)';
              }}>
              {isPaused ? 'RESUME' : 'PAUSE'}
          </button>
          </div>

          {/* Debug Panel Toggle Button */}
          <div style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            pointerEvents: 'auto'
          }}>
            <button 
              onClick={() => setShowDebugPanel(!showDebugPanel)} 
              className="matrix-button pixel hud-action-button" 
              style={{ 
                background: 'rgba(0,0,0,0.75)', 
                backdropFilter: 'blur(4px)',
                border: '2px solid rgba(200,200,200,0.6)', 
                borderRadius: 4,
                color: '#ffffff', 
                padding: '10px 18px', 
                fontFamily: 'Press Start 2P', 
                cursor: 'pointer', 
                textShadow: '0 0 8px rgba(255,255,255,0.6), 0 2px 6px rgba(0,0,0,0.8)', 
                fontSize: 9, 
                fontWeight: 700, 
                letterSpacing: 1,
                transition: 'all 0.2s ease',
                boxShadow: '0 0 15px rgba(255,255,255,0.2), 0 4px 15px rgba(0,0,0,0.5)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.9)';
                e.currentTarget.style.boxShadow = '0 0 20px rgba(255,255,255,0.5), 0 4px 15px rgba(0,0,0,0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(0,0,0,0.75)';
                e.currentTarget.style.borderColor = 'rgba(200,200,200,0.6)';
                e.currentTarget.style.boxShadow = '0 0 15px rgba(255,255,255,0.2), 0 4px 15px rgba(0,0,0,0.5)';
              }}>
              {showDebugPanel ? 'CLOSE DEBUG' : 'DEBUG'}
            </button>
          </div>
          {/* Debug Panel */}
          {showDebugPanel && (
            <div style={{
              position: 'absolute',
              top: '50%',
              right: 20,
              transform: 'translateY(-50%)',
              background: 'rgba(0,0,0,0.9)',
              backdropFilter: 'blur(10px)',
              border: '2px solid rgba(255,255,255,0.3)',
              borderRadius: 8,
              padding: '20px',
              color: '#ffffff',
              fontFamily: 'Press Start 2P',
              fontSize: 8,
              maxHeight: '80vh',
              overflowY: 'auto',
              pointerEvents: 'auto',
              boxShadow: '0 0 30px rgba(0,0,0,0.8)',
              minWidth: 250
            }}>
              <h3 style={{ 
                margin: '0 0 15px 0', 
                fontSize: 10, 
                color: '#ffcc00',
                textShadow: '0 0 10px rgba(255,200,0,0.8)',
                borderBottom: '2px solid rgba(255,200,0,0.3)',
                paddingBottom: 10
              }}>
                DEBUG RENDER LAYERS
              </h3>
              
              {Object.entries(settingsRef.current.debug).map(([key, value]) => (
                <div key={key} style={{ 
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}>
                  {typeof value === 'number' ? (
                    <>
                      <input
                        type="range"
                        min="0.5"
                        max="3.0"
                        step="0.1"
                        value={value}
                        onChange={(e) => {
                          (settingsRef.current.debug as any)[key] = parseFloat(e.target.value);
                          forceRerender((n: number) => n + 1);
                        }}
                        style={{
                          width: 100,
                          cursor: 'pointer',
                          accentColor: '#00ff00'
                        }}
                      />
                      <label style={{ 
                        cursor: 'pointer',
                        userSelect: 'none',
                        color: '#00ff00',
                        fontSize: 10
                      }}>
                        {key.replace('render', '').replace(/([A-Z])/g, ' $1').trim().toUpperCase()}: {value.toFixed(1)}
                      </label>
                    </>
                  ) : (
                    <>
                  <input
                    type="checkbox"
                        checked={value as boolean}
                    onChange={(e) => {
                      (settingsRef.current.debug as any)[key] = e.target.checked;
                      forceRerender((n: number) => n + 1);
                    }}
                    style={{
                      width: 16,
                      height: 16,
                      cursor: 'pointer',
                      accentColor: '#00ff00'
                    }}
                  />
                  <label style={{ 
                    cursor: 'pointer',
                    userSelect: 'none',
                    opacity: value ? 1 : 0.5,
                    color: value ? '#00ff00' : '#ff4444'
                  }}>
                    {key.replace('render', '').replace(/([A-Z])/g, ' $1').trim().toUpperCase()}
                  </label>
                    </>
                  )}
                </div>
              ))}
            

            {/* Collision Box Settings */}
            <div style={{
              marginTop: 20,
              paddingTop: 20,
              borderTop: '2px solid rgba(255,200,0,0.3)'
            }}>
              <h3 style={{
                marginTop: 0,
                marginBottom: 15,
                fontFamily: 'ui-monospace, monospace',
                fontSize: 10, 
                color: '#ff4d6d',
                textShadow: '0 0 10px rgba(255,77,109,0.8)',
              }}>
                COLLISION BOX SETTINGS
              </h3>

              {/* Player Collision */}
              <div style={{ marginBottom: 15 }}>
                <h4 style={{
                  margin: '0 0 8px 0',
                  fontSize: 9,
                  color: '#00ff00',
                  fontFamily: 'ui-monospace, monospace'
                }}>
                  PLAYER
                </h4>
                
                <div style={{ marginBottom: 5 }}>
                  <label style={{ fontSize: 9, color: '#ffcc00', display: 'block', marginBottom: 2 }}>
                    Width: {collisionSettingsRef.current.player.width}
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="1"
                    value={collisionSettingsRef.current.player.width}
                    onChange={(e) => {
                      collisionSettingsRef.current.player.width = parseInt(e.target.value);
                      forceRerender((n: number) => n + 1);
                    }}
                    style={{ width: '100%', accentColor: '#00ff00' }}
                  />
                </div>

                <div style={{ marginBottom: 5 }}>
                  <label style={{ fontSize: 9, color: '#ffcc00', display: 'block', marginBottom: 2 }}>
                    Height: {collisionSettingsRef.current.player.height}
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="150"
                    step="1"
                    value={collisionSettingsRef.current.player.height}
                    onChange={(e) => {
                      collisionSettingsRef.current.player.height = parseInt(e.target.value);
                      forceRerender((n: number) => n + 1);
                    }}
                    style={{ width: '100%', accentColor: '#00ff00' }}
                  />
                </div>

                <div style={{ marginBottom: 5 }}>
                  <label style={{ fontSize: 9, color: '#ffcc00', display: 'block', marginBottom: 2 }}>
                    Offset X: {collisionSettingsRef.current.player.offsetX}
                  </label>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    step="1"
                    value={collisionSettingsRef.current.player.offsetX}
                    onChange={(e) => {
                      collisionSettingsRef.current.player.offsetX = parseInt(e.target.value);
                      forceRerender((n: number) => n + 1);
                    }}
                    style={{ width: '100%', accentColor: '#00ff00' }}
                  />
                </div>

                <div style={{ marginBottom: 5 }}>
                  <label style={{ fontSize: 9, color: '#ffcc00', display: 'block', marginBottom: 2 }}>
                    Offset Y: {collisionSettingsRef.current.player.offsetY}
                  </label>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    step="1"
                    value={collisionSettingsRef.current.player.offsetY}
                    onChange={(e) => {
                      collisionSettingsRef.current.player.offsetY = parseInt(e.target.value);
                      forceRerender((n: number) => n + 1);
                    }}
                    style={{ width: '100%', accentColor: '#00ff00' }}
                  />
                </div>
              </div>

              {/* Enemy Collision */}
              <div style={{ marginBottom: 15 }}>
                <h4 style={{
                  margin: '0 0 8px 0',
                  fontSize: 9,
                  color: '#ff9966',
                  fontFamily: 'ui-monospace, monospace'
                }}>
                  ENEMY
                </h4>
                
                <div style={{ marginBottom: 5 }}>
                  <label style={{ fontSize: 9, color: '#ffcc00', display: 'block', marginBottom: 2 }}>
                    Width: {collisionSettingsRef.current.enemy.width}
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="1"
                    value={collisionSettingsRef.current.enemy.width}
                    onChange={(e) => {
                      collisionSettingsRef.current.enemy.width = parseInt(e.target.value);
                      forceRerender((n: number) => n + 1);
                    }}
                    style={{ width: '100%', accentColor: '#ff9966' }}
                  />
                </div>

                <div style={{ marginBottom: 5 }}>
                  <label style={{ fontSize: 9, color: '#ffcc00', display: 'block', marginBottom: 2 }}>
                    Height: {collisionSettingsRef.current.enemy.height}
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="150"
                    step="1"
                    value={collisionSettingsRef.current.enemy.height}
                    onChange={(e) => {
                      collisionSettingsRef.current.enemy.height = parseInt(e.target.value);
                      forceRerender((n: number) => n + 1);
                    }}
                    style={{ width: '100%', accentColor: '#ff9966' }}
                  />
                </div>

                <div style={{ marginBottom: 5 }}>
                  <label style={{ fontSize: 9, color: '#ffcc00', display: 'block', marginBottom: 2 }}>
                    Offset X: {collisionSettingsRef.current.enemy.offsetX}
                  </label>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    step="1"
                    value={collisionSettingsRef.current.enemy.offsetX}
                    onChange={(e) => {
                      collisionSettingsRef.current.enemy.offsetX = parseInt(e.target.value);
                      forceRerender((n: number) => n + 1);
                    }}
                    style={{ width: '100%', accentColor: '#ff9966' }}
                  />
                </div>

                <div style={{ marginBottom: 5 }}>
                  <label style={{ fontSize: 9, color: '#ffcc00', display: 'block', marginBottom: 2 }}>
                    Offset Y: {collisionSettingsRef.current.enemy.offsetY}
                  </label>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    step="1"
                    value={collisionSettingsRef.current.enemy.offsetY}
                    onChange={(e) => {
                      collisionSettingsRef.current.enemy.offsetY = parseInt(e.target.value);
                      forceRerender((n: number) => n + 1);
                    }}
                    style={{ width: '100%', accentColor: '#ff9966' }}
                  />
                </div>
              </div>
              {/* Buttons */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: 10 }}>
                <button
                  onClick={saveCollisionSettings}
                  style={{
                    flex: 1,
                    padding: '10px',
                    backgroundColor: '#00ff00',
                    color: '#000',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 10,
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    boxShadow: '0 0 20px rgba(0,255,0,0.5)',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#33ff33';
                    e.currentTarget.style.boxShadow = '0 0 30px rgba(0,255,0,0.8)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#00ff00';
                    e.currentTarget.style.boxShadow = '0 0 20px rgba(0,255,0,0.5)';
                  }}
                >
                  SAVE
                </button>
                
                <button
                  onClick={() => window.location.reload()}
                  style={{
                    flex: 1,
                    padding: '10px',
                    backgroundColor: '#ffaa00',
                    color: '#000',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 10,
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    boxShadow: '0 0 20px rgba(255,170,0,0.5)',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#ffcc33';
                    e.currentTarget.style.boxShadow = '0 0 30px rgba(255,170,0,0.8)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#ffaa00';
                    e.currentTarget.style.boxShadow = '0 0 20px rgba(255,170,0,0.5)';
                  }}
                >
                  RELOAD
                </button>
              </div>
              
              <div style={{
                fontSize: 8,
                color: '#888',
                fontFamily: 'ui-monospace, monospace',
                textAlign: 'center',
                marginTop: 5
              }}>
                Press F12 to see console logs
              </div>
            </div>
            </div>
          )}
        </>
      )}
      {/* Keybinding Editor Modal */}
      {keybindModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            pointerEvents: 'auto'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !listeningForKey) {
              setKeybindModalOpen(false);
            }
          }}
        >
          <div
            style={{
              maxWidth: '90vw',
              maxHeight: '85vh',
              width: 800,
              background: 'var(--grad-surface)',
              border: '3px outset var(--bevel-mid)',
              borderRadius: 0,
              padding: 0,
              boxShadow: 'var(--shadow-window)',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={(e) => e.stopPropagation()}
          >

            {/* Title Bar */}
            <div
              style={{
                background: 'var(--grad-titlebar)',
                color: 'var(--neutral-white)',
                padding: '6px 12px',
                fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                fontSize: 11,
                fontWeight: 700,
                borderBottom: '1px solid var(--border-dark)',
                textShadow: '1px 1px 0 rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span>Key Bindings</span>
              <button
                onClick={() => {
                  if (!listeningForKey) {
                    setKeybindModalOpen(false);
                  }
                }}
                style={{
                  padding: '2px 8px',
                  fontSize: 11,
                  fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: '1px solid var(--border-dark)',
                  borderRadius: 0,
                  background: 'var(--grad-button)',
                  color: 'var(--neutral-black)',
                  boxShadow: 'var(--shadow-raised)',
                  transition: 'none'
                }}
              >
                  Close
              </button>
            </div>
            
            {/* Content Area */}
            <div style={{ 
              padding: 16, 
              overflowY: 'auto',
              flex: 1
            }}>

            {/* Instructions */}
            {listeningForKey ? (
              <div
                style={{
                  padding: '12px',
                  marginBottom: 16,
                  background: 'var(--neutral-white)',
                  border: '3px solid var(--error)',
                  borderRadius: 0,
                  textAlign: 'center',
                  boxShadow: 'var(--shadow-window)'
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                    fontWeight: 700,
                    color: 'var(--neutral-black)',
                    marginBottom: 4
                  }}
                >
                  🎮 Press a key
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                    color: 'var(--neutral-black)',
                    opacity: 0.7
                  }}
                >
                  Press ESC to cancel
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: '12px',
                  marginBottom: 16,
                  background: 'var(--neutral-white)',
                  border: '2px inset var(--bevel-mid)',
                  borderRadius: 0,
                  fontSize: 11,
                  fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                  color: 'var(--neutral-black)',
                  lineHeight: 1.5,
                  boxShadow: 'var(--shadow-sunken)'
                }}
              >
                Click on a key slot to rebind it. You can assign up to 2 keys per action.
              </div>
            )}

            {/* Keybinding Sections */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {KEYBIND_SECTIONS.map((section) => (
                <div key={section.title}>
                  <div
                    style={{
                      margin: '0 0 8px 0',
                      padding: '4px 8px',
                      fontSize: 11,
                      fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                      fontWeight: 700,
                      color: 'var(--neutral-black)',
                      background: 'var(--grad-button)',
                      border: '1px solid var(--border-dark)',
                      borderRadius: 0,
                      boxShadow: 'var(--shadow-raised)'
                    }}
                  >
                    {section.title}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {section.actions.map((action) => {
                      const info = KEY_ACTION_INFO[action];
                      const bindings = keyBindings[action] || [];
                      return (
                        <div
                          key={action}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto',
                            gap: 12,
                            alignItems: 'center',
                            padding: '8px 12px',
                            background: 'var(--neutral-white)',
                            border: '2px inset var(--bevel-mid)',
                            borderRadius: 0,
                            boxShadow: 'var(--shadow-sunken)',
                            transition: 'none'
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                                fontWeight: 700,
                                color: 'var(--neutral-black)',
                                marginBottom: 2
                              }}
                            >
                              {info.label}
                            </div>
                            {info.description && (
                              <div
                                style={{
                                  fontSize: 10,
                                  fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                                  color: 'var(--neutral-black)',
                                  opacity: 0.6
                                }}
                              >
                                {info.description}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {[0, 1].map((slotIdx) => {
                              const key = bindings[slotIdx];
                              const isEditing = editingAction === action && editingSlot === slotIdx && listeningForKey;
                              return (
                                <button
                                  key={slotIdx}
                                  onClick={() => {
                                    if (!listeningForKey) {
                                      setEditingAction(action);
                                      setEditingSlot(slotIdx);
                                      setListeningForKey(true);
                                    }
                                  }}
                                  disabled={listeningForKey && !isEditing}
                                  style={{
                                    minWidth: 90,
                                    padding: '6px 12px',
                                    fontSize: 11,
                                    fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                                    fontWeight: 700,
                                    cursor: listeningForKey && !isEditing ? 'not-allowed' : 'pointer',
                                    border: isEditing
                                      ? '3px solid var(--error)'
                                      : key
                                      ? '2px outset var(--bevel-mid)'
                                      : '2px inset var(--bevel-mid)',
                                    borderRadius: 0,
                                    background: isEditing
                                      ? 'var(--neutral-white)'
                                      : key
                                      ? 'var(--grad-button)'
                                      : 'var(--neutral-white)',
                                    color: 'var(--neutral-black)',
                                    textShadow: 'none',
                                    opacity: listeningForKey && !isEditing ? 0.3 : 1,
                                    transition: 'none',
                                    boxShadow: isEditing 
                                      ? 'var(--shadow-window)' 
                                      : key 
                                      ? 'var(--shadow-raised)' 
                                      : 'var(--shadow-sunken)'
                                  }}
                                >
                                  {isEditing ? '...' : key ? prettyKeyLabel(key) : 'Unbound'}
                                </button>
                              );
                            })}
                            {bindings.length > 0 && (
                              <button
                                onClick={() => {
                                  if (!listeningForKey) {
                                    const newBindings = cloneBindings(keyBindings);
                                    newBindings[action] = [];
                                    setKeyBindings(newBindings);
                                  }
                                }}
                                disabled={listeningForKey}
                                title="Clear all bindings"
                                style={{
                                  padding: '6px 10px',
                                  fontSize: 11,
                                  fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                                  fontWeight: 700,
                                  cursor: listeningForKey ? 'not-allowed' : 'pointer',
                                  border: '2px outset var(--bevel-mid)',
                                  borderRadius: 0,
                                  background: 'var(--grad-button)',
                                  color: 'var(--neutral-black)',
                                  opacity: listeningForKey ? 0.3 : 1,
                                  transition: 'none',
                                  boxShadow: 'var(--shadow-raised)'
                                }}
                              >
                            Close
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer Actions */}
            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid var(--border-dark)',
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end'
              }}
            >
              <button
                onClick={() => {
                  if (!listeningForKey) {
                    setKeyBindings(cloneBindings(DEFAULT_KEY_BINDINGS));
                  }
                }}
                disabled={listeningForKey}
                style={{
                  padding: '8px 16px',
                  fontSize: 11,
                  fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                  fontWeight: 700,
                  cursor: listeningForKey ? 'not-allowed' : 'pointer',
                  border: '2px outset var(--bevel-mid)',
                  borderRadius: 0,
                  background: 'var(--grad-button)',
                  color: 'var(--neutral-black)',
                  opacity: listeningForKey ? 0.3 : 1,
                  transition: 'none',
                  boxShadow: 'var(--shadow-raised)'
                }}
              >
                    Reset to Defaults
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Dialog Component */}
      {dialogMessage && (
        <Dialog
          title={dialogMessage.title}
          message={dialogMessage.message}
          type={dialogMessage.type}
          onClose={() => setDialogMessage(null)}
        />
      )}
      
      {/* Join Lobby Prompt */}
      {showJoinPrompt && (
        <PromptDialog
          title="Join Lobby"
          message="Enter lobby code:"
          placeholder="Lobby code"
          onConfirm={(code) => {
            setShowJoinPrompt(false);
            handleJoinLobby(code, playerName || 'Player 1');
          }}
          onCancel={() => setShowJoinPrompt(false)}
        />
      )}
    </div>
  );
} 
