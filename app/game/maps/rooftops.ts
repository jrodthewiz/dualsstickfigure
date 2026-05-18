/**
 * NYC Rooftops Map (rooftop-sunset)
 * 
 * This module handles all NYC rooftop map logic including:
 * - Platform generation (rooftop buildings)
 * - Visual rendering (buildings, features, decorations)
 * - Collision detection helpers
 */

import type { 
  MapConfig, 
  RooftopPlatformData, 
  RooftopBuildingDefinition, 
  RooftopFeatureDefinition, 
  RooftopBuildingStyle 
} from "../../types/Maps";
import { BUILDING_PALETTES, WINDOWS_CLASSIC_COLORS } from "../../theme/mapThemes";

// ============================================================================
// TYPES
// ============================================================================

export interface RooftopsState {
  // Add any state-specific data here if needed in the future
  initialized: boolean;
}

// ============================================================================
// CITYSCAPE CACHE & HELPERS
// ============================================================================

// Module-level cache for cityscape chunk rendering
const cityscapeCache: Record<'far' | 'mid' | 'near', { 
  chunks: Map<number, { canvas: HTMLCanvasElement; timeBucket: number; offsetBase: number }>;
}> = {
  far: { chunks: new Map() },
  mid: { chunks: new Map() },
  near: { chunks: new Map() }
};

// Seeded random helpers for deterministic procedural generation
const seededRand = (seed: number, offset: number): number => {
  const x = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// Seeded random function


const signedRand = (seed: number, offset: number): number => seededRand(seed, offset) * 2 - 1;

// Platform interface - should match the main Platform type from page.tsx
export interface Platform {
  x: number;
  y: number;
  width: number;
  height: number;
  kind?: string; // Made optional to match main Platform type
  active?: boolean; // Made optional to match main Platform type
  isRooftop?: boolean;
  isRooftopFeature?: boolean;
  rooftopKey?: string;
  sourceBuildingId?: string;
  buildingHeight?: number;
  rooftopHeight?: number;
  rooftopStyle?: RooftopBuildingStyle;
  buildingStyle?: number;
  featureType?: string;
  [key: string]: any; // Allow additional properties from main Platform type
}

export interface World {
  baseGroundY: number;
}

export interface Camera {
  x: number;
  y: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export const getRooftopConfig = (map: MapConfig | undefined): RooftopPlatformData | null => {
  const data = map?.platformData;
  return data && data.type === 'rooftop' ? data : null;
};

export const makeBuildingKey = (buildingId: string) => `building:${buildingId}`;

export const makeFeatureKey = (buildingId: string, feature: RooftopFeatureDefinition, index: number) =>
  `feature:${buildingId}:${feature.id ?? `${feature.type}-${index}`}`;

export const rooftopStyleToIndex = (style: RooftopBuildingStyle): number => {
  switch (style) {
    case 'art-deco':
      return 0;
    case 'glass':
      return 1;
    case 'copper':
      return 2;
    case 'charcoal':
    default:
      return 3;
  }
};

export const resolveFeatureLayout = (
  building: RooftopBuildingDefinition,
  feature: RooftopFeatureDefinition,
  featureIndex: number,
  rooftopY: number,
  rooftopThickness: number
) => {
  const featureKey = makeFeatureKey(building.id, feature, featureIndex);
  const anchor = Math.max(0, Math.min(1, feature.anchor));
  const width = Math.min(feature.width, building.width);
  const rawX = building.x + anchor * building.width - width * 0.5;
  const x = Math.max(building.x, Math.min(rawX, building.x + building.width - width));
  const elevation = feature.platformElevation;
  const thickness = feature.platformThickness ?? Math.min(rooftopThickness - 8, 30);
  const y = rooftopY - elevation;
  return { featureKey, x, y, width, elevation, thickness };
};

export const hashStringToSeed = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash || 1;
};



// ============================================================================
// PLATFORM GENERATION
// ============================================================================

/**
 * Generate rooftop collision platforms for NYC Rooftop map
 */
export function ensureRooftopPlatforms(
  currentMap: MapConfig,
  platforms: any[], // Use any to avoid type conflicts with main Platform type
  world: World,
  xCenter: number,
  anchorX?: number
): any | null { // Return any to match main Platform type
  const rooftopConfig = getRooftopConfig(currentMap);
  const targetX = anchorX ?? xCenter;
  let closest: Platform | null = null;
  let closestDist = Infinity;

  // Remove any non-rooftop platforms that might be left over from other maps
  for (let i = platforms.length - 1; i >= 0; i--) {
    const p = platforms[i];
    if (!p.isRooftop) {
      platforms.splice(i, 1);
    }
  }
  
  if (!rooftopConfig) {
    return null;
  }

  const allowedKeys = new Set<string>();
  const rooftopThickness = rooftopConfig.rooftopThickness ?? 40;

  for (const building of rooftopConfig.buildings) {
    const buildingKey = makeBuildingKey(building.id);
    allowedKeys.add(buildingKey);

    // Platform Y is the TOP surface where player walks (baseGroundY is at bottom, subtract height to get top)
    const platformY = world.baseGroundY - building.height;
    
    let buildingPlatform = platforms.find(
      (p) => p.isRooftop && !p.isRooftopFeature && p.rooftopKey === buildingKey
    );

    if (!buildingPlatform) {
      buildingPlatform = {
        x: building.x,
        y: platformY,
        width: building.width,
        height: rooftopThickness,
        kind: 'hover',
        isRooftop: true,
        rooftopKey: buildingKey,
        sourceBuildingId: building.id,
        buildingHeight: building.height,
        rooftopHeight: building.height,
        active: true,
      };
      platforms.push(buildingPlatform);
    } else {
      buildingPlatform.x = building.x;
      buildingPlatform.y = platformY;
      buildingPlatform.width = building.width;
      buildingPlatform.height = rooftopThickness;
      buildingPlatform.isRooftop = true;
      buildingPlatform.sourceBuildingId = building.id;
      buildingPlatform.buildingHeight = building.height;
      buildingPlatform.rooftopHeight = building.height;
      buildingPlatform.active = true;
    }

    buildingPlatform.rooftopStyle = building.style;
    buildingPlatform.buildingStyle = rooftopStyleToIndex(building.style);

    if (targetX >= buildingPlatform.x && targetX <= buildingPlatform.x + buildingPlatform.width) {
      const dist = Math.abs(buildingPlatform.x + buildingPlatform.width * 0.5 - targetX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = buildingPlatform;
      }
    }

    // Do not create collidable feature platforms for rooftop-sunset.
    // Features are rendered visually via drawRooftopFeature, but collision should be only the main rooftop slabs.
  }

  // Cleanup invalid platforms
  for (let i = platforms.length - 1; i >= 0; i--) {
    const p = platforms[i];
    if (p.isRooftop && (!p.rooftopKey || !allowedKeys.has(p.rooftopKey))) {
      platforms.splice(i, 1);
    }
  }

  return closest;
}

// ============================================================================
// VISUAL RENDERING
// ============================================================================

// Color palettes for different building styles - Windows Classic grayscale theme
// Now using centralized theme from app/theme/mapThemes.ts
const rooftopStylePalette = BUILDING_PALETTES;

/**
 * Draw rooftop feature (water tower or AC unit)
 * Enhanced with Windows Classic beveled aesthetic
 */
export const drawRooftopFeature = (
  ctx: CanvasRenderingContext2D,
  building: RooftopBuildingDefinition,
  feature: RooftopFeatureDefinition,
  layout: ReturnType<typeof resolveFeatureLayout>,
  featureIndex: number,
  rooftopScreenY: number,
  totalTimeMs: number
) => {
  const palette = rooftopStylePalette[building.style] ?? rooftopStylePalette['charcoal'];
  const screenX = layout.x;
  const screenY = layout.y;

  ctx.save();
  
  // Platform with Windows Classic raised bevel
  ctx.fillStyle = palette.pad;
  ctx.fillRect(screenX, screenY, layout.width, layout.thickness);
  
  // Classic 3D bevel - light top/left, dark bottom/right
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; // Highlight
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(screenX + layout.width, screenY);
  ctx.lineTo(screenX, screenY);
  ctx.lineTo(screenX, screenY + layout.thickness);
  ctx.stroke();
  
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; // Shadow
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(screenX, screenY + layout.thickness);
  ctx.lineTo(screenX + layout.width, screenY + layout.thickness);
  ctx.lineTo(screenX + layout.width, screenY);
  ctx.stroke();

  const seed = hashStringToSeed(`${building.id}:${feature.id ?? featureIndex}`);

  if (feature.type === 'waterTower') {
    const centerX = screenX + layout.width * 0.5;
    const padBottom = screenY + layout.thickness;
    const legLength = Math.max(12, rooftopScreenY - padBottom);

    // Water tower legs - dark gray
    ctx.strokeStyle = '#2a2a2a'; // --neutral-800
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX - layout.width * 0.25, padBottom);
    ctx.lineTo(centerX - layout.width * 0.3, padBottom + legLength);
    ctx.moveTo(centerX + layout.width * 0.25, padBottom);
    ctx.lineTo(centerX + layout.width * 0.3, padBottom + legLength);
    ctx.stroke();

    const towerWidth = Math.min(layout.width * 0.7, 120);
    const towerHeight = Math.max(30, layout.thickness + 28);
    const towerX = centerX - towerWidth / 2;
    const towerTop = screenY - towerHeight + 4;

    // Water tower body with Windows Classic panel look
    ctx.fillStyle = '#6a6a6a'; // --neutral-400
    ctx.fillRect(towerX, towerTop, towerWidth, towerHeight);
    
    // Classic raised bevel on tower body
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(towerX + towerWidth, towerTop);
    ctx.lineTo(towerX, towerTop);
    ctx.lineTo(towerX, towerTop + towerHeight);
    ctx.stroke();
    
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.moveTo(towerX, towerTop + towerHeight);
    ctx.lineTo(towerX + towerWidth, towerTop + towerHeight);
    ctx.lineTo(towerX + towerWidth, towerTop);
    ctx.stroke();
    
    // Water tower roof - lighter gray with bevel
    ctx.fillStyle = '#8a8a8a'; // --neutral-300
    ctx.beginPath();
    ctx.moveTo(towerX - 6, towerTop);
    ctx.lineTo(centerX, towerTop - 12);
    ctx.lineTo(towerX + towerWidth + 6, towerTop);
    ctx.closePath();
    ctx.fill();
    
    // Roof outline
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Horizontal bands with Windows Classic raised look
    for (let i = 0; i < 2; i++) {
      const bandY = towerTop + towerHeight * (i === 0 ? 0.4 : 0.7);
      const bandH = i === 0 ? 6 : 4;
      
      ctx.fillStyle = 'rgba(192,192,192,0.5)'; // #c0c0c0
      ctx.fillRect(towerX, bandY, towerWidth, bandH);
      
      // Bevel on bands
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(towerX, bandY);
      ctx.lineTo(towerX + towerWidth, bandY);
      ctx.stroke();
      
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.moveTo(towerX, bandY + bandH);
      ctx.lineTo(towerX + towerWidth, bandY + bandH);
      ctx.stroke();
    }

    // Warning light - white blinking
    const blink = 0.5 + 0.5 * Math.sin(totalTimeMs * 0.006 + seed);
    ctx.fillStyle = `rgba(255,255,255, ${0.4 + 0.4 * blink})`;
    ctx.beginPath();
    ctx.arc(centerX, towerTop - 8, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // AC Unit with Windows Classic panel aesthetic
    const unitWidth = Math.min(layout.width * 0.85, 160);
    const unitHeight = Math.max(26, layout.thickness + 18);
    const unitX = screenX + (layout.width - unitWidth) * 0.5;
    const unitY = screenY - unitHeight + 6;

    // AC unit body with classic raised bevel
    ctx.fillStyle = '#5a5a5a'; // --neutral-500
    ctx.fillRect(unitX, unitY, unitWidth, unitHeight);
    
    // Windows Classic 3D bevel on unit
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(unitX + unitWidth, unitY);
    ctx.lineTo(unitX, unitY);
    ctx.lineTo(unitX, unitY + unitHeight);
    ctx.stroke();
    
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.moveTo(unitX, unitY + unitHeight);
    ctx.lineTo(unitX + unitWidth, unitY + unitHeight);
    ctx.lineTo(unitX + unitWidth, unitY);
    ctx.stroke();

    // Cooling fins with sunken bevel look
    ctx.fillStyle = '#4a4a4a'; // --neutral-600
    for (let fin = 0; fin < 4; fin++) {
      const finY = unitY + 8 + fin * ((unitHeight - 16) / 3);
      ctx.fillRect(unitX + 10, finY, unitWidth - 20, 4);
      
      // Inset bevel on fins
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(unitX + 10, finY);
      ctx.lineTo(unitX + unitWidth - 10, finY);
      ctx.stroke();
      
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.moveTo(unitX + 10, finY + 4);
      ctx.lineTo(unitX + unitWidth - 10, finY + 4);
      ctx.stroke();
    }

    // Fan housing with bevel
    const fanRadius = Math.min(18, unitWidth * 0.25);
    const fanCenterX = unitX + fanRadius + 14;
    const fanCenterY = unitY + unitHeight * 0.5;
    
    // Outer circle with highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(fanCenterX, fanCenterY, fanRadius + 1, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.strokeStyle = '#1a1a1a'; // --neutral-850 (dark)
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(fanCenterX, fanCenterY, fanRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Fan blades
    const bladeCount = 4;
    const spin = totalTimeMs * 0.01 + seed;
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 2;
    for (let blade = 0; blade < bladeCount; blade++) {
      const angle = spin + (blade / bladeCount) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(fanCenterX, fanCenterY);
      ctx.lineTo(
        fanCenterX + Math.cos(angle) * fanRadius,
        fanCenterY + Math.sin(angle) * fanRadius
      );
      ctx.stroke();
    }

    // Vent panel with sunken bevel
    ctx.fillStyle = '#8a8a8a'; // --neutral-300
    ctx.fillRect(unitX + unitWidth - 18, unitY + 8, 10, unitHeight - 16);
    
    // Inset bevel on vent
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(unitX + unitWidth - 18, unitY + 8, 10, unitHeight - 16);
  }

  ctx.restore();
};

/**
 * Draw NYC rooftop buildings as pure visuals (no platforms)
 * Enhanced with Windows Classic beveled UI aesthetic
 */
export function drawRooftopBuildings(
  ctx: CanvasRenderingContext2D,
  currentMap: MapConfig,
  camera: Camera,
  world: World,
  canvas: HTMLCanvasElement,
  totalTimeMs: number
) {
  if (currentMap.id !== 'rooftop-sunset') return;

  const rooftopConfig = getRooftopConfig(currentMap);
  if (!rooftopConfig) return;

  const viewportLeft = camera.x - 200;
  const viewportRight = camera.x + canvas.clientWidth + 200;
  const viewportTop = camera.y - 200;
  const viewportBottom = camera.y + canvas.clientHeight + 200;
  const rooftopThickness = rooftopConfig.rooftopThickness ?? 40;

  for (const building of rooftopConfig.buildings) {
    const buildingRight = building.x + building.width;
    if (buildingRight < viewportLeft || building.x > viewportRight) continue;

    const palette = rooftopStylePalette[building.style] ?? rooftopStylePalette['charcoal'];
    const px = building.x;
    const pw = building.width;
    const rooftopY = world.baseGroundY - building.height;
    const py = rooftopY;
    // Buildings extend far downward off-screen since we're high up on rooftops
    const groundY = world.baseGroundY + 2000; // Extend 2000px below to fall off into sky

    // Draw building body with gradient
    const buildingGrad = ctx.createLinearGradient(px, py, px, py + 1200); // Gradient over visible portion
    buildingGrad.addColorStop(0, palette.top);
    buildingGrad.addColorStop(1, palette.bottom);
    ctx.fillStyle = buildingGrad;
    ctx.fillRect(px, py, pw, groundY - py);

    // Draw side shadow with bevel effect
    ctx.fillStyle = palette.side;
    ctx.beginPath();
    ctx.moveTo(px + pw, py);
    ctx.lineTo(px + pw + 20, py + 20);
    ctx.lineTo(px + pw + 20, groundY);
    ctx.lineTo(px + pw, groundY);
    ctx.closePath();
    ctx.fill();

    // Windows Classic structured window grid - extend down the full building height
    const seed = hashStringToSeed(building.id);
    const windowCols = Math.max(1, Math.floor(pw / 70));
    const totalBuildingHeight = groundY - py; // Full extended height
    const windowRows = Math.max(1, Math.floor(totalBuildingHeight / 60));
    
    // ===== PERFORMANCE: Batch windows by type instead of drawing each individually =====
    // Collect all lit windows first, then draw them together
    const litWindows: Array<{wx: number; wy: number; alpha: number}> = [];
    
    for (let row = 0; row < windowRows; row++) {
      for (let col = 0; col < windowCols; col++) {
        const wx = px + 25 + col * 70;
        const wy = py + 25 + row * 60;
        if (wx + 25 > px + pw - 20) continue;
        
        // ===== PERFORMANCE: Viewport culling for windows =====
        // Skip windows that are off-screen (buildings can be very tall)
        if (wy < viewportTop - 100 || wy > viewportBottom + 100) continue;
        
        const glow = seededRand(seed, row * 97 + col * 131);
        if (glow > 0.2) {
          const alpha = 0.45 + glow * 0.4;
          litWindows.push({wx, wy, alpha});
        }
      }
    }
    
    // ===== PERFORMANCE: Batch draw all windows instead of one-by-one =====
    // Draw all window fills first
    for (const win of litWindows) {
      ctx.fillStyle = palette.window;
      ctx.globalAlpha = win.alpha;
      ctx.fillRect(win.wx, win.wy, 25, 40);
    }
    ctx.globalAlpha = 1;
    
    // Batch all dark bevels together (top/left)
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const win of litWindows) {
      ctx.moveTo(win.wx, win.wy + 40);
      ctx.lineTo(win.wx, win.wy);
      ctx.lineTo(win.wx + 25, win.wy);
    }
    ctx.stroke();
    
    // Batch all light bevels together (bottom/right)
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    for (const win of litWindows) {
      ctx.moveTo(win.wx + 25, win.wy);
      ctx.lineTo(win.wx + 25, win.wy + 40);
      ctx.lineTo(win.wx, win.wy + 40);
    }
    ctx.stroke();

    // Draw rooftop with Windows Classic raised bevel
    ctx.fillStyle = palette.highlight;
    ctx.fillRect(px, py, pw, Math.min(rooftopThickness, 6));
    
    // Classic bevel effect - light top, dark bottom
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; // Highlight
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + pw, py);
    ctx.stroke();
    
    ctx.strokeStyle = palette.roofLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py + 5);
    ctx.lineTo(px + pw, py + 5);
    ctx.stroke();

    // Draw features (water towers, AC units)
    if (Array.isArray(building.features)) {
      building.features.forEach((feature, featureIndex) => {
        const layout = resolveFeatureLayout(building, feature, featureIndex, rooftopY, rooftopThickness);
        drawRooftopFeature(ctx, building, feature, layout, featureIndex, rooftopY, totalTimeMs);
      });
    }
  }
}

/**
 * Get Windows Classic grayscale sky gradient for rooftop-sunset map
 */
export function getRooftopSkyGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timeMs: number
): CanvasGradient {
  // Windows Classic grayscale sky - smooth gradient from dark to light
  // Subtle animation for old school OS aesthetic
  const t = Math.sin(timeMs * 0.00012) * 0.15 + 0.5; // Subtle variation
  
  // Grayscale gradient matching theme tokens
  const baseGray = Math.floor(20 + 10 * t);
  const midGray = Math.floor(30 + 8 * t);
  const lightGray = Math.floor(40 + 6 * t);
  
  // Shift gradient upward so we see more of the middle/bottom when on rooftops
  const shiftUp = -400; // Negative value shifts the gradient up
  const gradient = ctx.createLinearGradient(0, shiftUp, 0, height + shiftUp);
  gradient.addColorStop(0, `rgb(${baseGray}, ${baseGray}, ${baseGray})`); // --neutral-800 area
  gradient.addColorStop(0.25, `rgb(${midGray}, ${midGray}, ${midGray})`); // Transition
  gradient.addColorStop(0.5, `rgb(${lightGray}, ${lightGray}, ${lightGray})`); // Mid horizon
  gradient.addColorStop(0.75, `rgb(${midGray + 5}, ${midGray + 5}, ${midGray + 5})`); // Lighter
  gradient.addColorStop(1, `rgb(${baseGray + 5}, ${baseGray + 5}, ${baseGray + 5})`); // Bottom
  
  return gradient;
}

/**
 * Draw Windows Classic grayscale "sun" (light source)
 */
export function drawRooftopSun(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  totalTimeMs: number
): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  
  // Light source position - shifted to match background positioning
  const t = totalTimeMs * 0.00005;
  const backgroundShift = -400; // Match the sky gradient shift
  const sunX = w * 0.75 + Math.sin(t) * 50;
  const sunY = h * 0.5 + Math.cos(t * 0.7) * 20 + backgroundShift; // Shifted up with background
  const sunRadius = 80;
  
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform for screen-space rendering
  
  // Windows Classic grayscale glow layers (largest to smallest)
  const glowLayers = [
    { radius: sunRadius * 4, alpha: 0.12, gray: 200 },
    { radius: sunRadius * 3, alpha: 0.18, gray: 220 },
    { radius: sunRadius * 2.2, alpha: 0.25, gray: 230 },
    { radius: sunRadius * 1.6, alpha: 0.32, gray: 240 },
  ];
  
  // Draw glow layers
  for (const layer of glowLayers) {
    const grad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, layer.radius);
    grad.addColorStop(0, `rgba(${layer.gray}, ${layer.gray}, ${layer.gray}, ${layer.alpha})`);
    grad.addColorStop(0.4, `rgba(${layer.gray}, ${layer.gray}, ${layer.gray}, ${layer.alpha * 0.6})`);
    grad.addColorStop(0.7, `rgba(${layer.gray}, ${layer.gray}, ${layer.gray}, ${layer.alpha * 0.3})`);
    grad.addColorStop(1, `rgba(${layer.gray}, ${layer.gray}, ${layer.gray}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(sunX - layer.radius, sunY - layer.radius, layer.radius * 2, layer.radius * 2);
  }
  
  // Main light disk with grayscale gradient
  const sunGrad = ctx.createRadialGradient(sunX - sunRadius * 0.3, sunY - sunRadius * 0.3, 0, sunX, sunY, sunRadius);
  sunGrad.addColorStop(0, '#ffffff'); // --neutral-white (center)
  sunGrad.addColorStop(0.3, '#f5f5f5'); // --neutral-050
  sunGrad.addColorStop(0.6, '#ececec'); // --neutral-100
  sunGrad.addColorStop(0.85, '#dcdcdc'); // --neutral-120
  sunGrad.addColorStop(1, 'rgba(200,200,200,0.95)'); // --neutral-150
  
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
  ctx.fillStyle = sunGrad;
  ctx.fill();
  
  // Add subtle Windows Classic bevel on light source
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  ctx.restore();
}

/**
 * Draw stars for night sky - Windows Classic grayscale
 */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  camera: { x: number; y: number },
  stars: { x: number; y: number; s: number; a: number }[],
  totalTimeMs: number,
  visualSettings: { stars: boolean }
): void {
  if (!visualSettings.stars) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (const s of stars) {
    const x = (s.x * w) + camera.x * 0.1; // slight parallax
    const y = (s.y * h) + camera.y * 0.05;
    const twinkle = 0.7 + 0.3 * Math.sin((totalTimeMs * 0.004) + s.x * 12.3 + s.y * 7.7);
    ctx.globalAlpha = s.a * twinkle * 0.7;
    ctx.fillStyle = WINDOWS_CLASSIC_COLORS.neutral200; // Grayscale stars
    ctx.fillRect(x % w, y % h, s.s, s.s);
  }
  ctx.globalAlpha = 1;
}

/**
 * Draw clouds for rooftop sunset - Windows Classic grayscale
 */
export function drawRooftopClouds(
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
  
  // Sunset-specific clouds with Windows Classic grayscale layering
  const cloudLayers = [
    { y: 0.12, speed: 15, alpha: 0.7, scale: 1.2, colorType: 'bright' },
    { y: 0.25, speed: 25, alpha: 0.5, scale: 1.0, colorType: 'mid' },
    { y: 0.35, speed: 35, alpha: 0.3, scale: 0.8, colorType: 'dark' },
  ];
  
  for (let i = 0; i < cloudLayers.length; i++) {
    const layer = cloudLayers[i];
    const speed = layer.speed;
    const y = h * layer.y;
    const offset = (totalTimeMs * 0.001 * speed) % (w + 600);
    
    // Create gradient for each cloud based on its position and type
    for (let x = -600; x < w + 600; x += 180) {
      const n = perlinNoise((x + offset) * 0.0015 + i * 10);
      const cloudWidth = (250 + n * 100) * layer.scale;
      const cloudHeight = (35 + n * 15) * layer.scale;
      const cloudX = x + offset + n * 30;
      const cloudY = y + Math.sin((x + offset) * 0.008) * 10;
      
      // Grayscale gradient for sunset clouds
      const gradient = ctx.createRadialGradient(cloudX, cloudY, 0, cloudX, cloudY, cloudWidth);
      
      if (layer.colorType === 'bright') {
        // Bright clouds catching direct light (light grays)
        gradient.addColorStop(0, `rgba(220, 220, 220, ${layer.alpha})`);
        gradient.addColorStop(0.3, `rgba(200, 200, 200, ${layer.alpha * 0.8})`);
        gradient.addColorStop(0.6, `rgba(180, 180, 180, ${layer.alpha * 0.6})`);
        gradient.addColorStop(1, `rgba(160, 160, 160, 0)`);
      } else if (layer.colorType === 'mid') {
        // Mid-level clouds with mixed lighting
        gradient.addColorStop(0, `rgba(190, 190, 190, ${layer.alpha})`);
        gradient.addColorStop(0.4, `rgba(170, 170, 170, ${layer.alpha * 0.7})`);
        gradient.addColorStop(0.7, `rgba(150, 150, 150, ${layer.alpha * 0.4})`);
        gradient.addColorStop(1, `rgba(130, 130, 130, 0)`);
      } else {
        // Darker clouds in shadow
        gradient.addColorStop(0, `rgba(140, 140, 140, ${layer.alpha})`);
        gradient.addColorStop(0.5, `rgba(120, 120, 120, ${layer.alpha * 0.6})`);
        gradient.addColorStop(1, `rgba(100, 100, 100, 0)`);
      }
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(cloudX, cloudY, cloudWidth, cloudHeight, n * 0.3, 0, Math.PI * 2);
      ctx.fill();
      
      // Add subtle cloud details
      if (layer.alpha > 0.4) {
        ctx.fillStyle = `rgba(230, 230, 230, ${layer.alpha * 0.3})`;
        ctx.beginPath();
        ctx.ellipse(cloudX - cloudWidth * 0.3, cloudY - cloudHeight * 0.2, cloudWidth * 0.4, cloudHeight * 0.6, n * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  
  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * Draw Windows Classic atmospheric effects for rooftop map
 */
export function drawRooftopAtmosphericEffects(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  totalTimeMs: number
): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform for screen-space rendering
  
  // Atmospheric haze gradient - shifted to match background positioning
  const backgroundShift = -400; // Match the sky gradient shift
  const hazeGrad = ctx.createLinearGradient(0, backgroundShift, 0, h);
  hazeGrad.addColorStop(0, 'rgba(50,50,50,0)');
  hazeGrad.addColorStop(0.3, 'rgba(60,60,60,0.05)');
  hazeGrad.addColorStop(0.6, 'rgba(70,70,70,0.08)');
  hazeGrad.addColorStop(1, 'rgba(80,80,80,0.12)');
  
  ctx.fillStyle = hazeGrad;
  ctx.fillRect(0, 0, w, h);
  
  // Floating particles - light gray
  ctx.globalAlpha = 0.5;
  const particleCount = 30; // Reduced for classic look
  
  for (let i = 0; i < particleCount; i++) {
    const px = (i * 137 + totalTimeMs * 0.02 * (i % 3 + 1)) % (w + 100) - 50;
    const py = (i * 73 + Math.sin(totalTimeMs * 0.001 + i) * 50) % h;
    const size = 1 + (i % 2);
    const brightness = 0.4 + Math.sin(totalTimeMs * 0.003 + i * 0.5) * 0.4;
    
    const grayValue = Math.floor(200 + brightness * 55); // 200-255 range
    ctx.fillStyle = `rgba(${grayValue}, ${grayValue}, ${grayValue}, ${brightness * 0.6})`;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.restore();
}

/**
 * Draw NYC environmental elements - birds, helicopter, airplane
 */
export function drawNYCEnvironmentalElements(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  totalTimeMs: number
): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Screen-space rendering
  
  // Flying birds in formation
  const birdCount = 8;
  const birdSpeed = 0.02;
  const formationTime = totalTimeMs * 0.00015;
  
  for (let i = 0; i < birdCount; i++) {
    const birdX = ((totalTimeMs * birdSpeed + i * 80) % (w + 400)) - 200;
    const birdY = h * 0.2 + Math.sin(formationTime + i * 0.5) * 40;
    const wingFlap = Math.sin(totalTimeMs * 0.01 + i) > 0 ? 1 : -1;
    
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.6)'; // Grayscale bird
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    
    // Simple bird silhouette
    ctx.beginPath();
    ctx.moveTo(birdX - 6 * wingFlap, birdY - 3);
    ctx.lineTo(birdX, birdY);
    ctx.lineTo(birdX + 6 * wingFlap, birdY - 3);
    ctx.stroke();
  }
  
  // Distant helicopter with blinking lights
  const heliTime = totalTimeMs * 0.00008;
  const heliX = w * 0.3 + Math.sin(heliTime) * w * 0.4;
  const heliY = h * 0.25 + Math.cos(heliTime * 0.7) * 60;
  const heliSize = 25;
  
  // Helicopter body
  ctx.fillStyle = 'rgba(40, 40, 40, 0.8)'; // Grayscale helicopter
  ctx.fillRect(heliX - heliSize/2, heliY, heliSize, heliSize * 0.5);
  
  // Rotor (blurred spinning effect)
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = 'rgba(80, 80, 80, 0.6)'; // Grayscale rotor
  ctx.lineWidth = 1;
  const rotorSpin = totalTimeMs * 0.05;
  for (let i = 0; i < 4; i++) {
    const angle = rotorSpin + (i * Math.PI / 2);
    const rx = Math.cos(angle) * heliSize;
    ctx.beginPath();
    ctx.moveTo(heliX - rx, heliY);
    ctx.lineTo(heliX + rx, heliY);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  
  // Blinking navigation lights
  const lightBlink = Math.sin(totalTimeMs * 0.003) > 0;
  if (lightBlink) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // Grayscale white light
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)'; // Grayscale glow
    ctx.beginPath();
    ctx.arc(heliX - heliSize/2, heliY + heliSize * 0.25, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  
  // Airplane trail in distance (high altitude)
  const planeTime = totalTimeMs * 0.00005;
  const planeProgress = (planeTime % 1);
  if (planeProgress < 0.8) { // Only visible for part of cycle
    const planeX = w * planeProgress;
    const planeY = h * 0.15;
    
    // Condensation trail
    const trailLength = 200;
    const trailGrad = ctx.createLinearGradient(planeX - trailLength, planeY, planeX, planeY);
    trailGrad.addColorStop(0, 'rgba(220, 220, 220, 0)'); // Grayscale trail
    trailGrad.addColorStop(0.5, 'rgba(230, 230, 230, 0.4)'); // Grayscale trail
    trailGrad.addColorStop(1, 'rgba(240, 240, 240, 0.6)'); // Grayscale trail
    ctx.strokeStyle = trailGrad;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(planeX - trailLength, planeY);
    ctx.lineTo(planeX, planeY);
    ctx.stroke();
    
    // Tiny plane silhouette at front
    ctx.fillStyle = 'rgba(60, 60, 60, 0.8)'; // Grayscale plane
    ctx.beginPath();
    ctx.moveTo(planeX, planeY);
    ctx.lineTo(planeX - 8, planeY - 3);
    ctx.lineTo(planeX - 8, planeY + 3);
    ctx.closePath();
    ctx.fill();
  }
  
  ctx.restore();
}

/**
 * Draw background cityscape for NYC rooftops (only 'near' layer with grayscale)
 * Uses multi-layered parallax with cached detail for performance
 */
export function drawRooftopCityscape(
  ctx: CanvasRenderingContext2D,
  camera: { x: number; y: number },
  canvas: HTMLCanvasElement,
  totalTimeMs: number,
  visualSettings: { skyline: boolean }
): void {
  if (!visualSettings.skyline) return;
  
  // Rooftop-sunset only renders the 'near' layer (platforms)
  const isRooftopSunset = true;
  
  type CityLayerId = 'far' | 'mid' | 'near';
  type CityLayerConfig = {
    id: CityLayerId;
    parallax: number;
    spacing: number;
    chunkSpan: number;
    marginSpan: number;
    baseRatio: number;
    height: { min: number; max: number };
    width: { min: number; max: number };
    alpha: number;
    timeSliceMs: number;
    palette: {
      top: string;
      bottom: string;
      stroke: string;
      side: string;
      roof: string;
      neon: string[];
      fogTint: string;
    };
    windows: {
      offsetX: number;
      offsetY: number;
      stepX: number;
      stepY: number;
      width: number;
      height: number;
      litChance: number;
      colorLit: string[];
      colorUnlit: string;
      accentChance: number;
    };
    detail: {
      towerChance: number;
      antennaChance: number;
      billboardChance: number;
      skybridgeChance: number;
      sideDepth: number;
    };
  };

  const screenW = canvas.clientWidth;
  const screenH = canvas.clientHeight;
  const layerConfigs: CityLayerConfig[] = [
    {
      id: 'far',
      parallax: 0.07,
      spacing: 180,
      chunkSpan: 24,
      marginSpan: 5,
      baseRatio: 0.4, // Shift far buildings UP for rooftop map
      height: { min: 180, max: 520 },
      width: { min: 90, max: 180 },
      alpha: 0.55,
      timeSliceMs: 3200,
      palette: {
        top: 'rgba(100,100,100,0.75)', // --neutral-grayscale
        bottom: 'rgba(70,70,70,0.92)', // --neutral-grayscale
        stroke: 'rgba(130,130,130,0.25)', // --neutral-grayscale
        side: 'rgba(60,60,60,0.65)', // --neutral-grayscale
        roof: 'rgba(90,90,90,0.25)', // --neutral-grayscale
        neon: ['rgba(220,220,220,0.35)', 'rgba(200,200,200,0.3)'], // Light grays
        fogTint: 'rgba(100,100,100,0.18)' // --neutral-grayscale
      },
      windows: {
        offsetX: 6,
        offsetY: 12,
        stepX: 18,
        stepY: 22,
        width: 10,
        height: 12,
        litChance: 0.45,
        colorLit: ['rgba(236,236,236,0.4)', 'rgba(220,220,220,0.35)'], // Light gray windows
        colorUnlit: 'rgba(35,35,35,0.85)', // --neutral-900
        accentChance: 0.12
      },
      detail: {
        towerChance: 0.32,
        antennaChance: 0.18,
        billboardChance: 0.08,
        skybridgeChance: 0.0,
        sideDepth: 12
      }
    },
    {
      id: 'mid',
      parallax: 0.12,
      spacing: 150,
      chunkSpan: 26,
      marginSpan: 6,
      baseRatio: 0.86,
      height: { min: 240, max: 620 },
      width: { min: 110, max: 220 },
      alpha: 0.72,
      timeSliceMs: 2600,
      palette: {
        top: 'rgba(58,58,58,0.82)', // --neutral-500
        bottom: 'rgba(16,16,16,0.95)', // Dark gray
        stroke: 'rgba(138,138,138,0.35)', // --neutral-300
        side: 'rgba(10,10,10,0.75)', // --neutral-900
        roof: 'rgba(176,176,176,0.32)', // --neutral-200
        neon: ['rgba(245,245,245,0.4)', 'rgba(200,200,200,0.35)', 'rgba(220,220,220,0.38)'], // Light grays
        fogTint: 'rgba(26,26,26,0.12)' // --neutral-850
      },
      windows: {
        offsetX: 10,
        offsetY: 14,
        stepX: 20,
        stepY: 20,
        width: 12,
        height: 14,
        litChance: 0.52,
        colorLit: ['rgba(236,236,236,0.55)', 'rgba(220,220,220,0.48)', 'rgba(200,200,200,0.45)'], // Various light grays
        colorUnlit: 'rgba(10,10,10,0.85)', // --neutral-900
        accentChance: 0.2
      },
      detail: {
        towerChance: 0.42,
        antennaChance: 0.35,
        billboardChance: 0.16,
        skybridgeChance: 0.18,
        sideDepth: 18
      }
    },
    {
      id: 'near',
      parallax: 1.0, // No parallax for rooftop map - buildings are platforms
      spacing: 700, // Spacing allows jumping between buildings for NYC
      chunkSpan: 28,
      marginSpan: 7,
      baseRatio: 0.68, // Balanced position - see tops with sky gap above
      height: { min: 500, max: 650 }, // Taller, more imposing skyscrapers
      width: { min: 500, max: 800 }, // Much wider buildings for detailed architecture
      alpha: 1.0, // Full visibility for rooftop map
      timeSliceMs: 2100,
      palette: {
        top: 'rgba(90,90,90,0.95)', // --neutral-300 grayscale
        bottom: 'rgba(55,55,55,0.98)', // --neutral-500 grayscale
        stroke: 'rgba(150,150,150,0.65)', // --neutral-200 grayscale
        side: 'rgba(45,45,45,0.88)', // --neutral-600 grayscale
        roof: 'rgba(100,100,100,0.55)', // --neutral grayscale
        neon: ['rgba(245,245,245,0.65)', 'rgba(220,220,220,0.6)', 'rgba(200,200,200,0.62)', 'rgba(236,236,236,0.6)'], // Light gray accents
        fogTint: 'rgba(90,90,90,0.12)' // --neutral grayscale
      },
      windows: {
        offsetX: 20,
        offsetY: 24,
        stepX: 32,
        stepY: 28,
        width: 18,
        height: 20,
        litChance: 0.72,
        colorLit: ['rgba(245,245,245,0.85)', 'rgba(236,236,236,0.82)', 'rgba(220,220,220,0.85)', 'rgba(200,200,200,0.8)', 'rgba(180,180,180,0.78)'], // Grayscale windows
        colorUnlit: 'rgba(20,20,20,0.92)', // --neutral-900
        accentChance: 0.35
      },
      detail: {
        towerChance: 0.85,
        antennaChance: 0.75,
        billboardChance: 0.5,
        skybridgeChance: 0.0,
        sideDepth: 40
      }
    }
  ];

  const timeMs = totalTimeMs;

  for (const layer of layerConfigs) {
    // For rooftop-sunset, only render the 'near' layer (the platforms)
    if (isRooftopSunset && layer.id !== 'near') continue;
    renderCityLayer(layer);
  }

  function renderCityLayer(cfg: CityLayerConfig) {
    const offsetX = camera.x * cfg.parallax;
    const chunkWidth = cfg.spacing * cfg.chunkSpan;
    const timeBucket = Math.floor(timeMs / cfg.timeSliceMs);
    const margin = cfg.spacing * cfg.marginSpan;
    const cache = cityscapeCache[cfg.id];
    
    // Calculate visible chunk range
    const viewStart = offsetX - margin;
    const viewEnd = offsetX + screenW + margin;
    const firstChunk = Math.floor(viewStart / chunkWidth);
    const lastChunk = Math.floor(viewEnd / chunkWidth);
    
    // Clean up old chunks (keep only last 5)
    const activeChunks = Array.from(cache.chunks.keys()).sort((a, b) => b - a);
    if (activeChunks.length > 5) {
      for (let i = 5; i < activeChunks.length; i++) {
        cache.chunks.delete(activeChunks[i]);
      }
    }
    
    // Process and render each visible chunk
    for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex++) {
      let chunkData = cache.chunks.get(chunkIndex);
      
      // Check if we need to create/update this chunk
      if (!chunkData || chunkData.timeBucket !== timeBucket || 
          !chunkData.canvas || chunkData.canvas.width <= 0 || chunkData.canvas.height <= 0) {
        
        const offWidth = chunkWidth + margin * 2;
        const offscreen = document.createElement('canvas');
        offscreen.width = offWidth;
        offscreen.height = screenH;
        const offCtx = offscreen.getContext('2d', { alpha: true, willReadFrequently: false });
        
        if (offCtx) {
          // Ensure canvas starts fully transparent
          offCtx.clearRect(0, 0, offWidth, screenH);
          offCtx.globalCompositeOperation = 'source-over';
          const chunkStart = chunkIndex * chunkWidth;
          const offsetBase = chunkStart - margin;
          const baseY = screenH * cfg.baseRatio;
          let prevBuilding: { x: number; y: number; w: number; h: number } | null = null;
          
          for (let worldX = offsetBase; worldX <= chunkStart + chunkWidth + margin; worldX += cfg.spacing) {
            const seed = Math.floor(worldX / cfg.spacing);
            const bw = cfg.width.min + seededRand(seed, 11) * (cfg.width.max - cfg.width.min);
            const heightVariance = seededRand(seed, 12);
            let bh = cfg.height.min + heightVariance * (cfg.height.max - cfg.height.min);
            // For rooftop-sunset, extend buildings far downward to fall off into sky
            if (isRooftopSunset && cfg.id === 'near') {
              bh = bh + 1800; // Extend 1800px below to create falling-off-screen effect
            }
            const skewDir = seededRand(seed, 13) > 0.5 ? 1 : -1;
            const skew = cfg.detail.sideDepth * (0.6 + seededRand(seed, 14));
            const bx = worldX + signedRand(seed, 15) * cfg.spacing * (isRooftopSunset && cfg.id === 'near' ? 0.15 : 0.25);
            const by = baseY - (cfg.height.min + heightVariance * (cfg.height.max - cfg.height.min)); // Top stays at original height
            const localX = bx - offsetBase;

            if (localX + bw < -margin || localX > offWidth + margin) continue;

            // Color variation for rooftop-sunset buildings
            const colorVariant = Math.floor(seededRand(seed, 99) * 4); // 4 color variants
            
            let topColor = cfg.palette.top;
            let bottomColor = cfg.palette.bottom;
            let sideColor = cfg.palette.side;
            let roofColor = cfg.palette.roof;
            
            if (isRooftopSunset && cfg.id === 'near') {
              // NYC iconic skyscraper materials - Windows Classic grayscale variants
              if (colorVariant === 0) {
                // Light gray - Art Deco style
                topColor = 'rgba(120,120,120,0.98)'; // --neutral-200
                bottomColor = 'rgba(80,80,80,0.98)'; // --neutral-350
                sideColor = 'rgba(60,60,60,0.92)'; // --neutral-450
                roofColor = 'rgba(150,150,150,0.65)'; // --neutral-175
              } else if (colorVariant === 1) {
                // Medium gray - Modern steel
                topColor = 'rgba(100,100,100,0.98)'; // --neutral-250
                bottomColor = 'rgba(70,70,70,0.98)'; // --neutral-400
                sideColor = 'rgba(50,50,50,0.92)'; // --neutral-550
                roofColor = 'rgba(130,130,130,0.65)'; // --neutral-220
              } else if (colorVariant === 2) {
                // Darker gray - Industrial
                topColor = 'rgba(90,90,90,0.98)'; // --neutral-300
                bottomColor = 'rgba(60,60,60,0.98)'; // --neutral-450
                sideColor = 'rgba(40,40,40,0.92)'; // --neutral-650
                roofColor = 'rgba(110,110,110,0.65)'; // --neutral-260
              } else {
                // Darkest gray - Charcoal
                topColor = 'rgba(75,75,75,0.98)'; // --neutral-375
                bottomColor = 'rgba(50,50,50,0.98)'; // --neutral-550
                sideColor = 'rgba(35,35,35,0.92)'; // --neutral-750
                roofColor = 'rgba(100,100,100,0.65)'; // --neutral-280
              }
            }
            
            const frontGrad = offCtx.createLinearGradient(localX, by, localX, by + bh);
            frontGrad.addColorStop(0, topColor);
            frontGrad.addColorStop(1, bottomColor);
            offCtx.fillStyle = frontGrad;
            offCtx.fillRect(localX, by, bw, bh);

            if (cfg.detail.sideDepth > 0) {
              offCtx.fillStyle = sideColor;
              offCtx.beginPath();
              if (skewDir > 0) {
                offCtx.moveTo(localX + bw, by);
                offCtx.lineTo(localX + bw + skew, by + skew * 0.6);
                offCtx.lineTo(localX + bw + skew, by + bh);
                offCtx.lineTo(localX + bw, by + bh);
              } else {
                offCtx.moveTo(localX, by);
                offCtx.lineTo(localX - skew, by + skew * 0.6);
                offCtx.lineTo(localX - skew, by + bh);
                offCtx.lineTo(localX, by + bh);
              }
              offCtx.closePath();
              offCtx.fill();
            }

            offCtx.strokeStyle = cfg.palette.stroke;
            offCtx.lineWidth = 1;
            offCtx.strokeRect(localX, by, bw, bh);

            // Roof cap with light catch
            offCtx.fillStyle = roofColor;
            offCtx.fillRect(localX - 1, by - 4, bw + 2, 4);

            // Stylized top profile
            const profileRoll = seededRand(seed, 16);
            if (profileRoll > 0.72) {
              const stepCount = 2 + Math.floor(seededRand(seed, 17) * 3);
              for (let s = 0; s < stepCount; s++) {
                const scale = 1 - s * 0.18;
                const stepW = bw * (0.7 + seededRand(seed, 18 + s) * 0.2) * scale;
                const stepX = localX + (bw - stepW) / 2;
                const stepH = 10 + seededRand(seed, 21 + s) * 20;
                offCtx.fillStyle = roofColor;
                offCtx.fillRect(stepX, by - (s + 1) * 10, stepW, stepH * 0.35);
              }
            }

            // Neon trim
            if (cfg.palette.neon.length && seededRand(seed, 23) > 0.78) {
              const neonColor = cfg.palette.neon[Math.floor(seededRand(seed, 24) * cfg.palette.neon.length)];
              const bandCount = 1 + Math.floor(seededRand(seed, 25) * 3);
              for (let b = 0; b < bandCount; b++) {
                const ny = by + 24 + b * (bh / (bandCount + 1));
                offCtx.fillStyle = neonColor;
                offCtx.fillRect(localX + 6, ny, bw - 12, 3);
              }
            }

            // Windows
            const wxStart = localX + cfg.windows.offsetX;
            const wxEnd = localX + bw - cfg.windows.offsetX - cfg.windows.width;
            const wyStart = by + cfg.windows.offsetY;
            const wyEnd = by + bh - cfg.windows.offsetY - cfg.windows.height;
            for (let wy = wyStart, wyRow = 0; wy <= wyEnd; wy += cfg.windows.stepY, wyRow++) {
              for (let wx = wxStart, wxCol = 0; wx <= wxEnd; wx += cfg.windows.stepX, wxCol++) {
                const windowSeed = seededRand(seed + wyRow * 131 + wxCol, 30);
                const lit = windowSeed < cfg.windows.litChance;
                const flicker = lit && cfg.windows.accentChance > 0 && seededRand(seed + wyRow * 173 + wxCol, 31) < cfg.windows.accentChance
                  ? 0.6 + Math.sin((timeBucket * 0.6) + seed * 0.3 + wy * 0.05) * 0.4
                  : 1;
                if (lit) {
                  const colorIndex = Math.floor(seededRand(seed + wyRow * 79 + wxCol, 32) * cfg.windows.colorLit.length) % cfg.windows.colorLit.length;
                  offCtx.fillStyle = cfg.windows.colorLit[colorIndex];
                  offCtx.globalAlpha = Math.min(1, flicker);
                  offCtx.fillRect(wx, wy, cfg.windows.width, cfg.windows.height);
                  offCtx.globalAlpha = 1;
                } else {
                  offCtx.fillStyle = cfg.windows.colorUnlit;
                  offCtx.fillRect(wx, wy, cfg.windows.width, cfg.windows.height);
                }
              }
            }

            // Towers & antennas
            if (cfg.detail.towerChance > 0 && seededRand(seed, 40) < cfg.detail.towerChance && bw > 90) {
              const towerW = bw * (0.18 + seededRand(seed, 41) * 0.18);
              const towerH = 30 + seededRand(seed, 42) * 120;
              const towerX = localX + (bw - towerW) / 2;
              offCtx.fillStyle = cfg.palette.side;
              offCtx.fillRect(towerX, by - towerH, towerW, towerH);
              if (cfg.detail.antennaChance > 0 && seededRand(seed, 43) < cfg.detail.antennaChance) {
                offCtx.strokeStyle = cfg.palette.stroke;
                offCtx.lineWidth = 2;
                offCtx.beginPath();
                offCtx.moveTo(towerX + towerW / 2, by - towerH);
                offCtx.lineTo(towerX + towerW / 2, by - towerH - 26);
                offCtx.stroke();
                const blink = (timeBucket + seed * 0.15) % 2 > 1 ? 1 : 0;
                if (blink) {
                  offCtx.fillStyle = 'rgba(255,255,255,0.95)';
                  offCtx.beginPath();
                  offCtx.arc(towerX + towerW / 2, by - towerH - 26, 3, 0, Math.PI * 2);
                  offCtx.fill();
                }
              }
            }

            if (cfg.detail.billboardChance > 0 && seededRand(seed, 44) < cfg.detail.billboardChance) {
              const boardW = bw * (0.4 + seededRand(seed, 45) * 0.25);
              const boardH = 26 + seededRand(seed, 46) * 24;
              const boardX = localX + (bw - boardW) / 2;
              const boardY = by + 30 + seededRand(seed, 47) * (bh * 0.4);
              offCtx.fillStyle = 'rgba(12,12,16,0.92)';
              offCtx.fillRect(boardX, boardY, boardW, boardH);
              const neonColor = cfg.palette.neon[Math.floor(seededRand(seed, 48) * cfg.palette.neon.length) % cfg.palette.neon.length];
              offCtx.strokeStyle = neonColor;
              offCtx.lineWidth = 2;
              offCtx.strokeRect(boardX, boardY, boardW, boardH);
              offCtx.font = '600 14px monospace';
              offCtx.fillStyle = neonColor;
              offCtx.textAlign = 'center';
              offCtx.textBaseline = 'middle';
              offCtx.fillText('NEON', boardX + boardW / 2, boardY + boardH / 2);
            }

            if (cfg.detail.skybridgeChance > 0 && prevBuilding && seededRand(seed, 50) < cfg.detail.skybridgeChance) {
              const bridgeY = Math.min(prevBuilding.y + prevBuilding.h * 0.35, by + bh * 0.35);
              const startX = prevBuilding.x + prevBuilding.w;
              const endX = localX;
              if (endX > startX + 40) {
                const thickness = 6 + seededRand(seed, 51) * 6;
                const bridgeGrad = offCtx.createLinearGradient(startX, bridgeY, endX, bridgeY + thickness);
                bridgeGrad.addColorStop(0, 'rgba(80,80,90,0.9)');
                bridgeGrad.addColorStop(1, 'rgba(50,50,60,0.75)');
                offCtx.fillStyle = bridgeGrad;
                offCtx.fillRect(startX, bridgeY, endX - startX, thickness);
                offCtx.fillStyle = 'rgba(255,255,255,0.2)';
                offCtx.fillRect(startX, bridgeY, endX - startX, 1);
              }
            }

            // Removed golden hour lighting for grayscale consistency

            if (cfg.palette.fogTint) {
              const fogGradient = offCtx.createLinearGradient(localX, by, localX, by + bh);
              fogGradient.addColorStop(0, 'rgba(0,0,0,0)');
              fogGradient.addColorStop(1, cfg.palette.fogTint);
              offCtx.fillStyle = fogGradient;
              offCtx.fillRect(localX, by, bw, bh);
            }

            prevBuilding = { x: localX, y: by, w: bw, h: bh };
          }

          // Store in cache
          chunkData = {
            canvas: offscreen,
            timeBucket: timeBucket,
            offsetBase: offsetBase
          };
          cache.chunks.set(chunkIndex, chunkData);
        } else {
          // If context creation failed, don't cache this chunk
          console.warn(`Failed to create canvas context for chunk ${chunkIndex} in layer ${cfg.id}`);
        }
      }
      
      // Render this chunk
      if (chunkData && chunkData.canvas && chunkData.canvas.width > 0 && chunkData.canvas.height > 0) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = cfg.alpha;
        const drawX = chunkData.offsetBase - offsetX;
        // Only draw if the chunk is actually visible on screen
        if (drawX < screenW && drawX + chunkData.canvas.width > 0) {
          ctx.drawImage(chunkData.canvas, drawX, 0);
        }
        ctx.restore();
      }
    }
  }
}

/**
 * Initialize rooftops state
 */
export function initRooftopsState(): RooftopsState {
  return {
    initialized: true,
  };
}

