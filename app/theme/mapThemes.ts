/**
 * Centralized Map Theme Configuration
 * Windows Classic Grayscale Theme for all maps
 * 
 * This file provides consistent color schemes across all maps.
 * Update colors here to change the theme for all maps simultaneously.
 */

// ============================================================================
// WINDOWS CLASSIC GRAYSCALE COLOR TOKENS
// ============================================================================

export const WINDOWS_CLASSIC_COLORS = {
  // Core neutrals
  white: '#ffffff',
  neutral050: '#f5f5f5',
  neutral100: '#ececec',
  neutral120: '#dcdcdc',
  neutral150: '#c8c8c8',
  neutral200: '#b0b0b0',
  neutral250: '#a0a0a0',
  neutral280: '#949494',
  neutral300: '#8a8a8a',
  neutral320: '#808080',
  neutral350: '#757575',
  neutral400: '#6a6a6a',
  neutral500: '#5a5a5a',
  neutral600: '#4a4a4a',
  neutral700: '#3a3a3a',
  neutral800: '#2a2a2a',
  neutral850: '#1a1a1a',
  neutral900: '#0a0a0a',
  black: '#000000',
  
  // Windows Classic UI colors
  silver: '#c0c0c0',
  buttonFace: '#c0c0c0',
  buttonHighlight: 'rgba(255,255,255,0.5)',
  buttonShadow: 'rgba(0,0,0,0.6)',
  
  // Functional colors (grayscale variants)
  success: '#b0b0b0',
  warning: '#8a8a8a',
  danger: '#6a6a6a',
  info: '#9a9a9a',
} as const;

// ============================================================================
// BUILDING STYLE PALETTES
// ============================================================================

export const BUILDING_PALETTES = {
  'art-deco': {
    top: WINDOWS_CLASSIC_COLORS.neutral150,
    bottom: WINDOWS_CLASSIC_COLORS.neutral400,
    window: WINDOWS_CLASSIC_COLORS.neutral100,
    highlight: 'rgba(255,255,255,0.35)',
    roofLine: WINDOWS_CLASSIC_COLORS.neutral050,
    side: 'rgba(0,0,0,0.55)',
    pad: WINDOWS_CLASSIC_COLORS.neutral300,
  },
  'glass': {
    top: WINDOWS_CLASSIC_COLORS.neutral200,
    bottom: WINDOWS_CLASSIC_COLORS.neutral500,
    window: WINDOWS_CLASSIC_COLORS.white,
    highlight: 'rgba(255,255,255,0.35)',
    roofLine: WINDOWS_CLASSIC_COLORS.neutral120,
    side: 'rgba(0,0,0,0.55)',
    pad: WINDOWS_CLASSIC_COLORS.neutral400,
  },
  'copper': {
    top: WINDOWS_CLASSIC_COLORS.neutral200,
    bottom: WINDOWS_CLASSIC_COLORS.neutral600,
    window: WINDOWS_CLASSIC_COLORS.neutral050,
    highlight: 'rgba(255,255,255,0.35)',
    roofLine: WINDOWS_CLASSIC_COLORS.neutral150,
    side: 'rgba(0,0,0,0.55)',
    pad: WINDOWS_CLASSIC_COLORS.neutral400,
  },
  'charcoal': {
    top: WINDOWS_CLASSIC_COLORS.neutral500,
    bottom: WINDOWS_CLASSIC_COLORS.neutral800,
    window: WINDOWS_CLASSIC_COLORS.neutral100,
    highlight: 'rgba(255,255,255,0.18)',
    roofLine: WINDOWS_CLASSIC_COLORS.neutral300,
    side: 'rgba(0,0,0,0.55)',
    pad: WINDOWS_CLASSIC_COLORS.neutral600,
  },
  'suburban-house': {
    roof: WINDOWS_CLASSIC_COLORS.neutral600,
    wall: WINDOWS_CLASSIC_COLORS.neutral300,
    trim: WINDOWS_CLASSIC_COLORS.neutral200,
    door: WINDOWS_CLASSIC_COLORS.neutral700,
    window: WINDOWS_CLASSIC_COLORS.neutral100,
    shadow: 'rgba(0,0,0,0.3)',
  },
} as const;

// ============================================================================
// NATURE ELEMENTS (GRAYSCALE)
// ============================================================================

export const NATURE_COLORS = {
  // Trees and foliage
  treeTrunk: WINDOWS_CLASSIC_COLORS.neutral600,
  treeFoliageDark: WINDOWS_CLASSIC_COLORS.neutral500,
  treeFoliageMid: WINDOWS_CLASSIC_COLORS.neutral400,
  treeFoliageLight: WINDOWS_CLASSIC_COLORS.neutral300,
  
  // Ground and grass
  grassDark: WINDOWS_CLASSIC_COLORS.neutral500,
  grassMid: WINDOWS_CLASSIC_COLORS.neutral400,
  grassLight: WINDOWS_CLASSIC_COLORS.neutral300,
  
  // Flowers (grayscale variants)
  flower1: WINDOWS_CLASSIC_COLORS.neutral200,
  flower2: WINDOWS_CLASSIC_COLORS.neutral300,
  flower3: WINDOWS_CLASSIC_COLORS.neutral250,
  flower4: WINDOWS_CLASSIC_COLORS.neutral350,
  flower5: WINDOWS_CLASSIC_COLORS.neutral280,
  flower6: WINDOWS_CLASSIC_COLORS.neutral320,
  
  // Sky and clouds
  skyTop: WINDOWS_CLASSIC_COLORS.neutral800,
  skyMid: WINDOWS_CLASSIC_COLORS.neutral700,
  skyBottom: WINDOWS_CLASSIC_COLORS.neutral600,
  cloud: 'rgba(220,220,220,0.6)',
  
  // Sun and atmosphere
  sun: WINDOWS_CLASSIC_COLORS.white,
  sunGlow: 'rgba(245,245,245,0.8)',
} as const;

// ============================================================================
// INTERACTIVE ELEMENTS
// ============================================================================

export const INTERACTIVE_COLORS = {
  // Balloons and kites (grayscale)
  balloon1: WINDOWS_CLASSIC_COLORS.neutral200,
  balloon2: WINDOWS_CLASSIC_COLORS.neutral300,
  balloon3: WINDOWS_CLASSIC_COLORS.neutral250,
  
  kite1: WINDOWS_CLASSIC_COLORS.neutral300,
  kite2: WINDOWS_CLASSIC_COLORS.neutral350,
  kite3: WINDOWS_CLASSIC_COLORS.neutral250,
  kite4: WINDOWS_CLASSIC_COLORS.neutral280,
  
  // Decorative elements
  mailbox: WINDOWS_CLASSIC_COLORS.neutral600,
  mailboxFlag: WINDOWS_CLASSIC_COLORS.neutral200,
  fence: WINDOWS_CLASSIC_COLORS.neutral400,
  
  // Effects
  explosion: WINDOWS_CLASSIC_COLORS.neutral100,
  highlight: WINDOWS_CLASSIC_COLORS.white,
  shadow: 'rgba(0,0,0,0.5)',
} as const;

// ============================================================================
// VEHICLES AND MOVING OBJECTS
// ============================================================================

export const VEHICLE_COLORS = {
  helicopter: WINDOWS_CLASSIC_COLORS.neutral600,
  helicopterRotor: WINDOWS_CLASSIC_COLORS.neutral500,
  helicopterLight: WINDOWS_CLASSIC_COLORS.white,
  
  airplane: WINDOWS_CLASSIC_COLORS.neutral600,
  airplaneTrail: WINDOWS_CLASSIC_COLORS.neutral200,
  
  bird: WINDOWS_CLASSIC_COLORS.neutral600,
} as const;

// ============================================================================
// SKY GRADIENTS
// ============================================================================

export const SKY_GRADIENTS = {
  rooftop: {
    top: 'rgba(20,20,20,1)',
    mid: 'rgba(30,30,30,1)',
    bottom: 'rgba(40,40,40,1)',
  },
  suburban: {
    top: 'rgba(160,160,160,1)',
    mid: 'rgba(140,140,140,1)',
    bottom: 'rgba(120,120,120,1)',
  },
  metropolis: {
    top: 'rgba(10,10,10,1)',
    mid: 'rgba(20,20,20,1)',
    bottom: 'rgba(30,30,30,1)',
  },
} as const;

// ============================================================================
// ATMOSPHERIC EFFECTS
// ============================================================================

export const ATMOSPHERIC_COLORS = {
  fog: 'rgba(80,80,80,0.12)',
  haze: 'rgba(70,70,70,0.08)',
  particle: 'rgba(200,200,200,0.6)',
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Darken a grayscale color by a percentage
 */
export function darkenGrayscale(gray: number, percent: number): number {
  return Math.max(0, Math.floor(gray * (1 - percent / 100)));
}

/**
 * Lighten a grayscale color by a percentage
 */
export function lightenGrayscale(gray: number, percent: number): number {
  return Math.min(255, Math.floor(gray + (255 - gray) * (percent / 100)));
}

/**
 * Create a grayscale rgba string
 */
export function grayscaleRgba(gray: number, alpha: number = 1): string {
  return `rgba(${gray},${gray},${gray},${alpha})`;
}

/**
 * Convert hex to grayscale (if needed for migration)
 */
export function hexToGrayscale(hex: string): string {
  // Convert hex to RGB
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  
  // Calculate luminance (perceived brightness)
  const gray = Math.floor(0.299 * r + 0.587 * g + 0.114 * b);
  
  // Return as hex
  const grayHex = gray.toString(16).padStart(2, '0');
  return `#${grayHex}${grayHex}${grayHex}`;
}

