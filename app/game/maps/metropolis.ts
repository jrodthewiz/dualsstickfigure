/**
 * Metropolis / NYC Rooftop Map
 * 
 * This module handles all rooftop/metropolis map logic including:
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

// ============================================================================
// TYPES
// ============================================================================

export interface MetropolisState {
  // Add any state-specific data here if needed in the future
  initialized: boolean;
}

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

// Seeded random function
const seededRand = (seed: number, offset: number = 0): number => {
  const x = Math.sin(seed + offset) * 10000;
  return x - Math.floor(x);
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

    const rooftopY = world.baseGroundY - building.height;
    let buildingPlatform = platforms.find(
      (p) => p.isRooftop && !p.isRooftopFeature && p.rooftopKey === buildingKey
    );

    if (!buildingPlatform) {
      buildingPlatform = {
        x: building.x,
        y: rooftopY,
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
      console.log(`Created rooftop platform for ${building.id}: x=${building.x}, y=${rooftopY}, width=${building.width}, height=${rooftopThickness}`);
    } else {
      buildingPlatform.x = building.x;
      buildingPlatform.y = rooftopY;
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

  const beforeCleanup = platforms.length;
  for (let i = platforms.length - 1; i >= 0; i--) {
    const p = platforms[i];
    if (p.isRooftop && (!p.rooftopKey || !allowedKeys.has(p.rooftopKey))) {
      console.log(`Removing invalid rooftop platform:`, p);
      platforms.splice(i, 1);
    }
  }
  const afterCleanup = platforms.length;
  if (beforeCleanup !== afterCleanup) {
    console.log(`Cleanup removed ${beforeCleanup - afterCleanup} platforms`);
  }

  console.log(`ensureRooftopPlatforms: Created ${platforms.filter(p => p.isRooftop).length} rooftop platforms, returning closest:`, closest);
  return closest;
}

// ============================================================================
// VISUAL RENDERING
// ============================================================================

// Color palettes for different building styles - Windows Classic grayscale theme
// Matches theme tokens from app/theme/tokens.ts and app/theme/css-vars.css
const rooftopStylePalette: Record<RooftopBuildingStyle, {
  top: string;
  bottom: string;
  window: string;
  highlight: string;
  roofLine: string;
  side: string;
  pad: string;
}> = {
  'art-deco': {
    top: '#c8c8c8',          // --neutral-150
    bottom: '#6a6a6a',       // --neutral-400
    window: '#ececec',       // --neutral-100 (lit windows)
    highlight: 'rgba(255,255,255,0.35)',  // --bevel-light
    roofLine: '#f5f5f5',     // --neutral-050
    side: 'rgba(0,0,0,0.55)', // --bevel-dark
    pad: '#8a8a8a',          // --neutral-300
  },
  glass: {
    top: '#b0b0b0',          // --neutral-200
    bottom: '#5a5a5a',       // --neutral-500
    window: '#ffffff',       // --neutral-white (glass reflections)
    highlight: 'rgba(255,255,255,0.35)',
    roofLine: '#dcdcdc',     // --neutral-120
    side: 'rgba(0,0,0,0.55)',
    pad: '#6a6a6a',          // --neutral-400
  },
  copper: {
    top: '#b0b0b0',          // --neutral-200
    bottom: '#4a4a4a',       // --neutral-600
    window: '#f5f5f5',       // --neutral-050
    highlight: 'rgba(255,255,255,0.35)',
    roofLine: '#c8c8c8',     // --neutral-150
    side: 'rgba(0,0,0,0.55)',
    pad: '#6a6a6a',          // --neutral-400
  },
  charcoal: {
    top: '#5a5a5a',          // --neutral-500 (darkest buildings)
    bottom: '#2a2a2a',       // --neutral-800
    window: '#ececec',       // --neutral-100
    highlight: 'rgba(255,255,255,0.18)',
    roofLine: '#8a8a8a',     // --neutral-300
    side: 'rgba(0,0,0,0.55)',
    pad: '#4a4a4a',          // --neutral-600
  },
};

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
  const rooftopThickness = rooftopConfig.rooftopThickness ?? 40;

  for (const building of rooftopConfig.buildings) {
    const buildingRight = building.x + building.width;
    if (buildingRight < viewportLeft || building.x > viewportRight) continue;

    const palette = rooftopStylePalette[building.style] ?? rooftopStylePalette['charcoal'];
    const px = building.x;
    const pw = building.width;
    const rooftopY = world.baseGroundY - building.height;
    const py = rooftopY;
    const groundY = world.baseGroundY;

    // Draw building body with gradient
    const buildingGrad = ctx.createLinearGradient(px, py, px, groundY);
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

    // Windows Classic structured window grid
    const seed = hashStringToSeed(building.id);
    const windowCols = Math.max(1, Math.floor(pw / 70));
    const windowRows = Math.max(1, Math.floor(building.height / 60));
    
    for (let row = 0; row < windowRows; row++) {
      for (let col = 0; col < windowCols; col++) {
        const wx = px + 25 + col * 70;
        const wy = py + 25 + row * 60;
        if (wx + 25 > px + pw - 20 || wy + 40 > groundY - 10) continue;
        const glow = seededRand(seed, row * 97 + col * 131);
        
        if (glow > 0.2) {
          // Window with classic beveled inset look
          const alpha = 0.45 + glow * 0.4;
          
          // Main window fill
          ctx.fillStyle = palette.window;
          ctx.globalAlpha = alpha;
          ctx.fillRect(wx, wy, 25, 40);
          ctx.globalAlpha = 1;
          
          // Windows Classic bevel - dark top/left, light bottom/right (inset)
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(wx, wy + 40);
          ctx.lineTo(wx, wy);
          ctx.lineTo(wx + 25, wy);
          ctx.stroke();
          
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.beginPath();
          ctx.moveTo(wx + 25, wy);
          ctx.lineTo(wx + 25, wy + 40);
          ctx.lineTo(wx, wy + 40);
          ctx.stroke();
        }
      }
    }

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
 * Draw city street decorations (cars, streetlights)
 * OPTIMIZED for performance with batched draw calls
 */
export function drawCityStreetDecor(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
  canvas: HTMLCanvasElement
): void {
  ctx.save();
  // Properly snap both edges to the grid to prevent spawning/despawning
  const decorX0 = Math.floor((camera.x - 200) / 240) * 240;
  const decorX1 = Math.ceil((camera.x + canvas.clientWidth + 200) / 240) * 240;
  const groundY = world.baseGroundY;
  
  for (let x = decorX0; x <= decorX1; x += 240) {
    const seed = Math.abs(Math.floor(x / 10));
    const roll = seededRand(seed, 510);
    const posX = x + seededRand(seed, 511) * 140;
    const baseY = groundY;
    
    if (roll < 0.45) {
      // Cars - Windows Classic grayscale theme with bevels
      const bodyColor = roll < 0.15 ? '#2a2a2a' : roll < 0.25 ? '#4a4a4a' : roll < 0.35 ? '#6a6a6a' : '#8a8a8a';
      const carWidth = 110;
      const carHeight = 28;
      const carY = baseY - carHeight - 6;
      
      // Wheels with bevel
      ctx.fillStyle = '#000000'; // --neutral-black
      ctx.fillRect(posX - carWidth / 2 + 16, carY + carHeight - 4, 16, 8);
      ctx.fillRect(posX + carWidth / 2 - 32, carY + carHeight - 4, 16, 8);
      
      // Wheel highlights
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(posX - carWidth / 2 + 16, carY + carHeight - 4, 16, 2);
      ctx.fillRect(posX + carWidth / 2 - 32, carY + carHeight - 4, 16, 2);
      
      // Car body with Windows Classic raised bevel
      ctx.fillStyle = bodyColor;
      ctx.fillRect(posX - carWidth / 2, carY, carWidth, carHeight);
      
      // Classic 3D bevel on car body
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(posX + carWidth / 2, carY);
      ctx.lineTo(posX - carWidth / 2, carY);
      ctx.lineTo(posX - carWidth / 2, carY + carHeight);
      ctx.stroke();
      
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.moveTo(posX - carWidth / 2, carY + carHeight);
      ctx.lineTo(posX + carWidth / 2, carY + carHeight);
      ctx.lineTo(posX + carWidth / 2, carY);
      ctx.stroke();
      
      // Cabin (darker than body) with inset bevel
      ctx.fillStyle = '#1a1a1a'; // --neutral-850
      ctx.fillRect(posX - carWidth / 2 + 10, carY + 6, carWidth - 20, carHeight - 12);
      
      // Cabin inset bevel
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(posX - carWidth / 2 + 10, carY + 6, carWidth - 20, carHeight - 12);
      
      // Windows (light gray) with bevel
      ctx.fillStyle = '#c8c8c8'; // --neutral-150
      ctx.fillRect(posX - carWidth / 2 + 14, carY + 8, carWidth - 28, carHeight - 18);
      
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(posX - carWidth / 2 + 14, carY + 8, carWidth - 28, carHeight - 18);
      
      // Lights with glow
      ctx.fillStyle = '#ffffff'; // --neutral-white (headlights)
      ctx.fillRect(posX - carWidth / 2 + 4, carY + 6, 6, 8);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.strokeRect(posX - carWidth / 2 + 3, carY + 5, 8, 10);
      
      ctx.fillStyle = '#ececec'; // --neutral-100 (taillights)
      ctx.fillRect(posX + carWidth / 2 - 10, carY + 6, 6, 8);
      ctx.strokeStyle = 'rgba(236,236,236,0.5)';
      ctx.strokeRect(posX + carWidth / 2 - 11, carY + 5, 8, 10);
      
    } else if (roll > 0.75) {
      // Streetlights - Windows Classic grayscale theme
      const poleHeight = 160 + seededRand(seed, 520) * 80;
      const poleX = posX;
      
      // Pole - medium gray
      ctx.strokeStyle = '#5a5a5a'; // --neutral-500
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(poleX, baseY);
      ctx.lineTo(poleX, baseY - poleHeight);
      ctx.stroke();
      
      // Light bulb outer glow - very light gray
      ctx.fillStyle = '#f5f5f5'; // --neutral-050
      ctx.beginPath();
      ctx.arc(poleX, baseY - poleHeight - 12, 16, 0, Math.PI * 2);
      ctx.fill();
      
      // Light bulb inner core - pure white
      ctx.fillStyle = '#ffffff'; // --neutral-white
      ctx.beginPath();
      ctx.arc(poleX, baseY - poleHeight - 12, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ============================================================================
// BACKGROUND CITYSCAPE
// ============================================================================

// Cache for cityscape chunks
interface CityChunkData {
  canvas: HTMLCanvasElement;
  timeBucket: number;
  offsetBase: number;
}

const metropolisCityscapeCache: {
  far: { chunks: Map<number, CityChunkData> };
  mid: { chunks: Map<number, CityChunkData> };
  near: { chunks: Map<number, CityChunkData> };
} = {
  far: { chunks: new Map() },
  mid: { chunks: new Map() },
  near: { chunks: new Map() }
};

/**
 * Draw metropolis background cityscape with Windows Classic grayscale theme
 */
export function drawMetropolisCityscape(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  canvas: HTMLCanvasElement,
  totalTimeMs: number,
  visualSettings: { skyline: boolean }
): void {
  if (!visualSettings.skyline) return;

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
      baseRatio: 0.75,
      height: { min: 180, max: 520 },
      width: { min: 90, max: 180 },
      alpha: 0.55,
      timeSliceMs: 3200,
      palette: {
        top: 'rgba(58,58,58,0.75)', // --neutral-700 (#3a3a3a)
        bottom: 'rgba(10,10,10,0.92)', // --neutral-900
        stroke: 'rgba(138,138,138,0.25)', // --neutral-300
        side: 'rgba(0,0,0,0.65)', // --neutral-black
        roof: 'rgba(106,106,106,0.25)', // --neutral-400 (#6a6a6a)
        neon: ['rgba(236,236,236,0.25)', 'rgba(200,200,200,0.2)'], // --neutral-100, --neutral-200
        fogTint: 'rgba(26,26,26,0.18)' // --neutral-850
      },
      windows: {
        offsetX: 6,
        offsetY: 12,
        stepX: 18,
        stepY: 22,
        width: 10,
        height: 12,
        litChance: 0.45,
        colorLit: ['rgba(236,236,236,0.35)', 'rgba(220,220,220,0.28)'], // --neutral-100, --neutral-120
        colorUnlit: 'rgba(10,10,10,0.85)', // --neutral-900
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
        top: 'rgba(74,74,74,0.82)', // --neutral-600 (#4a4a4a)
        bottom: 'rgba(10,10,10,0.95)', // --neutral-900
        stroke: 'rgba(138,138,138,0.35)', // --neutral-300
        side: 'rgba(0,0,0,0.75)', // --neutral-black
        roof: 'rgba(176,176,176,0.32)', // --neutral-200
        neon: ['rgba(245,245,245,0.4)', 'rgba(220,220,220,0.35)', 'rgba(200,200,200,0.38)'], // --neutral-050, --neutral-120, --neutral-200
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
        colorLit: ['rgba(236,236,236,0.55)', 'rgba(220,220,220,0.48)', 'rgba(200,200,200,0.45)'], // --neutral-100, --neutral-120, --neutral-200
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
      parallax: 0.19,
      spacing: 140,
      chunkSpan: 28,
      marginSpan: 7,
      baseRatio: 0.95,
      height: { min: 320, max: 720 },
      width: { min: 140, max: 260 },
      alpha: 0.85,
      timeSliceMs: 2100,
      palette: {
        top: 'rgba(90,90,90,0.92)', // --neutral-500 (#5a5a5a)
        bottom: 'rgba(26,26,26,0.98)', // --neutral-850 (#1a1a1a)
        stroke: 'rgba(200,200,200,0.45)', // --neutral-200
        side: 'rgba(10,10,10,0.82)', // --neutral-900
        roof: 'rgba(220,220,220,0.4)', // --neutral-120
        neon: ['rgba(255,255,255,0.65)', 'rgba(236,236,236,0.6)', 'rgba(220,220,220,0.65)', 'rgba(200,200,200,0.55)'], // --neutral-white, --neutral-100, --neutral-120, --neutral-200
        fogTint: 'rgba(26,26,26,0.08)' // --neutral-850
      },
      windows: {
        offsetX: 20,
        offsetY: 24,
        stepX: 32,
        stepY: 28,
        width: 18,
        height: 20,
        litChance: 0.72,
        colorLit: ['rgba(245,245,245,0.75)', 'rgba(236,236,236,0.72)', 'rgba(220,220,220,0.7)'], // --neutral-050, --neutral-100, --neutral-120
        colorUnlit: 'rgba(10,10,10,0.88)', // --neutral-900
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

  for (const layer of layerConfigs) {
    renderMetropolisCityLayer(ctx, camera, canvas, layer, totalTimeMs, screenW, screenH);
  }
}

function renderMetropolisCityLayer(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  canvas: HTMLCanvasElement,
  cfg: any,
  timeMs: number,
  screenW: number,
  screenH: number
): void {
  const offsetX = camera.x * cfg.parallax;
  const chunkWidth = cfg.spacing * cfg.chunkSpan;
  const timeBucket = Math.floor(timeMs / cfg.timeSliceMs);
  const margin = cfg.spacing * cfg.marginSpan;
  const cache = metropolisCityscapeCache[cfg.id as 'far' | 'mid' | 'near'];
  
  const viewStart = offsetX - margin;
  const viewEnd = offsetX + screenW + margin;
  const firstChunk = Math.floor(viewStart / chunkWidth);
  const lastChunk = Math.floor(viewEnd / chunkWidth);
  
  const activeChunks = Array.from(cache.chunks.keys()).sort((a, b) => b - a);
  if (activeChunks.length > 5) {
    for (let i = 5; i < activeChunks.length; i++) {
      cache.chunks.delete(activeChunks[i]);
    }
  }
  
  for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex++) {
    let chunkData = cache.chunks.get(chunkIndex);
    
    if (!chunkData || chunkData.timeBucket !== timeBucket || 
        !chunkData.canvas || chunkData.canvas.width <= 0 || chunkData.canvas.height <= 0) {
      
      const offWidth = chunkWidth + margin * 2;
      const offscreen = document.createElement('canvas');
      offscreen.width = offWidth;
      offscreen.height = screenH;
      const offCtx = offscreen.getContext('2d', { alpha: true, willReadFrequently: false });
      
      if (offCtx) {
        offCtx.clearRect(0, 0, offWidth, screenH);
        offCtx.globalCompositeOperation = 'source-over';
        const chunkStart = chunkIndex * chunkWidth;
        const offsetBase = chunkStart - margin;
        const baseY = screenH * cfg.baseRatio;
        let prevBuilding: { x: number; y: number; w: number; h: number } | null = null;
        
        for (let worldX = offsetBase; worldX <= chunkStart + chunkWidth + margin; worldX += cfg.spacing) {
          const seed = Math.floor(worldX / cfg.spacing);
          const bw = cfg.width.min + seededRand(seed, 11) * (cfg.width.max - cfg.width.min);
          const bh = cfg.height.min + seededRand(seed, 12) * (cfg.height.max - cfg.height.min);
          const skewDir = seededRand(seed, 13) > 0.5 ? 1 : -1;
          const skew = cfg.detail.sideDepth * (0.6 + seededRand(seed, 14));
          const bx = worldX + signedRand(seed, 15) * cfg.spacing * 0.25;
          const by = baseY - bh;
          const localX = bx - offsetBase;

          if (localX + bw < -margin || localX > offWidth + margin) continue;

          const frontGrad = offCtx.createLinearGradient(localX, by, localX, by + bh);
          frontGrad.addColorStop(0, cfg.palette.top);
          frontGrad.addColorStop(1, cfg.palette.bottom);
          offCtx.fillStyle = frontGrad;
          offCtx.fillRect(localX, by, bw, bh);

          if (cfg.detail.sideDepth > 0) {
            offCtx.fillStyle = cfg.palette.side;
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

          // Windows Classic building outline with bevel
          offCtx.strokeStyle = cfg.palette.stroke;
          offCtx.lineWidth = 1;
          offCtx.strokeRect(localX, by, bw, bh);
          
          // Subtle raised bevel on building edges
          offCtx.strokeStyle = 'rgba(255,255,255,0.15)';
          offCtx.lineWidth = 1;
          offCtx.beginPath();
          offCtx.moveTo(localX + bw, by);
          offCtx.lineTo(localX, by);
          offCtx.lineTo(localX, by + bh);
          offCtx.stroke();
          
          offCtx.strokeStyle = 'rgba(0,0,0,0.2)';
          offCtx.beginPath();
          offCtx.moveTo(localX, by + bh);
          offCtx.lineTo(localX + bw, by + bh);
          offCtx.lineTo(localX + bw, by);
          offCtx.stroke();

          // Rooftop with classic raised bevel
          offCtx.fillStyle = cfg.palette.roof;
          offCtx.fillRect(localX - 1, by - 4, bw + 2, 4);
          
          // Bevel highlight on roof
          offCtx.strokeStyle = 'rgba(255,255,255,0.25)';
          offCtx.lineWidth = 1;
          offCtx.beginPath();
          offCtx.moveTo(localX - 1, by - 4);
          offCtx.lineTo(localX + bw + 1, by - 4);
          offCtx.stroke();

          // ===== PERFORMANCE: Batch windows instead of individual stroke operations =====
          // Collect window data first
          const litWins: Array<{wx: number; wy: number; colorIdx: number}> = [];
          const unlitWins: Array<{wx: number; wy: number}> = [];
          
          for (let wy = by + cfg.windows.offsetY; wy <= by + bh - cfg.windows.offsetY - cfg.windows.height; wy += cfg.windows.stepY) {
            for (let wx = localX + cfg.windows.offsetX; wx <= localX + bw - cfg.windows.offsetX - cfg.windows.width; wx += cfg.windows.stepX) {
              const lit = seededRand(seed + wy + wx, 30) < cfg.windows.litChance;
              
              if (lit) {
                const colorIndex = Math.floor(seededRand(seed + wy * 2 + wx, 32) * cfg.windows.colorLit.length);
                litWins.push({wx, wy, colorIdx: colorIndex});
              } else {
                unlitWins.push({wx, wy});
              }
            }
          }
          
          // Draw all lit windows by color group (minimize fillStyle changes)
          for (let c = 0; c < cfg.windows.colorLit.length; c++) {
            offCtx.fillStyle = cfg.windows.colorLit[c];
            for (const win of litWins) {
              if (win.colorIdx === c) {
                offCtx.fillRect(win.wx, win.wy, cfg.windows.width, cfg.windows.height);
              }
            }
          }
          
          // Batch all lit window bevels - dark edges
          offCtx.strokeStyle = 'rgba(0,0,0,0.3)';
          offCtx.lineWidth = 0.5;
          offCtx.beginPath();
          for (const win of litWins) {
            offCtx.moveTo(win.wx, win.wy + cfg.windows.height);
            offCtx.lineTo(win.wx, win.wy);
            offCtx.lineTo(win.wx + cfg.windows.width, win.wy);
          }
          offCtx.stroke();
          
          // Batch all lit window bevels - light edges
          offCtx.strokeStyle = 'rgba(255,255,255,0.2)';
          offCtx.beginPath();
          for (const win of litWins) {
            offCtx.moveTo(win.wx + cfg.windows.width, win.wy);
            offCtx.lineTo(win.wx + cfg.windows.width, win.wy + cfg.windows.height);
            offCtx.lineTo(win.wx, win.wy + cfg.windows.height);
          }
          offCtx.stroke();
          
          // Draw all unlit windows together
          offCtx.fillStyle = cfg.windows.colorUnlit;
          for (const win of unlitWins) {
            offCtx.fillRect(win.wx, win.wy, cfg.windows.width, cfg.windows.height);
          }
          
          // Batch unlit window outlines
          offCtx.strokeStyle = 'rgba(0,0,0,0.4)';
          offCtx.lineWidth = 0.5;
          offCtx.beginPath();
          for (const win of unlitWins) {
            offCtx.rect(win.wx, win.wy, cfg.windows.width, cfg.windows.height);
          }
          offCtx.stroke();

          if (cfg.palette.fogTint) {
            const fogGradient = offCtx.createLinearGradient(localX, by, localX, by + bh);
            fogGradient.addColorStop(0, 'rgba(0,0,0,0)');
            fogGradient.addColorStop(1, cfg.palette.fogTint);
            offCtx.fillStyle = fogGradient;
            offCtx.fillRect(localX, by, bw, bh);
          }

          prevBuilding = { x: localX, y: by, w: bw, h: bh };
        }

        chunkData = {
          canvas: offscreen,
          timeBucket: timeBucket,
          offsetBase: offsetBase
        };
        cache.chunks.set(chunkIndex, chunkData);
      }
    }
    
    if (chunkData && chunkData.canvas && chunkData.canvas.width > 0 && chunkData.canvas.height > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = cfg.alpha;
      const drawX = chunkData.offsetBase - offsetX;
      if (drawX < screenW && drawX + chunkData.canvas.width > 0) {
        ctx.drawImage(chunkData.canvas, drawX, 0);
      }
      ctx.restore();
    }
  }
}

// Helper function
const signedRand = (seed: number, offset: number): number => {
  return seededRand(seed, offset) * 2 - 1;
};

// ============================================================================
// BOUNDARY WALLS
// ============================================================================

/**
 * Draw metropolis boundary walls - Windows Classic theme
 */
export function drawMetropolisBoundaryWalls(
  ctx: CanvasRenderingContext2D,
  boundaries: { left: number; right: number },
  camera: Camera,
  world: World,
  canvas: HTMLCanvasElement
): void {
  ctx.save();
  
  const wallWidth = 60;
  const wallHeight = 2000;
  const groundY = world.baseGroundY;
  
  // Left boundary
  if (boundaries.left >= camera.x - 200 && boundaries.left <= camera.x + canvas.clientWidth + 200) {
    // Solid dark backing - Windows Classic gradient
    const gradient = ctx.createLinearGradient(boundaries.left - wallWidth, groundY - wallHeight, boundaries.left, groundY - wallHeight);
    gradient.addColorStop(0, '#000000'); // --neutral-black
    gradient.addColorStop(1, '#2a2a2a'); // --neutral-800
    ctx.fillStyle = gradient;
    ctx.fillRect(boundaries.left - wallWidth, groundY - wallHeight, wallWidth, wallHeight);
    
    // Windows Classic beveled panels
    ctx.fillStyle = 'rgba(90, 90, 90, 0.2)'; // --neutral-500
    for (let y = groundY - wallHeight + 40; y < groundY - 40; y += 100) {
      ctx.fillRect(boundaries.left - wallWidth + 8, y, wallWidth - 16, 80);
      // Bevel effect - light top/left, dark bottom/right
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.35)'; // --neutral-200 (bevel-light)
      ctx.lineWidth = 2;
      ctx.strokeRect(boundaries.left - wallWidth + 8, y, wallWidth - 16, 80);
    }
    
    // Strong border - Windows Classic white border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // --border-strong
    ctx.lineWidth = 3;
    ctx.strokeRect(boundaries.left - wallWidth, groundY - wallHeight, wallWidth, wallHeight);
  }
  
  // Right boundary
  if (boundaries.right >= camera.x - 200 && boundaries.right <= camera.x + canvas.clientWidth + 200) {
    // Solid dark backing - Windows Classic gradient
    const gradient = ctx.createLinearGradient(boundaries.right, groundY - wallHeight, boundaries.right + wallWidth, groundY - wallHeight);
    gradient.addColorStop(0, '#2a2a2a'); // --neutral-800
    gradient.addColorStop(1, '#000000'); // --neutral-black
    ctx.fillStyle = gradient;
    ctx.fillRect(boundaries.right, groundY - wallHeight, wallWidth, wallHeight);
    
    // Windows Classic beveled panels
    ctx.fillStyle = 'rgba(90, 90, 90, 0.2)'; // --neutral-500
    for (let y = groundY - wallHeight + 40; y < groundY - 40; y += 100) {
      ctx.fillRect(boundaries.right + 8, y, wallWidth - 16, 80);
      // Bevel effect
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.35)'; // --neutral-200 (bevel-light)
      ctx.lineWidth = 2;
      ctx.strokeRect(boundaries.right + 8, y, wallWidth - 16, 80);
    }
    
    // Strong border - Windows Classic white border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // --border-strong
    ctx.lineWidth = 3;
    ctx.strokeRect(boundaries.right, groundY - wallHeight, wallWidth, wallHeight);
  }
  
  ctx.restore();
}

/**
 * Draw metropolis atmospheric fog overlay - Windows Classic theme
 */
export function drawMetropolisFog(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const fog = ctx.createLinearGradient(0, canvas.clientHeight * 0.25, 0, canvas.clientHeight);
  fog.addColorStop(0, 'rgba(26,26,26,0)'); // --neutral-850 (transparent)
  fog.addColorStop(1, 'rgba(0,0,0,0.28)'); // --neutral-black
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.restore();
}

/**
 * Draw stars for metropolis - Windows Classic grayscale
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
    ctx.fillStyle = '#b0b0b0'; // --neutral-200 Grayscale stars
    ctx.fillRect(x % w, y % h, s.s, s.s);
  }
  ctx.globalAlpha = 1;
}

/**
 * Draw clouds for metropolis - Windows Classic grayscale night clouds
 */
export function drawMetropolisClouds(
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
  
  // Dark grayscale clouds for night city
  const rows = 3;
  for (let i = 0; i < rows; i++) {
    const speed = 20 + i * 15;
    const y = h * (0.15 + i * 0.1);
    ctx.globalAlpha = 0.08 + i * 0.04;
    ctx.fillStyle = '#8a8a8a'; // --neutral-300 grayscale
    const offset = (totalTimeMs * 0.001 * speed) % (w + 400);
    for (let x = -400; x < w + 400; x += 160) {
      const n = perlinNoise((x + offset) * 0.002 + i * 10);
      const wv = 200 + n * 80;
      ctx.beginPath();
      ctx.ellipse(x + offset, y + Math.sin((x + offset) * 0.01) * 6, wv, 26 + n * 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * Draw metropolis ground terrain - Windows Classic grayscale
 */
export function drawMetropolisGround(
  ctx: CanvasRenderingContext2D,
  camera: { x: number; y: number },
  canvas: HTMLCanvasElement,
  world: { baseGroundY: number; noiseScale: number; terrainAmplitude: number },
  perlinNoise: (x: number) => number
): void {
  const x0 = camera.x - 50;
  const x1 = camera.x + canvas.clientWidth + 50;
  
  // Helper to calculate ground Y with perlin noise undulation
  const groundYAt = (xWorld: number): number => {
    const n = perlinNoise(xWorld * world.noiseScale);
    const undulation = (n - 0.5) * 2 * world.terrainAmplitude;
    return world.baseGroundY + undulation;
  };
  
  // Draw ground terrain
  ctx.beginPath();
  const step = 3;
  for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
    const y = groundYAt(x);
    if (x === Math.floor(x0 / step) * step) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(x1, canvas.clientHeight + camera.y + 2000);
  ctx.lineTo(x0, canvas.clientHeight + camera.y + 2000);
  ctx.closePath();
  
  // Windows Classic grayscale ground - darker than suburban
  const grd = ctx.createLinearGradient(0, world.baseGroundY - 200, 0, canvas.clientHeight);
  grd.addColorStop(0, "#2a2a2a"); // --neutral-800
  grd.addColorStop(0.5, "#1a1a1a"); // --neutral-850
  grd.addColorStop(1, "#0a0a0a"); // --neutral-900
  ctx.fillStyle = grd;
  ctx.fill();
  
  // Grayscale outline
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(200, 200, 200, 0.6)"; // --neutral-200 (Windows Classic border)
  ctx.stroke();
}

/**
 * Draw skybridges connecting nearby buildings - Windows Classic grayscale
 */
export function drawMetropolisSkybridges(
  ctx: CanvasRenderingContext2D,
  camera: { x: number; y: number },
  canvas: HTMLCanvasElement,
  platforms: any[]
): void {
  // Connect nearby buildings at similar heights
  const maxPairs = 12;
  let drawn = 0;
  const left = camera.x - 100;
  const right = camera.x + canvas.clientWidth + 100;
  const top = camera.y - 200;
  const bottom = camera.y + canvas.clientHeight + 200;
  const visiblePlatforms = platforms.filter(p => p.x + p.width >= left && p.x <= right && p.y + p.height >= top && p.y <= bottom);
  
  for (let i = 0; i < visiblePlatforms.length && drawn < maxPairs; i++) {
    const a = visiblePlatforms[i];
    for (let j = i + 1; j < visiblePlatforms.length && drawn < maxPairs; j++) {
      const b = visiblePlatforms[j];
      const dy = Math.abs(a.y - b.y);
      const horizDist = Math.abs((a.x + a.width / 2) - (b.x + b.width / 2));
      if (dy < 16 && horizDist < 420) {
        const x0 = Math.min(a.x + a.width, b.x + b.width) + 2;
        const y = (a.y + b.y) / 2 + 10;
        const w = Math.max(40, Math.min(220, horizDist - 20));
        const leftPos = Math.min(a.x + a.width, b.x + b.width) - w - 8;
        
        // Grayscale skybridge
        ctx.fillStyle = 'rgba(60,60,60,0.3)'; // --neutral grayscale
        ctx.strokeStyle = 'rgba(180,180,180,0.5)'; // --neutral-200 grayscale
        ctx.lineWidth = 2;
        ctx.fillRect(leftPos, y, w, 6);
        ctx.strokeRect(leftPos, y, w, 6);
        drawn++;
      }
    }
  }
}

/**
 * Initialize metropolis state
 */
export function initMetropolisState(): MetropolisState {
  return {
    initialized: true,
  };
}

