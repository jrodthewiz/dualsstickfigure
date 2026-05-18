// Map configuration types

export type RooftopBuildingStyle = 'art-deco' | 'glass' | 'copper' | 'charcoal';

export type RooftopFeatureKind = 'waterTower' | 'acUnit';

export interface RooftopFeatureDefinition {
  id?: string;
  type: RooftopFeatureKind;
  anchor: number; // 0-1 ratio across the building width
  width: number;
  platformElevation: number; // units above the main rooftop surface
  platformThickness?: number;
}

export interface RooftopBuildingDefinition {
  id: string;
  x: number;
  width: number;
  height: number;
  style: RooftopBuildingStyle;
  features?: RooftopFeatureDefinition[];
}

export interface RooftopPlatformData {
  type: 'rooftop';
  rooftopThickness?: number;
  buildings: RooftopBuildingDefinition[];
}

export type MapPlatformData = RooftopPlatformData;

export interface MapConfig {
  id: string;
  name: string;
  displayName: string;
  description: string;
  thumbnail?: string;
  previewImage?: string;
  // Map-specific settings
  gravity?: number;
  backgroundColor?: string;
  platformData?: MapPlatformData;
  spawnPoints?: { x: number; y: number }[];
  music?: string;
  ambience?: string;
  // Map boundaries (creates a bounded arena)
  boundaries?: {
    left: number;    // Left boundary x position
    right: number;   // Right boundary x position
    width: number;   // Total width of the arena
  };
  // Visual theme
  theme?: {
    primaryColor?: string;
    accentColor?: string;
    skyColor?: string;
    skyColorTop?: string;
    skyColorBottom?: string;
  };
}

export const AVAILABLE_MAPS: MapConfig[] = [
  {
    id: 'city-platformer',
    name: 'city-platformer',
    displayName: 'Metropolis',
    description: 'A sprawling city with multiple platforms and tight corridors',
    gravity: 1200,
    backgroundColor: '#0a0a0a', // --neutral-900 (very dark gray)
    boundaries: {
      left: 125,
      right: 2375,
      width: 2250,
    },
    theme: {
      primaryColor: '#2a2a2a', // --neutral-800
      accentColor: '#4a4a4a', // --neutral-600
      skyColor: '#0a0a0a', // --neutral-900
      skyColorTop: '#000000', // Pure black
      skyColorBottom: '#1a1a1a', // --neutral-850
    },
    spawnPoints: [
      { x: 300, y: 400 },
      { x: 1500, y: 400 },
      { x: 900, y: 200 },
      { x: 600, y: 600 },
    ],
  },
  {
    id: 'suburban-day',
    name: 'suburban-day',
    displayName: 'Suburbia',
    description: 'Grayscale suburban neighborhood with rooftops and backyards',
    gravity: 1200,
    backgroundColor: '#a0a0a0', // --neutral-250 grayscale
    boundaries: {
      left: 125,
      right: 2375,
      width: 2250,
    },
    theme: {
      primaryColor: '#8a8a8a', // --neutral-300 grayscale
      accentColor: '#6a6a6a', // --neutral-400 grayscale
      skyColor: '#a0a0a0', // --neutral-250 grayscale
      skyColorTop: '#b0b0b0', // --neutral-200 grayscale
      skyColorBottom: '#c8c8c8', // --neutral-150 grayscale
    },
    spawnPoints: [
      { x: 400, y: 420 },   // On house rooftop
      { x: 800, y: 380 },   // On house rooftop  
      { x: 1200, y: 410 },  // On house rooftop
      { x: 1600, y: 390 },  // On house rooftop
    ],
  },
  {
    id: 'rooftop-sunset',
    name: 'rooftop-sunset',
    displayName: 'Rooftops',
    description: 'Fight atop Manhattan skyscrapers in Windows Classic grayscale',
    gravity: 1200,
    backgroundColor: '#2a2a2a', // --neutral-800 grayscale
    boundaries: {
      left: 125,
      right: 2375,
      width: 2250,
    },
    theme: {
      primaryColor: '#c0c0c0', // Windows Classic silver
      accentColor: '#dcdcdc', // --neutral-120 light gray
      skyColor: '#2a2a2a', // --neutral-800 grayscale
      skyColorTop: '#1a1a1a', // --neutral-850 grayscale
      skyColorBottom: '#4a4a4a', // --neutral-600 grayscale
    },
    platformData: {
      type: 'rooftop',
      rooftopThickness: 44,
      buildings: [
        {
          id: 'west-terrace',
          x: 200,
          width: 640,
          height: 340,
          style: 'art-deco',
          features: [
            { id: 'west-tower', type: 'waterTower', anchor: 0.78, width: 90, platformElevation: 60 },
            { id: 'west-hvac', type: 'acUnit', anchor: 0.32, width: 110, platformElevation: 22 },
          ],
        },
        {
          id: 'central-glass',
          x: 900,
          width: 650,
          height: 310,
          style: 'glass',
          features: [
            { id: 'central-hvac', type: 'acUnit', anchor: 0.48, width: 130, platformElevation: 20 },
          ],
        },
        {
          id: 'sunrise-copper',
          x: 1600,
          width: 600,
          height: 410,
          style: 'copper',
          features: [
            { id: 'copper-tower', type: 'waterTower', anchor: 0.28, width: 100, platformElevation: 65 },
            { id: 'copper-hvac', type: 'acUnit', anchor: 0.68, width: 120, platformElevation: 24 },
          ],
        },
      ],
    },
    spawnPoints: [
      { x: 520, y: 340 },   // On west-terrace (baseGroundY=680 - height=340 = Y:340)
      { x: 1200, y: 370 },  // On central-glass (baseGroundY=680 - height=310 = Y:370)  
      { x: 1900, y: 270 },  // On sunrise-copper (baseGroundY=680 - height=410 = Y:270)
      { x: 800, y: 680 },   // Between buildings on ground level
    ],
  },
  // Future maps can be added here
  // {
  //   id: 'dojo',
  //   name: 'dojo',
  //   displayName: 'Ancient Dojo',
  //   description: 'Traditional training grounds with balanced combat space',
  //   ...
  // },
];

export function getMapById(id: string): MapConfig | undefined {
  return AVAILABLE_MAPS.find(map => map.id === id);
}

export function getDefaultMap(): MapConfig {
  return AVAILABLE_MAPS[0]; // City map as default
}
