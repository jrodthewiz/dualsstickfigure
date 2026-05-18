/**
 * Suburbia Map Module
 * All suburbia-specific logic, rendering, and interactive elements
 * Uses Windows Classic grayscale theme
 */

import {
  WINDOWS_CLASSIC_COLORS,
  BUILDING_PALETTES,
  NATURE_COLORS,
  INTERACTIVE_COLORS,
  darkenGrayscale,
  grayscaleRgba,
} from "../../theme/mapThemes";

// ========== HOVER PLATFORM CONFIGURATION ==========

export type SuburbiaHoverMotion = 'static' | 'float' | 'drift';

export interface SuburbiaHoverPatternSlot {
  offset: number;
  altitudeBase: number;
  altitudeVariance: number;
  motion: SuburbiaHoverMotion;
  offsetJitter?: number;
  gap?: number;
  mirror?: boolean;
}

export const SUBURBAN_HOVER_PATTERNS: ReadonlyArray<{
  slots: SuburbiaHoverPatternSlot[];
}> = [
  {
    // Simple floating platforms - just a few for aerial movement
    slots: [
      { offset: -300, altitudeBase: 320, altitudeVariance: 40, motion: 'float', gap: 180 },
      { offset: 300, altitudeBase: 350, altitudeVariance: 50, motion: 'float', gap: 180 },
      { offset: 900, altitudeBase: 280, altitudeVariance: 30, motion: 'drift', offsetJitter: 60, gap: 180 },
    ],
  },
  {
    // Higher floating platforms for advanced players
    slots: [
      { offset: -600, altitudeBase: 420, altitudeVariance: 60, motion: 'drift', offsetJitter: 80, gap: 200 },
      { offset: 0, altitudeBase: 450, altitudeVariance: 70, motion: 'float', gap: 200 },
      { offset: 600, altitudeBase: 380, altitudeVariance: 50, motion: 'drift', offsetJitter: 70, gap: 200 },
    ],
  },
];

// Platform spacing constants for suburban map - INTELLIGENT for roof-to-roof jumping
export const SUBURBAN_TRACK_MARGIN = 120; // Optimized for roof-to-roof jumping
export const SUBURBAN_HOVER_MARGIN = 140; // Optimized for aerial house navigation

// ========== PLAYABLE AREA CONSTANTS ==========
// Suburbia map playable boundaries (from Maps.ts configuration)
const PLAYABLE_LEFT = 125;
const PLAYABLE_RIGHT = 2375;
const PLAYABLE_WIDTH = PLAYABLE_RIGHT - PLAYABLE_LEFT; // 2250px

// ========== SIMPLE NEIGHBORHOOD SYSTEM ==========

export interface SuburbanNeighborhoodHouse {
  x: number;
  y: number;
  width: number;
  height: number;
  roofY: number;
  style: 'basic' | 'floating';
  seed: number;
  isFloating?: boolean;
  floatOffset?: number;
}

export interface SuburbanNeighborhood {
  houses: SuburbanNeighborhoodHouse[];
  streetLevel: number;
}

/**
 * Generate a simple uniform neighborhood - all houses same height, lined up on flat ground
 */
export function generateSimpleNeighborhood(
  startX: number,
  endX: number,
  seededRandFunc: (seed: number, offset: number) => number
): SuburbanNeighborhood {
  const houses: SuburbanNeighborhoodHouse[] = [];
  
  let currentX = startX;
  let houseIndex = 0;
  
  while (currentX < endX) {
    const houseSeed = Math.floor(currentX / 100) + houseIndex;
    
    // Determine if this house floats
    const isFloating = seededRandFunc(houseSeed, 100) < SUBURBAN_HOUSE_CONFIG.FLOAT_CHANCE;
    const floatOffset = isFloating ? 
      SUBURBAN_HOUSE_CONFIG.FLOAT_MIN + seededRandFunc(houseSeed, 101) * (SUBURBAN_HOUSE_CONFIG.FLOAT_MAX - SUBURBAN_HOUSE_CONFIG.FLOAT_MIN) : 0;
    
    const house: SuburbanNeighborhoodHouse = {
      x: Math.floor(currentX),
      y: Math.floor(SUBURBAN_HOUSE_CONFIG.STREET_LEVEL - SUBURBAN_HOUSE_CONFIG.HEIGHT - floatOffset),
      width: SUBURBAN_HOUSE_CONFIG.WIDTH,
      height: SUBURBAN_HOUSE_CONFIG.HEIGHT,
      roofY: Math.floor(SUBURBAN_HOUSE_CONFIG.STREET_LEVEL - SUBURBAN_HOUSE_CONFIG.HEIGHT - floatOffset),
      style: isFloating ? 'floating' : 'basic',
      seed: houseSeed,
      isFloating: isFloating,
      floatOffset: floatOffset
    };
    
    houses.push(house);
    
    // Simple uniform spacing
    currentX += SUBURBAN_HOUSE_CONFIG.WIDTH + SUBURBAN_HOUSE_CONFIG.GAP;
    houseIndex++;
    
    // Safety check to prevent infinite loop
    if (houseIndex > 100) break;
  }
  
  return {
    houses: houses,
    streetLevel: SUBURBAN_HOUSE_CONFIG.STREET_LEVEL
  };
}

/**
 * SIMPLIFIED: Draw all houses from persistent neighborhood - no culling!
 */
export function drawNeighborhoodHouses(
  ctx: CanvasRenderingContext2D,
  suburbiaState: SuburbiaState,
  camera: { x: number; y: number },
  canvas: HTMLCanvasElement,
  totalTimeMs?: number
): void {
  // SIMPLIFIED: Just draw ALL houses - let the canvas handle culling
  suburbiaState.neighborhood.houses.forEach((house, index) => {
    drawNeighborhoodHouse(ctx, house, index, totalTimeMs);
  });
}

/**
 * SIMPLIFIED: Draw all street elements - no culling!
 */
export function drawStreetTacticalElements(
  ctx: CanvasRenderingContext2D,
  suburbiaState: SuburbiaState,
  camera: { x: number; y: number },
  canvas: HTMLCanvasElement
): void {
  // SIMPLIFIED: Just draw ALL street elements
  suburbiaState.streetPlatforms.forEach(element => {
    
    ctx.save();
    
    if (element.type === 'fire_hydrant') {
      // Fire hydrant - red/gray tactical cover
      ctx.fillStyle = 'rgba(120, 120, 120, 0.8)'; // Gray body
      ctx.fillRect(element.x, element.y, element.width, element.height);
      
      // Red cap
      ctx.fillStyle = 'rgba(80, 80, 80, 0.9)'; // Dark gray cap (grayscale theme)
      ctx.fillRect(element.x + 5, element.y, element.width - 10, 8);
      
      // Valve details
      ctx.strokeStyle = 'rgba(60, 60, 60, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(element.x + element.width/2, element.y + element.height/2, 6, 0, Math.PI * 2);
      ctx.stroke();
      
    } else if (element.type === 'bench') {
      // Bench - low tactical platform
      ctx.fillStyle = 'rgba(100, 100, 100, 0.7)'; // Gray bench
      ctx.fillRect(element.x, element.y, element.width, element.height);
      
      // Bench legs
      ctx.fillStyle = 'rgba(80, 80, 80, 0.8)';
      ctx.fillRect(element.x + 10, element.y + element.height - 2, 8, 15);
      ctx.fillRect(element.x + element.width - 18, element.y + element.height - 2, 8, 15);
      
      // Bench slats for detail
      ctx.strokeStyle = 'rgba(70, 70, 70, 0.6)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const slat = element.x + 10 + i * 15;
        ctx.beginPath();
        ctx.moveTo(slat, element.y);
        ctx.lineTo(slat, element.y + element.height);
        ctx.stroke();
      }
      
    } else if (element.type === 'manhole') {
      // Manhole cover - flush with street
      ctx.fillStyle = 'rgba(90, 90, 90, 0.9)'; // Dark gray manhole
      ctx.fillRect(element.x, element.y, element.width, element.height);
      
      // Grid pattern
      ctx.strokeStyle = 'rgba(70, 70, 70, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Horizontal lines
      ctx.moveTo(element.x + 5, element.y + element.height/2);
      ctx.lineTo(element.x + element.width - 5, element.y + element.height/2);
      // Vertical lines
      for (let i = 1; i < 4; i++) {
        const vline = element.x + (element.width * i / 4);
        ctx.moveTo(vline, element.y);
        ctx.lineTo(vline, element.y + element.height);
      }
      ctx.stroke();
    }
    
    ctx.restore();
  });
}

/**
 * Draw a neighborhood house - simplified uniform design with optional floating thrusters
 */
function drawNeighborhoodHouse(ctx: CanvasRenderingContext2D, house: SuburbanNeighborhoodHouse, index: number, totalTimeMs?: number): void {
  const { x, y, width, height, style, isFloating } = house;
  
  // Simple uniform colors
  const bodyColor = 'rgba(75, 75, 75, 0.8)'; // Uniform gray house
  const roofColor = 'rgba(50, 50, 50, 0.9)'; // Darker gray roof
  
  // Calculate positions
  const houseBottom = y + height;
  const houseTop = y;
  
  // Draw foundation only for ground houses
  if (!isFloating) {
    ctx.fillStyle = 'rgba(50, 50, 50, 0.8)'; // Foundation
    ctx.fillRect(x - 2, houseBottom - 3, width + 4, 5);
  }
  
  // Draw house body
  ctx.fillStyle = bodyColor;
  ctx.fillRect(x, houseTop, width, height);
  
  // Draw simple peaked roof
  ctx.fillStyle = roofColor;
  ctx.beginPath();
    ctx.moveTo(x - 6, houseTop);
    ctx.lineTo(x + width/2, houseTop - 18);
    ctx.lineTo(x + width + 6, houseTop);
  ctx.closePath();
  ctx.fill();
  
  // Simple windows (2 per house)
  ctx.fillStyle = 'rgba(160, 160, 160, 0.6)';
  const windowSize = 12;
  const windowY = houseTop + height * 0.4;
  const windowSpacing = width / 3;
  
  // Two windows evenly spaced
  ctx.fillRect(x + windowSpacing - windowSize/2, windowY, windowSize, windowSize);
  ctx.fillRect(x + windowSpacing * 2 - windowSize/2, windowY, windowSize, windowSize);
  
  // Simple door
  ctx.fillStyle = 'rgba(30, 30, 30, 0.8)';
  const doorWidth = 14;
  const doorHeight = 20;
    ctx.fillRect(x + width/2 - doorWidth/2, houseBottom - doorHeight, doorWidth, doorHeight);
  
  // Floating house thrusters and effects
  if (isFloating && totalTimeMs) {
    const thrusterFlame = Math.sin(totalTimeMs * 0.01 + index) * 0.3 + 0.7; // Animated flame
    
    // Thrusters underneath
    const thrusterCount = 3;
    const thrusterSpacing = width / (thrusterCount + 1);
    
    for (let i = 0; i < thrusterCount; i++) {
      const thrusterX = x + thrusterSpacing * (i + 1);
      const thrusterY = houseBottom;
      
      // Thruster body
      ctx.fillStyle = 'rgba(40, 40, 40, 0.9)';
      ctx.fillRect(thrusterX - 4, thrusterY, 8, 12);
      
      // Animated thruster flame
      const flameHeight = 8 + thrusterFlame * 6;
      const flameAlpha = 0.4 + thrusterFlame * 0.3;
      
      // Blue thruster flame
      ctx.fillStyle = `rgba(100, 150, 255, ${flameAlpha})`;
    ctx.beginPath();
      ctx.moveTo(thrusterX - 3, thrusterY + 12);
      ctx.lineTo(thrusterX, thrusterY + 12 + flameHeight);
      ctx.lineTo(thrusterX + 3, thrusterY + 12);
      ctx.closePath();
      ctx.fill();
      
      // Inner white hot core
      ctx.fillStyle = `rgba(200, 220, 255, ${flameAlpha * 0.8})`;
    ctx.beginPath();
      ctx.moveTo(thrusterX - 1, thrusterY + 12);
      ctx.lineTo(thrusterX, thrusterY + 12 + flameHeight * 0.7);
      ctx.lineTo(thrusterX + 1, thrusterY + 12);
      ctx.closePath();
      ctx.fill();
    }
    
    // Floating house glow effect
    ctx.fillStyle = 'rgba(100, 150, 255, 0.1)';
    ctx.fillRect(x - 4, houseTop - 4, width + 8, height + 8);
  } else if (!isFloating) {
    // Ground shadow for non-floating houses
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(x, houseBottom - 2, width, 2);
  }
}

/**
 * Generate ALL platforms from suburbia state - both roof and street platforms
 * This is the SINGLE SOURCE OF TRUTH for all suburban platforms
 */
export function generateAllSuburbanPlatforms(suburbiaState: SuburbiaState): Array<{
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  house?: SuburbanNeighborhoodHouse;
}> {
  const platforms: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    type: string;
    house?: SuburbanNeighborhoodHouse;
  }> = [];
  
  // ROOF PLATFORMS - optimized for jumping and combat
  suburbiaState.neighborhood.houses.forEach(house => {
    const streetLevel = 680;
    const roofY = streetLevel - house.height; // Top of house body
    
    // Main roof platform
    platforms.push({
      x: house.x,
      y: roofY - 10, // Slightly thicker platform for better landing
      width: house.width,
      height: 10, // Solid landing surface
      type: 'roof',
      house: house
    });
    
    // Simple uniform roof platforms - no style-specific extras needed
  });
  
  // STREET-LEVEL TACTICAL PLATFORMS
  suburbiaState.streetPlatforms.forEach(element => {
    platforms.push({
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      type: element.type
    });
  });
  
  // GROUND LEVEL PLATFORM - the street itself
  const streetLevel = 680;
  platforms.push({
    x: -10000, // Very wide street platform
    y: streetLevel,
    width: 20000,
    height: 20, // Thick ground platform
    type: 'street'
  });
  
  return platforms;
}

/**
 * Legacy function for compatibility - now uses persistent neighborhood
 */
export function generateNeighborhoodPlatforms(neighborhood: SuburbanNeighborhood): Array<{
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'roof';
  house: SuburbanNeighborhoodHouse;
}> {
  return neighborhood.houses.map(house => {
    const streetLevel = 680;
    const roofY = streetLevel - house.height; // Top of house body
    
    return {
      x: house.x,
      y: roofY - 10, // Platform sits on roof surface
      width: house.width,
      height: 10, // Solid platform
      type: 'roof' as const,
      house: house
    };
  });
}

/**
 * Get the persistent neighborhood from suburbia state
 * NO MORE per-frame generation - use the persistent data!
 */
export function getCurrentNeighborhood(
  suburbiaState: SuburbiaState
): SuburbanNeighborhood {
  return suburbiaState.neighborhood;
}

/**
 * DEPRECATED: No longer used - we draw all houses now
 * Kept for compatibility only
 */
export function getVisibleHouses(
  neighborhood: SuburbanNeighborhood,
  camera: { x: number; y: number },
  canvas: HTMLCanvasElement
): SuburbanNeighborhoodHouse[] {
  // Return all houses - no culling
  return neighborhood.houses;
}

// ========== INTERACTIVE ELEMENTS ==========

export interface SuburbiaBalloon {
  id: string;
  worldX: number;
  worldY: number;
  scale: number;
  color: string;
  destroyed: boolean;
  explodeOnTouch: boolean;
}

export interface SuburbiaKite {
  id: string;
  worldX: number;
  worldY: number;
  color: string;
  destroyed: boolean;
  explodeOnTouch: boolean;
}

export interface SuburbiaState {
  balloons: SuburbiaBalloon[];
  kites: SuburbiaKite[];
  initialized: boolean;
  neighborhood: SuburbanNeighborhood; // PERSISTENT neighborhood for consistent rendering and platforms
  streetPlatforms: Array<{x: number; y: number; width: number; height: number; type: string}>; // Street-level tactical elements
}

// ========== SIMPLIFIED SUBURBAN HOUSE CONFIGURATION ==========
// Simple uniform constants for the cleaned up house system

export const SUBURBAN_HOUSE_CONFIG = {
  // Uniform house dimensions
  WIDTH: 200,                     // All houses same width
  HEIGHT: 160,                    // All houses same height  
  GAP: 100,                       // Uniform gap between houses
  STREET_LEVEL: 680,              // Fixed flat street level
  
  // Floating house settings
  FLOAT_CHANCE: 0.2,              // 20% chance for floating houses
  FLOAT_MIN: 40,                  // Minimum float height
  FLOAT_MAX: 60,                  // Maximum float height
};

/**
 * Get simple uniform dimensions for all suburban houses
 */
export function getSuburbanHouseDimensions() {
  return {
    width: SUBURBAN_HOUSE_CONFIG.WIDTH,
    height: SUBURBAN_HOUSE_CONFIG.HEIGHT,
    gap: SUBURBAN_HOUSE_CONFIG.GAP,
    streetLevel: SUBURBAN_HOUSE_CONFIG.STREET_LEVEL
  };
}

// Removed complex structure dimensions - using uniform houses only

/**
 * Background Decorative House Dimensions (Parallax layer)
 * These are purely visual and not interactive
 */
export const SUBURBAN_BACKGROUND_CONFIG = {
  MIN_WIDTH: 55,
  WIDTH_RANGE: 50,     // 55-105 total
  MIN_HEIGHT: 35,
  HEIGHT_RANGE: 50,    // 35-85 total
};

const GROUND_Y = 680;

/**
 * Initialize suburbia state with interactive elements and PERSISTENT neighborhood
 * CRITICAL: This creates the neighborhood ONCE - houses should never spawn/despawn after this!
 * FIXED: Ensured truly persistent neighborhood generation
 */
export function createSuburbiaState(): SuburbiaState {
  const balloons: SuburbiaBalloon[] = [];
  const balloonColors = [INTERACTIVE_COLORS.balloon1, INTERACTIVE_COLORS.balloon2, INTERACTIVE_COLORS.balloon3];
  
  // OPTIMIZED: Only create balloons within playable boundaries
  
  // Create 3 balloons at positions within playable area
  for (let i = 0; i < 3; i++) {
    const balloonX = PLAYABLE_LEFT + 200 + i * (PLAYABLE_WIDTH - 400) / 2; // Spread evenly within bounds
    balloons.push({
      id: `balloon-${i}`,
      worldX: balloonX,
      worldY: GROUND_Y - 150, // Just above trees
      scale: 0.9 + i * 0.1,
      color: balloonColors[i],
      destroyed: false,
      explodeOnTouch: Math.random() < 0.6, // 60% explode
    });
  }
  
  const kites: SuburbiaKite[] = [];
  const kiteColors = [INTERACTIVE_COLORS.kite1, INTERACTIVE_COLORS.kite2, INTERACTIVE_COLORS.kite3, INTERACTIVE_COLORS.kite4];
  
  // OPTIMIZED: Only create kites within playable boundaries
  // Create 3 kites (reduced count) at positions within playable area
  for (let i = 0; i < 3; i++) {
    const kiteX = PLAYABLE_LEFT + 300 + i * (PLAYABLE_WIDTH - 600) / 2; // Spread evenly within bounds
    kites.push({
      id: `kite-${i}`,
      worldX: kiteX,
      worldY: GROUND_Y - 120, // Lower than balloons
      color: kiteColors[i],
      destroyed: false,
      explodeOnTouch: Math.random() < 0.4, // 40% explode
    });
  }
  
  // PERSISTENT NEIGHBORHOOD: Generate once, reuse everywhere  
  // OPTIMIZED: Only generate within playable boundaries (125 to 2375)
  const neighborhood = generatePersistentNeighborhood(PLAYABLE_LEFT, PLAYABLE_RIGHT);
  
  // STREET-LEVEL COMBAT ELEMENTS: Add tactical platforms at street level
  const streetPlatforms = generateStreetTacticalElements(neighborhood);
  
  return { balloons, kites, initialized: true, neighborhood, streetPlatforms };
}

// Alias for compatibility
export const initializeSuburbiaState = createSuburbiaState;

/**
 * MASTER INTEGRATION FUNCTION: Render complete suburbia neighborhood system
 * Call this from the main game to render houses and street elements
 */
export function renderSuburbiaNeighborhood(
  ctx: CanvasRenderingContext2D,
  suburbiaState: SuburbiaState,
  camera: { x: number; y: number },
  canvas: HTMLCanvasElement,
  totalTimeMs?: number
): void {
  // 1. Draw the persistent neighborhood houses with thruster animations
  drawNeighborhoodHouses(ctx, suburbiaState, camera, canvas, totalTimeMs);
  
  // 2. Draw street-level tactical elements  
  drawStreetTacticalElements(ctx, suburbiaState, camera, canvas);
}

/**
 * MASTER PLATFORM FUNCTION: Get all platforms for collision system
 * Call this instead of the old platform generation functions
 */
export function getSuburbanPlatformsForCollision(suburbiaState: SuburbiaState): Array<{
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  house?: SuburbanNeighborhoodHouse;
}> {
  return generateAllSuburbanPlatforms(suburbiaState);
}

/**
 * Update balloon/kite positions with animation
 */
export function updateSuburbiaElements(state: SuburbiaState, totalTimeMs: number): void {
  // Update balloon floating
  state.balloons.forEach((balloon, i) => {
    if (!balloon.destroyed) {
      balloon.worldY = (GROUND_Y - 150) + Math.sin(totalTimeMs * 0.001 + i) * 12;
    }
  });
  
  // Update kite swaying
  state.kites.forEach((kite, i) => {
    if (!kite.destroyed) {
      const swayX = Math.sin(totalTimeMs * 0.003 + i * 0.8) * 30;
      const swayY = Math.sin(totalTimeMs * 0.002 + i * 0.5) * 15;
      kite.worldX = (1200 + i * 1200) + swayX;
      kite.worldY = (GROUND_Y - 120) + swayY;
    }
  });
}

// Alias for compatibility
export const updateSuburbiaPlatforms = updateSuburbiaElements;

/**
 * SIMPLIFIED: Draw all interactive elements - minimal culling
 */
export function drawSuburbiaInteractives(
  ctx: CanvasRenderingContext2D,
  state: SuburbiaState,
  totalTimeMs: number,
  camera?: { x: number; y: number },
  canvas?: HTMLCanvasElement
): void {
  // SIMPLIFIED: No viewport culling - just draw everything
  
  // Draw balloons
  state.balloons.forEach((balloon, i) => {
    if (balloon.destroyed) return;
    
    // Calculate position once
    const floatOffset = Math.sin(totalTimeMs * 0.001 + i) * 12;
    const driftX = Math.sin(totalTimeMs * 0.0005 + i * 0.5) * 25;
    const bx = balloon.worldX + driftX;
    const by = balloon.worldY + floatOffset;
    
    ctx.save();
    ctx.translate(bx, by); // Use pre-calculated position
    ctx.scale(balloon.scale, balloon.scale);
    
    // Envelope - OPTIMIZED: solid color instead of gradient
    ctx.fillStyle = balloon.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 35, 45, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Basket (fill and stroke together)
    ctx.fillStyle = INTERACTIVE_COLORS.mailbox;
    ctx.fillRect(-10, 40, 20, 12);
    ctx.strokeStyle = WINDOWS_CLASSIC_COLORS.neutral700;
    ctx.lineWidth = 2;
    ctx.strokeRect(-10, 40, 20, 12);
    
    // Ropes (batch lines)
    ctx.beginPath();
    ctx.moveTo(-12, 20); ctx.lineTo(-8, 40);
    ctx.moveTo(12, 20); ctx.lineTo(8, 40);
    ctx.stroke();
    
    // Indicator - OPTIMIZED: solid color (grayscale warning)
    if (balloon.explodeOnTouch) {
      ctx.strokeStyle = WINDOWS_CLASSIC_COLORS.neutral200;
      ctx.lineWidth = 3;
      ctx.strokeRect(-12, 38, 24, 4);
    }
    
    ctx.restore();
  });
  
  // Draw kites
  state.kites.forEach((kite, i) => {
    if (kite.destroyed) return;
    
    // Calculate position once
    const swayX = Math.sin(totalTimeMs * 0.003 + i * 0.8) * 30;
    const swayY = Math.sin(totalTimeMs * 0.002 + i * 0.5) * 15;
    const kx = kite.worldX + swayX;
    const ky = kite.worldY + swayY;
    
    ctx.save();
    ctx.translate(kx, ky); // Use pre-calculated position
    ctx.rotate(Math.sin(totalTimeMs * 0.002 + i) * 0.2);
    
    // Diamond kite
    ctx.fillStyle = kite.color;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(12, 0);
    ctx.lineTo(0, 18);
    ctx.lineTo(-12, 0);
    ctx.closePath();
    ctx.fill();
    
    // Cross bars (batch both lines)
    ctx.strokeStyle = WINDOWS_CLASSIC_COLORS.neutral700;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-12, 0); ctx.lineTo(12, 0);
    ctx.moveTo(0, -18); ctx.lineTo(0, 18);
    ctx.stroke();
    
    // Tail - OPTIMIZED: Use darkenColor instead of alpha, batch rects
    const tailColor = darkenColor(kite.color, 15);
    ctx.fillStyle = tailColor;
    for (let r = 0; r < 3; r++) {
      ctx.fillRect(-4, 18 + r * 10, 8, 8);
    }
    
    // Indicator - OPTIMIZED: solid color (grayscale warning)
    if (kite.explodeOnTouch) {
      ctx.strokeStyle = WINDOWS_CLASSIC_COLORS.neutral200;
      ctx.lineWidth = 2;
      ctx.strokeRect(-14, -14, 28, 28);
    }
    
    ctx.restore();
  });
}

// Alias for compatibility
export const drawSuburbiaInteractivePlatforms = drawSuburbiaInteractives;

/**
 * Check player collision with interactive elements
 */
export function checkCollisions(
  state: SuburbiaState,
  playerX: number,
  playerY: number,
  playerRadius: number,
  onExplode: (x: number, y: number) => void
): void {
  // Check balloons
  state.balloons.forEach((balloon) => {
    if (balloon.destroyed) return;
    
    const dx = playerX - balloon.worldX;
    const dy = playerY - balloon.worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < playerRadius + 50 * balloon.scale && balloon.explodeOnTouch) {
      balloon.destroyed = true;
      onExplode(balloon.worldX, balloon.worldY);
    }
  });
  
  // Check kites
  state.kites.forEach((kite) => {
    if (kite.destroyed) return;
    
    const dx = playerX - kite.worldX;
    const dy = playerY - kite.worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < playerRadius + 25 && kite.explodeOnTouch) {
      kite.destroyed = true;
      onExplode(kite.worldX, kite.worldY);
    }
  });
}

// Alias for compatibility
export const checkSuburbiaCollisionsForExplosions = checkCollisions;

/**
 * Get collision platforms from suburbia elements
 */
export function getCollisionPlatforms(state: SuburbiaState, totalTimeMs: number): Array<{x: number; y: number; width: number; height: number}> {
  const platforms: Array<{x: number; y: number; width: number; height: number}> = [];
  
  // Balloon basket platforms
  state.balloons.forEach((balloon, i) => {
    if (balloon.destroyed) return;
    
    const floatOffset = Math.sin(totalTimeMs * 0.001 + i) * 12;
    const driftX = Math.sin(totalTimeMs * 0.0005 + i * 0.5) * 25;
    const platformY = (balloon.worldY + floatOffset + 40 * balloon.scale);
    
    platforms.push({
      x: (balloon.worldX + driftX) - 30 * balloon.scale,
      y: platformY,
      width: 60 * balloon.scale,
      height: 8,
    });
  });
  
  // Kite platforms
  state.kites.forEach((kite, i) => {
    if (kite.destroyed) return;
    
    platforms.push({
      x: kite.worldX - 25,
      y: kite.worldY,
      width: 50,
      height: 8,
    });
  });
  
  return platforms;
}

// ========== PERSISTENT NEIGHBORHOOD SYSTEM ==========

/**
 * FIXED: Generate a simple, consistent row of houses - deterministic and clean
 * Called ONCE during initialization - houses never change after this!
 */
export function generatePersistentNeighborhood(
  startX: number,
  endX: number
): SuburbanNeighborhood {
  const houses: SuburbanNeighborhoodHouse[] = [];
  const houseWidth = SUBURBAN_HOUSE_CONFIG.WIDTH;
  const houseHeight = SUBURBAN_HOUSE_CONFIG.HEIGHT;
  const gap = SUBURBAN_HOUSE_CONFIG.GAP;
  const streetLevel = SUBURBAN_HOUSE_CONFIG.STREET_LEVEL;
  
  // Calculate total houses that can fit
  const totalWidth = endX - startX;
  const houseSlotWidth = houseWidth + gap;
  const numHouses = Math.floor(totalWidth / houseSlotWidth);
  
  // Pre-define which houses should float (fixed pattern, not random)
  // Every 4th house floats, starting from index 2
  const floatingIndices = new Set<number>();
  for (let i = 2; i < numHouses; i += 4) {
    floatingIndices.add(i);
  }
  
  // Generate houses in a simple, deterministic row
  for (let i = 0; i < numHouses; i++) {
    const x = startX + i * houseSlotWidth;
    const isFloating = floatingIndices.has(i);
    const floatHeight = isFloating ? 50 : 0; // Fixed 50px float for floating houses
    
    houses.push({
      x: Math.floor(x),
      y: Math.floor(streetLevel - houseHeight - floatHeight),
      width: houseWidth,
      height: houseHeight,
      roofY: Math.floor(streetLevel - houseHeight - floatHeight),
      style: isFloating ? 'floating' : 'basic',
      seed: i * 100, // Simple seed based on index
      isFloating: isFloating,
      floatOffset: floatHeight
    });
  }
  
  return {
    houses: houses,
    streetLevel: streetLevel
  };
}

/**
 * Generate street-level tactical combat elements
 */
export function generateStreetTacticalElements(neighborhood: SuburbanNeighborhood): Array<{
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
}> {
  const elements: Array<{x: number; y: number; width: number; height: number; type: string}> = [];
  const streetLevel = neighborhood.streetLevel;
  
  // Add tactical elements between houses
  for (let i = 0; i < neighborhood.houses.length - 1; i++) {
    const house1 = neighborhood.houses[i];
    const house2 = neighborhood.houses[i + 1];
    const gapStart = house1.x + house1.width;
    const gapEnd = house2.x;
    const gapCenter = (gapStart + gapEnd) / 2;
    const gapWidth = gapEnd - gapStart;
    
    // Only add elements if there's enough space
    if (gapWidth > 60) {
      const elementSeed = house1.seed + house2.seed;
      const elementType = seededRand(elementSeed, 200);
      
      if (elementType < 0.3) {
        // Fire hydrant - provides cover
        elements.push({
          x: gapCenter - 15,
          y: streetLevel - 25,
          width: 30,
          height: 25,
          type: 'fire_hydrant'
        });
      } else if (elementType < 0.5) {
        // Bench - low platform for tactics
        elements.push({
          x: gapCenter - 40,
          y: streetLevel - 12,
          width: 80,
          height: 12,
          type: 'bench'
        });
      } else if (elementType < 0.7) {
        // Manhole cover - flush with street
        elements.push({
          x: gapCenter - 20,
          y: streetLevel - 2,
          width: 40,
          height: 2,
          type: 'manhole'
        });
      }
      // Otherwise leave gap empty for clear combat space
    }
  }
  
  return elements;
}

// ========== Helper Functions ==========

function seededRand(seed: number, offset: number): number {
  const x = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function darkenColor(color: string, percent: number): string {
  const num = parseInt(color.replace("#",""), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) - amt;
  const G = (num >> 8 & 0x00FF) - amt;
  const B = (num & 0x0000FF) - amt;
  return "#" + (0x1000000 + (R<1?0:R>255?255:R)*0x10000 + (G<1?0:G>255?255:G)*0x100 + (B<1?0:B>255?255:B)).toString(16).slice(1);
}

// ========== Background Decorations Rendering ==========

/**
 * Draw all suburban decorative elements (trees, flowers, mailboxes, etc.)
 * OPTIMIZED for performance with batched draw calls and minimal state changes
 */
export function drawSuburbanDecor(
  ctx: CanvasRenderingContext2D,
  camera: { x: number; y: number },
  world: { baseGroundY: number },
  canvas: HTMLCanvasElement,
  totalTimeMs: number
): void {
  ctx.save();
  const groundY = world.baseGroundY;
  
  // SIMPLIFIED: Basic decoration range within playable area
  const decorX0 = Math.floor((camera.x - 500) / 120) * 120;
  const decorX1 = Math.ceil((camera.x + canvas.clientWidth + 500) / 120) * 120;
  
  for (let x = decorX0; x <= decorX1; x += 120) {
    const decorSeed = Math.abs(Math.floor(x / 10));
    const decorRand = seededRand(decorSeed, 1);
    const xPos = x + seededRand(decorSeed, 2) * 80;
    // Use consistent ground Y instead of terrain undulation for decorations
    const yPos = groundY;
    
    // Much more variety in decoration types
    let decorType: string;
    if (decorRand < 0.25) {
      decorType = 'large_tree';
    } else if (decorRand < 0.4) {
      decorType = 'small_tree';
    } else if (decorRand < 0.5) {
      decorType = 'bush_cluster';
    } else if (decorRand < 0.65) {
      decorType = 'flowers';
    } else if (decorRand < 0.73) {
      decorType = 'fence_section';
    } else if (decorRand < 0.82) {
      decorType = 'mailbox';
    } else if (decorRand < 0.90) {
      decorType = 'pathway';
    } else {
      decorType = 'garden_rock';
    }
    
    if (decorType === 'large_tree') {
      // Enhanced large tree - OPTIMIZED: solid colors, batched draws, minimal animations
      const trunkWidth = 16;
      const trunkHeight = 80;
      const sway = Math.sin(totalTimeMs * 0.001 + decorSeed) * 3; // Pre-calc sway
      
      // Trunk - solid color instead of gradient for performance
      ctx.fillStyle = NATURE_COLORS.treeTrunk;
      ctx.save();
      ctx.translate(xPos, yPos - trunkHeight);
      ctx.rotate(sway * Math.PI / 180);
      ctx.fillRect(-trunkWidth/2, 0, trunkWidth, trunkHeight);
      ctx.restore();
      
      // Foliage - batch all dark circles together (grayscale)
      ctx.fillStyle = NATURE_COLORS.treeFoliageDark;
      ctx.beginPath();
      ctx.arc(xPos + sway, yPos - trunkHeight - 10, 40, 0, Math.PI * 2);
      ctx.fill();
      
      // Mid gray - batch two circles in one fillStyle assignment
      ctx.fillStyle = NATURE_COLORS.treeFoliageMid;
      ctx.beginPath();
      ctx.arc(xPos - 20 + sway * 0.6, yPos - trunkHeight + 15, 35, 0, Math.PI * 2);
      ctx.arc(xPos + 20 + sway * 0.6, yPos - trunkHeight + 15, 35, 0, Math.PI * 2);
      ctx.fill();
      
      // Light gray highlight - single arc
      ctx.fillStyle = NATURE_COLORS.treeFoliageLight;
      ctx.beginPath();
      ctx.arc(xPos + sway * 0.8, yPos - trunkHeight - 5, 30, 0, Math.PI * 2);
      ctx.fill();
      
    } else if (decorType === 'small_tree') {
      ctx.fillStyle = NATURE_COLORS.treeTrunk;
      ctx.fillRect(xPos - 4, yPos - 35, 8, 35);
      
      ctx.fillStyle = NATURE_COLORS.treeFoliageLight;
      ctx.beginPath();
      ctx.arc(xPos, yPos - 30, 18, 0, Math.PI * 2);
      ctx.fill();
      
    } else if (decorType === 'bush_cluster') {
      // OPTIMIZED: Batch ellipses by color (grayscale)
      ctx.fillStyle = NATURE_COLORS.grassLight;
      ctx.beginPath();
      ctx.ellipse(xPos - 15, yPos - 12, 15, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(xPos + 15, yPos - 12, 15, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = NATURE_COLORS.treeFoliageLight;
      ctx.beginPath();
      ctx.ellipse(xPos, yPos - 15, 18, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      
    } else if (decorType === 'flowers') {
      // OPTIMIZED: Batch stems, then batch petals by color (grayscale)
      const flowerColors = [
        NATURE_COLORS.flower1, 
        NATURE_COLORS.flower2, 
        NATURE_COLORS.flower3, 
        NATURE_COLORS.flower4, 
        NATURE_COLORS.flower5, 
        NATURE_COLORS.flower6
      ];
      
      // Draw all stems at once
      ctx.strokeStyle = NATURE_COLORS.treeFoliageMid;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const fx = xPos + (i - 2.5) * 10;
        const fy = yPos - 5;
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx, yPos);
      }
      ctx.stroke();
      
      // Draw petals grouped by color
      for (let c = 0; c < flowerColors.length; c++) {
        ctx.fillStyle = flowerColors[c];
        ctx.beginPath();
        for (let i = c; i < 6; i += flowerColors.length) {
          const fx = xPos + (i - 2.5) * 10;
          const fy = yPos - 5;
          ctx.arc(fx, fy, 5, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      
      // Draw all centers at once
      ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral200;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const fx = xPos + (i - 2.5) * 10;
        const fy = yPos - 5;
        ctx.arc(fx, fy, 2, 0, Math.PI * 2);
      }
      ctx.fill();
      
    } else if (decorType === 'fence_section') {
      // OPTIMIZED: Batch all fence lines together
      ctx.strokeStyle = INTERACTIVE_COLORS.fence;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(xPos - 25, yPos - 30);
      ctx.lineTo(xPos + 25, yPos - 30);
      for (let post = 0; post < 3; post++) {
        const px = xPos - 25 + post * 25;
        ctx.moveTo(px, yPos - 30);
        ctx.lineTo(px, yPos);
      }
      ctx.stroke();
      
    } else if (decorType === 'mailbox') {
      // Post
      ctx.fillStyle = NATURE_COLORS.treeTrunk;
      ctx.fillRect(xPos - 2, yPos - 20, 4, 20);
      
      // Box body and top
      ctx.fillStyle = INTERACTIVE_COLORS.mailbox;
      ctx.fillRect(xPos - 10, yPos - 22, 20, 12);
      ctx.beginPath();
      ctx.arc(xPos, yPos - 22, 10, Math.PI, 0, false);
      ctx.fill();
      
      // Flag
      ctx.fillStyle = INTERACTIVE_COLORS.mailboxFlag;
      ctx.fillRect(xPos + 8, yPos - 26, 6, 4);
      
    } else if (decorType === 'pathway') {
      // OPTIMIZED: Batch all stones together
      ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral200;
      ctx.beginPath();
      for (let s = 0; s < 3; s++) {
        const sx = xPos - 15 + s * 15;
        ctx.ellipse(sx, yPos - 2, 6, 3, 0, 0, Math.PI * 2);
      }
      ctx.fill();
      
    } else if (decorType === 'garden_rock') {
      // FIXED: Use seeded random instead of Math.random() for deterministic rendering
      ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral400;
      ctx.beginPath();
      ctx.ellipse(xPos, yPos - 4, 8, 5, seededRand(decorSeed, 3) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // SIMPLIFIED: Basic dynamic element range
  const dynamicX0 = Math.floor((camera.x - 1000) / 960) * 960;
  const dynamicX1 = Math.ceil((camera.x + canvas.clientWidth + 1000) / 960) * 960;
  
  for (let x = dynamicX0; x <= dynamicX1; x += 960) { // Doubled spacing = half the elements
      const dynamicSeed = Math.floor(x / 960);
      const elementType = seededRand(dynamicSeed, 500);
      
      if (elementType < 0.15) { // Reduced chance for complex sprinkler
        // PERFORMANCE: Simplified sprinkler - just base, no complex spray animation
        const sprinklerX = x + seededRand(dynamicSeed, 501) * 100;
        const sprinklerY = groundY;
        
        // Sprinkler base only
        ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral500;
        ctx.beginPath();
        ctx.arc(sprinklerX, sprinklerY - 3, 6, 0, Math.PI * 2);
        ctx.fill();
        
        // Simple water indication - just a few static dots
        ctx.fillStyle = 'rgba(200, 200, 200, 0.3)';
        ctx.beginPath();
        for (let d = 0; d < 3; d++) {
          const angle = (d / 3) * Math.PI * 2;
          const dx = sprinklerX + Math.cos(angle) * 25;
          const dy = sprinklerY - 15 + Math.sin(angle) * 12;
          ctx.moveTo(dx + 2, dy);
          ctx.arc(dx, dy, 2, 0, Math.PI * 2);
        }
        ctx.fill();
        
      } else if (elementType < 0.25) { // Reduced chance
        // PERFORMANCE: Simplified wind chimes - no rotation, no individual tube animation
        const chimeX = x + seededRand(dynamicSeed, 502) * 80;
        const chimeY = groundY - 100;
        
        // Hanging point
        ctx.strokeStyle = NATURE_COLORS.treeTrunk;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(chimeX, chimeY - 20);
        ctx.lineTo(chimeX, chimeY);
        ctx.stroke();
        
        // Simple static chimes - batch all tubes in one color
        ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral200;
        for (let t = 0; t < 3; t++) { // Reduced from 5 tubes
          const tx = chimeX + (t - 1) * 8; // Simple spacing
          const th = 20 + t * 5; // Simple height progression
          ctx.fillRect(tx - 2, chimeY, 4, th);
        }
        
      } else if (elementType < 0.35) { // Reduced chance
        // PERFORMANCE: Simplified flamingo - no bobbing animation, simpler shape
        const flamingoX = x + seededRand(dynamicSeed, 503) * 60;
        const flamingoY = groundY;
        
        // Stake
        ctx.strokeStyle = WINDOWS_CLASSIC_COLORS.neutral700;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(flamingoX, flamingoY);
        ctx.lineTo(flamingoX, flamingoY - 30);
        ctx.stroke();
        
        // Simple flamingo shape - just body and head circles
        ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral300;
        ctx.beginPath();
        ctx.arc(flamingoX, flamingoY - 35, 8, 0, Math.PI * 2); // Body
        ctx.arc(flamingoX - 3, flamingoY - 48, 3, 0, Math.PI * 2); // Head
        ctx.fill();
        
      } // PERFORMANCE: Pinwheel DISABLED - too expensive with rotation and multiple blades
  }
  
  ctx.restore();
}

// ========== SKY AND ATMOSPHERIC RENDERING ==========

/**
 * Get suburban sky gradient - Windows Classic grayscale daytime theme
 */
export function getSuburbanSkyGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timeMs: number
): CanvasGradient {
  // Windows Classic grayscale suburban sky - FIXED: Much darker, pleasant gradient
  const t = Math.sin(timeMs * 0.0001) * 0.03 + 0.5; // Minimal variation
  
  // Darker, more pleasant grayscale gradient that aligns with background
  const baseGray = Math.floor(85 + 3 * t);     // Much darker base (was 120)
  
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `rgb(${baseGray - 10}, ${baseGray - 10}, ${baseGray - 10})`); // Dark top ~75
  gradient.addColorStop(0.35, `rgb(${baseGray - 5}, ${baseGray - 5}, ${baseGray - 5})`); // Mid dark ~80
  gradient.addColorStop(0.6, `rgb(${baseGray}, ${baseGray}, ${baseGray})`); // Base ~85
  gradient.addColorStop(0.85, `rgb(${baseGray + 5}, ${baseGray + 5}, ${baseGray + 5})`); // Lighter ~90
  gradient.addColorStop(1, `rgb(${baseGray + 10}, ${baseGray + 10}, ${baseGray + 10})`); // Horizon ~95
  
  return gradient;
}

/**
 * Draw suburban sun - Windows Classic grayscale white sun
 */
export function drawSuburbanSun(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  totalTimeMs: number
): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  
  // Sun position - high in sky for daytime
  const t = totalTimeMs * 0.00002;
  const sunX = w * 0.25 + Math.sin(t) * 30;
  const sunY = h * 0.15 + Math.cos(t * 0.6) * 15;
  const sunRadius = 70;
  
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform for screen-space rendering
  
  // Subtle sun glow - FIXED: Much more subtle to prevent blown-out appearance
  const glowLayers = [
    { radius: sunRadius * 1.8, alpha: 0.02, color: 'rgba(220, 220, 220, $alpha)' }, // Much smaller and dimmer
    { radius: sunRadius * 1.4, alpha: 0.03, color: 'rgba(210, 210, 210, $alpha)' }, // Reduced size and brightness
  ];
  
  // Draw glow layers
  for (const layer of glowLayers) {
    const grad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, layer.radius);
    grad.addColorStop(0, layer.color.replace('$alpha', String(layer.alpha)));
    grad.addColorStop(0.5, layer.color.replace('$alpha', String(layer.alpha * 0.4)));
    grad.addColorStop(1, layer.color.replace('$alpha', '0'));
    ctx.fillStyle = grad;
    ctx.fillRect(sunX - layer.radius, sunY - layer.radius, layer.radius * 2, layer.radius * 2);
  }
  
  // Main sun disk with gradient - FIXED: Much more subdued grayscale
  const sunGrad = ctx.createRadialGradient(sunX - sunRadius * 0.2, sunY - sunRadius * 0.2, 0, sunX, sunY, sunRadius);
  sunGrad.addColorStop(0, 'rgba(200, 200, 200, 0.9)');  // Much darker center
  sunGrad.addColorStop(0.4, 'rgba(185, 185, 185, 0.8)'); // Darker mid
  sunGrad.addColorStop(0.7, 'rgba(170, 170, 170, 0.7)'); // Darker outer
  sunGrad.addColorStop(0.9, 'rgba(160, 160, 160, 0.6)'); // Darker edge
  sunGrad.addColorStop(1, 'rgba(150, 150, 150, 0.5)');   // Much darker rim
  
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
  ctx.fillStyle = sunGrad;
  ctx.fill();
  
  // ===== PERFORMANCE & VISUAL: Lens flare DISABLED - was causing blown-out brightness =====
  // The screen composite mode made everything too bright and washed out
  // Keeping just the main sun disk for clean visuals
  
  // // Lens flare elements (DISABLED)
  // ctx.globalCompositeOperation = 'screen';
  // for (let i = -2; i <= 4; i++) {
  //   const fx = sunX + dx * (i / 5);
  //   const fy = sunY + dy * (i / 5);
  //   const fr = (sunRadius * 0.5) * (1.1 - i * 0.12);
  //   flare(fx, fy, Math.max(12, fr), 'rgba(240, 240, 240, $a)', 0.12);
  // }
  // ctx.globalCompositeOperation = 'source-over';
  
  // Subtle sun surface details - grayscale
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = 'rgba(200, 200, 200, 0.6)';
  const detailCount = 6;
  for (let i = 0; i < detailCount; i++) {
    const angle = (i / detailCount) * Math.PI * 2 + totalTimeMs * 0.0001;
    const dx = sunX + Math.cos(angle) * sunRadius * 0.6;
    const dy = sunY + Math.sin(angle) * sunRadius * 0.6;
    const size = 4 + Math.sin(totalTimeMs * 0.002 + i) * 2;
    ctx.beginPath();
    ctx.arc(dx, dy, size, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.restore();
}

/**
 * Draw suburban background layers - hills, trees, houses, towers
 */
export function drawSuburbanBackground(
  ctx: CanvasRenderingContext2D,
  camera: { x: number; y: number },
  canvas: HTMLCanvasElement,
  totalTimeMs: number
): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const camX = camera.x;
  const camY = camera.y;
  
  // Seeded random function
  const seededRand = (seed: number, offset: number): number => {
    const x = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  
  ctx.save();
  
  // Layer 1: Single combined hill - FIXED: Color aligned with darker sky
  const hillCamX = camX * 0.06;
  const hillY = 450 - camY * 0.06; // Shifted down from 300 to 450
  
  ctx.fillStyle = 'rgba(95, 95, 95, 0.6)'; // Aligned with darker sky (was 110)
  ctx.beginPath();
  ctx.moveTo(0, h);
  
  // 60px steps - barely noticeable quality loss, huge speed gain
  for (let x = 0; x <= w; x += 60) {
    const wx = (x + hillCamX) * 0.001;
    ctx.lineTo(x, hillY + 40 * Math.sin(wx));
  }
  
  ctx.lineTo(w, h);
  ctx.fill();
  
  // Layer 2: Trees - FIXED: Color aligned with darker sky  
  const treeCamX = camX * 0.08;
  const treeY = 480 - camY * 0.08; // Shifted down from 315 to 480
  const treeStart = Math.floor(treeCamX / 60) * 60 - 120;
  const treeEnd = treeStart + w + 300;
  
  ctx.fillStyle = 'rgba(60, 60, 60, 0.7)'; // Darker to align with sky (was 70)
  ctx.beginPath();
  for (let x = treeStart; x < treeEnd; x += 60) {
    const sx = x - treeCamX;
    ctx.moveTo(sx - 8, treeY);
    ctx.lineTo(sx, treeY - 28);
    ctx.lineTo(sx + 8, treeY);
  }
  ctx.fill();
  
  // Layer 3: Background elements only - NO MORE house generation here!
  // Houses are now rendered separately using persistent neighborhood data
  // This layer is now reserved for distant background elements only
  
  // Distant building silhouettes for depth (far background only)
  const distantCamX = camX * 0.02;
  const distantY = 520 - camY * 0.02; // Very far background
  const distantStart = Math.floor(distantCamX / 200) * 200 - 400;
  const distantEnd = distantStart + w + 800;
  
  ctx.fillStyle = 'rgba(70, 70, 70, 0.3)'; // Very faint distant buildings
  ctx.beginPath();
  for (let x = distantStart; x < distantEnd; x += 200) {
    const sx = x - distantCamX;
    const buildingHeight = 30 + seededRand(Math.floor(x/200), 500) * 40;
    ctx.rect(sx, distantY - buildingHeight, 80, buildingHeight);
  }
  ctx.fill();
  
  // Layer 4: Water towers - FIXED: Shifted down for better visibility
  const towerCamX = camX * 0.12;
  const towerY = 500 - camY * 0.12; // Shifted down from 335 to 500
  const towers = [800, 2400, 4200, 6000];
  
  ctx.strokeStyle = 'rgba(85, 85, 85, 0.35)'; // Grayscale tower legs
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const tx = towers[i] - towerCamX;
    if (tx < -100 || tx > w + 100) continue;
    ctx.moveTo(tx - 18, towerY);
    ctx.lineTo(tx - 6, towerY - 65);
    ctx.lineTo(tx + 6, towerY - 65);
    ctx.lineTo(tx + 18, towerY);
    ctx.lineTo(tx - 18, towerY);
  }
  ctx.stroke();
  
  // Tanks (grayscale)
  ctx.fillStyle = 'rgba(110, 110, 110, 0.4)'; // Grayscale tanks
  for (let i = 0; i < 4; i++) {
    const tx = towers[i] - towerCamX;
    if (tx < -100 || tx > w + 100) continue;
    ctx.beginPath();
    ctx.ellipse(tx, towerY - 75, 28, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Layer 5: Poles - FIXED: Shifted down for better visibility
  const poleCamX = camX * 0.18;
  const poleY = 560 - camY * 0.18; // Shifted down from 400 to 560
  const poleStart = Math.floor(poleCamX / 350) * 350 - 700;
  const poleEnd = poleStart + w + 1400;
  
  // Single power line
  ctx.strokeStyle = 'rgba(60, 60, 60, 0.3)'; // Grayscale power line
  ctx.lineWidth = 1;
  ctx.beginPath();
  let firstLine = true;
  for (let x = poleStart; x <= poleEnd; x += 350) {
    const sx = x - poleCamX;
    if (firstLine) { ctx.moveTo(sx, poleY - 95); firstLine = false; }
    else ctx.lineTo(sx, poleY - 95);
  }
  ctx.stroke();
  
  // Poles (grayscale)
  ctx.fillStyle = 'rgba(50, 50, 50, 0.55)'; // Grayscale poles
  for (let x = poleStart; x <= poleEnd; x += 350) {
    const sx = x - poleCamX;
    if (sx < -50 || sx > w + 50) continue;
    ctx.fillRect(sx - 4, poleY - 110, 8, 110);
    ctx.fillRect(sx - 20, poleY - 100, 40, 4);
  }
  
  ctx.restore();
}

/**
 * Draw clouds for suburban map - Windows Classic grayscale
 */
export function drawSuburbanClouds(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  perlinNoise: (x: number) => number,
  totalTimeMs: number,
  visualSettings: { clouds: boolean }
): void {
  if (!visualSettings.clouds) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform for screen-space rendering
  
  // Suburban clouds - fluffy, white, cheerful daytime clouds (grayscale)
  const cloudLayers = [
    { y: 0.08, speed: 8, alpha: 0.6, scale: 1.3, detail: 'fluffy' },
    { y: 0.18, speed: 12, alpha: 0.5, scale: 1.1, detail: 'puffy' },
    { y: 0.28, speed: 18, alpha: 0.4, scale: 0.95, detail: 'wispy' },
  ];
  
  for (let i = 0; i < cloudLayers.length; i++) {
    const layer = cloudLayers[i];
    const y = h * layer.y;
    const offset = (totalTimeMs * 0.0004 * layer.speed) % (w + 800);
    
    for (let x = -800; x < w + 800; x += 200) {
      const n = perlinNoise((x + offset) * 0.001 + i * 8);
      const cloudWidth = (280 + n * 120) * layer.scale;
      const cloudHeight = (45 + n * 20) * layer.scale;
      const cloudX = x + offset + n * 40;
      const cloudY = y + Math.sin((x + offset) * 0.006 + i) * 8;
      
      // Create fluffy cloud with grayscale gradient
      const cloudGrad = ctx.createRadialGradient(cloudX, cloudY, 0, cloudX, cloudY, cloudWidth);
      
      if (layer.detail === 'fluffy') {
        // Bright fluffy clouds (grayscale whites)
        cloudGrad.addColorStop(0, `rgba(255, 255, 255, ${layer.alpha})`);
        cloudGrad.addColorStop(0.25, `rgba(250, 250, 250, ${layer.alpha * 0.95})`);
        cloudGrad.addColorStop(0.5, `rgba(245, 245, 245, ${layer.alpha * 0.7})`);
        cloudGrad.addColorStop(0.75, `rgba(235, 235, 235, ${layer.alpha * 0.4})`);
        cloudGrad.addColorStop(1, `rgba(220, 220, 220, 0)`);
      } else if (layer.detail === 'puffy') {
        // Slightly shaded puffy clouds (grayscale)
        cloudGrad.addColorStop(0, `rgba(245, 245, 245, ${layer.alpha})`);
        cloudGrad.addColorStop(0.3, `rgba(235, 235, 235, ${layer.alpha * 0.85})`);
        cloudGrad.addColorStop(0.6, `rgba(225, 225, 225, ${layer.alpha * 0.5})`);
        cloudGrad.addColorStop(0.85, `rgba(210, 210, 210, ${layer.alpha * 0.2})`);
        cloudGrad.addColorStop(1, `rgba(200, 200, 200, 0)`);
      } else {
        // Wispy thin clouds (grayscale)
        cloudGrad.addColorStop(0, `rgba(235, 235, 235, ${layer.alpha})`);
        cloudGrad.addColorStop(0.4, `rgba(225, 225, 225, ${layer.alpha * 0.6})`);
        cloudGrad.addColorStop(0.7, `rgba(215, 215, 215, ${layer.alpha * 0.3})`);
        cloudGrad.addColorStop(1, `rgba(205, 205, 205, 0)`);
      }
      
      ctx.fillStyle = cloudGrad;
      ctx.beginPath();
      ctx.ellipse(cloudX, cloudY, cloudWidth, cloudHeight, n * 0.2, 0, Math.PI * 2);
      ctx.fill();
      
      // Add cloud shadows for depth (grayscale)
      if (layer.alpha > 0.35) {
        const shadowGrad = ctx.createRadialGradient(cloudX + cloudWidth * 0.2, cloudY + cloudHeight * 0.3, 0, cloudX, cloudY, cloudWidth * 0.7);
        shadowGrad.addColorStop(0, `rgba(180, 180, 180, ${layer.alpha * 0.15})`);
        shadowGrad.addColorStop(0.6, `rgba(180, 180, 180, ${layer.alpha * 0.05})`);
        shadowGrad.addColorStop(1, `rgba(180, 180, 180, 0)`);
        ctx.fillStyle = shadowGrad;
        ctx.beginPath();
        ctx.ellipse(cloudX, cloudY, cloudWidth * 0.8, cloudHeight * 0.8, n * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Add highlights for more realism
      if (layer.detail === 'fluffy') {
        const highlightGrad = ctx.createRadialGradient(cloudX - cloudWidth * 0.3, cloudY - cloudHeight * 0.4, 0, cloudX, cloudY, cloudWidth * 0.4);
        highlightGrad.addColorStop(0, `rgba(255, 255, 255, ${layer.alpha * 0.5})`);
        highlightGrad.addColorStop(1, `rgba(255, 255, 255, 0)`);
        ctx.fillStyle = highlightGrad;
        ctx.beginPath();
        ctx.ellipse(cloudX - cloudWidth * 0.3, cloudY - cloudHeight * 0.4, cloudWidth * 0.35, cloudHeight * 0.4, n * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  
  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * Draw suburban atmospheric effects - grayscale theme
 */
export function drawSuburbanAtmosphericEffects(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  totalTimeMs: number
): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform for screen-space rendering
  
  // PERFORMANCE: Simplified kites - reduced from 4 to 2, removed complex animations
  const kiteCount = 2; // Reduced count
  const kiteColors = [INTERACTIVE_COLORS.kite1, INTERACTIVE_COLORS.kite3]; // Fewer colors
  
  // Batch all kite bodies first
  for (let i = 0; i < kiteCount; i++) {
    const kx = ((i * 300 + totalTimeMs * 0.01) % (w + 200)) - 100; // Simpler movement
    const ky = h * 0.25 + i * 40; // Static Y position, no sin calculation
    
    // Simple kite diamond - no rotation, no individual transforms
    ctx.fillStyle = kiteColors[i];
    ctx.beginPath();
    ctx.moveTo(kx, ky - 12);
    ctx.lineTo(kx + 8, ky);
    ctx.lineTo(kx, ky + 12);
    ctx.lineTo(kx - 8, ky);
    ctx.closePath();
    ctx.fill();
  }
  
  // PERFORMANCE: Simplified birds - reduced count, removed wing animation and complex curves
  const birdCount = 4; // Reduced from 8
  
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath(); // Batch all birds in one path
  for (let i = 0; i < birdCount; i++) {
    const birdX = ((i * 200 + totalTimeMs * 0.03) % (w + 200)) - 100; // Simpler movement
    const birdY = h * 0.1 + i * 20; // Static Y, no sin calculation
    
    // Simple bird shape - just small circles, no wings
    ctx.moveTo(birdX + 2, birdY);
    ctx.arc(birdX, birdY, 2, 0, Math.PI * 2);
  }
  ctx.fill(); // Fill all birds at once
  
  // PERFORMANCE: Butterflies DISABLED - too expensive for minimal visual benefit
  // Removing complex wing animations, rotations, and multiple draw calls per butterfly
  
  // ===== PERFORMANCE & VISUAL: God rays DISABLED to prevent blown-out brightness =====
  // Sunlight beams through trees (god rays) - DISABLED for better visibility
  // ctx.globalCompositeOperation = 'screen';
  // ctx.globalAlpha = 0.01; // Further reduced but actually disabled below
  
  // God rays code DISABLED to prevent blown-out brightness
  /*
  const sunX = w * 0.25;
  const sunY = h * 0.15;
  const rayCount = 6;
  
  for (let i = 0; i < rayCount; i++) {
    const angle = Math.PI * 0.3 + (i / rayCount) * Math.PI * 0.4;
    const rayLength = h * 1.2;
    const rayWidth = 60 + Math.sin(totalTimeMs * 0.001 + i) * 20;
    
    const gradient = ctx.createLinearGradient(sunX, sunY, 
      sunX + Math.cos(angle) * rayLength, 
      sunY + Math.sin(angle) * rayLength);
    
    gradient.addColorStop(0, 'rgba(245, 245, 245, 0.6)'); // Grayscale light rays
    gradient.addColorStop(0.3, 'rgba(235, 235, 235, 0.3)');
    gradient.addColorStop(0.6, 'rgba(225, 225, 225, 0.15)');
    gradient.addColorStop(1, 'rgba(215, 215, 215, 0)');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(sunX, sunY);
    ctx.lineTo(
      sunX + Math.cos(angle - rayWidth / 2000) * rayLength,
      sunY + Math.sin(angle - rayWidth / 2000) * rayLength
    );
    ctx.lineTo(
      sunX + Math.cos(angle + rayWidth / 2000) * rayLength,
      sunY + Math.sin(angle + rayWidth / 2000) * rayLength
    );
    ctx.closePath();
    ctx.fill();
  }
  */
  
  // ctx.globalCompositeOperation = 'source-over'; // Not needed since god rays disabled
  
  // PERFORMANCE: Simplified pollen - reduced count and complexity, batched drawing
  ctx.globalAlpha = 0.4;
  const pollenCount = 12; // Reduced from 30
  
  ctx.fillStyle = 'rgba(200, 200, 200, 0.6)'; // Static color, no sin calculations
  ctx.beginPath(); // Batch all pollen in one path
  for (let i = 0; i < pollenCount; i++) {
    const px = (i * 120 + totalTimeMs * 0.01) % (w + 50) - 25; // Simpler movement
    const py = (i * 80) % h; // Static Y positioning
    const size = 1.5; // Fixed size
    
    ctx.moveTo(px + size, py);
    ctx.arc(px, py, size, 0, Math.PI * 2);
  }
  ctx.fill(); // Fill all pollen at once
  
  // Ambient light overlay - DISABLED to prevent blown-out brightness
  // ctx.globalAlpha = 0.02;  // Was too bright even at 0.05
  // ctx.globalCompositeOperation = 'overlay';
  // const ambientGrad = ctx.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.3, Math.max(w, h) * 0.8);
  // ambientGrad.addColorStop(0, 'rgba(200, 200, 200, 1)'); // Darker grayscale ambient
  // ambientGrad.addColorStop(0.5, 'rgba(180, 180, 180, 1)');
  // ambientGrad.addColorStop(1, 'rgba(160, 160, 160, 1)');
  // ctx.fillStyle = ambientGrad;
  // ctx.fillRect(0, 0, w, h);

  // PERFORMANCE: Simplified grass - reduced count, removed complex curves and animations
  ctx.globalAlpha = 0.2;
  ctx.globalCompositeOperation = 'multiply';
  const bladeCount = Math.floor(canvas.clientWidth / 20); // Much fewer blades (was /6)
  
  ctx.strokeStyle = 'rgba(80, 80, 80, 0.5)'; // Static color
  ctx.lineWidth = 1; // Thinner lines
  ctx.beginPath(); // Batch all grass in one path
  for (let i = 0; i < bladeCount; i++) {
    const gx = (i / bladeCount) * canvas.clientWidth;
    const baseY = h - 8;
    const heightVar = 12; // Fixed height, no sin calculation
    
    // Simple straight lines instead of curves
    ctx.moveTo(gx, baseY);
    ctx.lineTo(gx, baseY - heightVar);
  }
  ctx.stroke(); // Draw all grass at once
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  
  ctx.restore();
}

/**
 * Draw suburban boundary walls - White picket fence style (grayscale)
 */
export function drawSuburbanBoundaryWalls(
  ctx: CanvasRenderingContext2D,
  boundaries: { left: number; right: number; width: number },
  camera: { x: number; y: number },
  world: { baseGroundY: number },
  canvas: HTMLCanvasElement
): void {
  ctx.save();
  const bounds = boundaries;
  const wallWidth = 60;
  const wallHeight = 2000;
  const groundY = world.baseGroundY;
  
  // Left boundary
  if (bounds.left >= camera.x - 200 && bounds.left <= camera.x + canvas.clientWidth + 200) {
    // Solid white backing (grayscale)
    ctx.fillStyle = WINDOWS_CLASSIC_COLORS.white;
    ctx.fillRect(bounds.left - wallWidth, groundY - wallHeight, wallWidth, wallHeight);
    
    // Picket fence pattern (grayscale)
    ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral050;
    for (let y = groundY - wallHeight; y < groundY; y += 120) {
      ctx.fillRect(bounds.left - wallWidth + 10, y, wallWidth - 20, 100);
    }
    
    // Fence posts (grayscale)
    ctx.fillStyle = WINDOWS_CLASSIC_COLORS.white;
    const postSpacing = 30;
    for (let y = groundY - wallHeight + 20; y < groundY - 20; y += postSpacing) {
      ctx.fillRect(bounds.left - wallWidth + 5, y, 10, postSpacing - 5);
      ctx.fillRect(bounds.left - wallWidth + wallWidth - 15, y, 10, postSpacing - 5);
      // Cross bars
      ctx.fillRect(bounds.left - wallWidth + 5, y + 8, wallWidth - 10, 4);
    }
    
    // Strong border (grayscale)
    ctx.strokeStyle = WINDOWS_CLASSIC_COLORS.neutral120;
    ctx.lineWidth = 4;
    ctx.strokeRect(bounds.left - wallWidth, groundY - wallHeight, wallWidth, wallHeight);
    
    // Inner shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(bounds.left - wallWidth + 4, groundY - wallHeight + 4, 8, wallHeight - 8);
  }
  
  // Right boundary
  if (bounds.right >= camera.x - 200 && bounds.right <= camera.x + canvas.clientWidth + 200) {
    // Solid white backing (grayscale)
    ctx.fillStyle = WINDOWS_CLASSIC_COLORS.white;
    ctx.fillRect(bounds.right, groundY - wallHeight, wallWidth, wallHeight);
    
    // Picket fence pattern (grayscale)
    ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral050;
    for (let y = groundY - wallHeight; y < groundY; y += 120) {
      ctx.fillRect(bounds.right + 10, y, wallWidth - 20, 100);
    }
    
    // Fence posts (grayscale)
    ctx.fillStyle = WINDOWS_CLASSIC_COLORS.white;
    const postSpacing = 30;
    for (let y = groundY - wallHeight + 20; y < groundY - 20; y += postSpacing) {
      ctx.fillRect(bounds.right + 5, y, 10, postSpacing - 5);
      ctx.fillRect(bounds.right + wallWidth - 15, y, 10, postSpacing - 5);
      // Cross bars
      ctx.fillRect(bounds.right + 5, y + 8, wallWidth - 10, 4);
    }
    
    // Strong border (grayscale)
    ctx.strokeStyle = WINDOWS_CLASSIC_COLORS.neutral120;
    ctx.lineWidth = 4;
    ctx.strokeRect(bounds.right, groundY - wallHeight, wallWidth, wallHeight);
    
    // Inner shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(bounds.right + wallWidth - 12, groundY - wallHeight + 4, 8, wallHeight - 8);
  }
  
  ctx.restore();
}

/**
 * Draw suburban flat street system - NO MORE perlin noise terrain!
 */
export function drawSuburbanGround(
  ctx: CanvasRenderingContext2D,
  camera: { x: number; y: number },
  canvas: HTMLCanvasElement
): void {
  const x0 = camera.x - 50;
  const x1 = camera.x + canvas.clientWidth + 50;
  const FLAT_STREET_LEVEL = 680; // Fixed street level for consistent combat
  
  ctx.save();
  
  // FLAT STREET SURFACE - perfectly flat for street fighting
  ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral500; // #5a5a5a - asphalt color
  ctx.fillRect(x0, FLAT_STREET_LEVEL, x1 - x0, canvas.clientHeight + camera.y + 2000);
  
  // STREET MARKINGS - add visual interest and tactical reference lines
  ctx.strokeStyle = WINDOWS_CLASSIC_COLORS.neutral200; // Light gray lines
  ctx.lineWidth = 3;
  ctx.setLineDash([20, 30]); // Dashed center line
  
  // Center street line
  ctx.beginPath();
  ctx.moveTo(x0, FLAT_STREET_LEVEL + 4);
  ctx.lineTo(x1, FLAT_STREET_LEVEL + 4);
  ctx.stroke();
  
  ctx.setLineDash([]); // Reset dash
  
  // SIDEWALK EDGES - define street boundaries
  ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral400; // Slightly lighter for sidewalk
  ctx.fillRect(x0, FLAT_STREET_LEVEL - 8, x1 - x0, 8); // Sidewalk strip
  
  // SIDEWALK LINES - subtle detailing
  ctx.strokeStyle = WINDOWS_CLASSIC_COLORS.neutral300;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, FLAT_STREET_LEVEL - 8);
  ctx.lineTo(x1, FLAT_STREET_LEVEL - 8);
  ctx.moveTo(x0, FLAT_STREET_LEVEL);
  ctx.lineTo(x1, FLAT_STREET_LEVEL);
  ctx.stroke();
  
  // CROSSWALK MARKINGS - every 800 pixels for visual variety
  const crosswalkSpacing = 800;
  const crosswalkStart = Math.floor(camera.x / crosswalkSpacing) * crosswalkSpacing;
  
  ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral100; // Bright white crosswalk
  for (let cx = crosswalkStart - crosswalkSpacing; cx <= camera.x + canvas.clientWidth + crosswalkSpacing; cx += crosswalkSpacing) {
    // Multiple crosswalk stripes
    for (let stripe = 0; stripe < 8; stripe++) {
      const stripeX = cx + stripe * 12;
      ctx.fillRect(stripeX, FLAT_STREET_LEVEL - 6, 8, 12);
    }
  }
  
  // STREET EDGE SHADOW - adds depth to flat street
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.fillRect(x0, FLAT_STREET_LEVEL, x1 - x0, 4);
  
  ctx.restore();
}

/**
 * Draw suburban dynamic lighting and shadows - grayscale theme
 */
export function drawSuburbanLighting(
  ctx: CanvasRenderingContext2D,
  camera: { x: number; y: number },
  canvas: HTMLCanvasElement,
  platforms: any[],
  totalTimeMs: number
): void {
  // ===== PERFORMANCE: DISABLED - Creating 100+ gradients per frame is EXTREMELY expensive =====
  // This entire lighting system was a major performance bottleneck (10-20ms/frame!)
  // The gradients for platform shadows AND window glows were being created EVERY frame
  // Disabling this saves massive performance with minimal visual impact
  // TODO: If needed, implement with proper gradient caching
  
  return; // Early exit - don't run any lighting code
  
}
