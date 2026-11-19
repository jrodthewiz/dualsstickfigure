/**
 * Platform ImageBitmap Caching System
 * Pre-renders complex platforms to ImageBitmaps for ultra-fast drawing
 * 
 * Each suburban house normally requires 20-50+ canvas operations per frame:
 * - Multiple gradients, shadows, windows (loops), doors, roofs, etc.
 * 
 * By caching to ImageBitmap, we reduce this to a single ctx.drawImage() call
 * Expected performance gain: 30-50% FPS improvement for platform-heavy scenes
 */

// Use the main Platform type from the game
// This is defined in app/page.tsx with all the necessary properties
type Platform = {
  id?: number | string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind?: 'track' | 'hover' | 'tower' | 'brutalist';
  lane?: number;
  seed?: number;
  chunkId?: number;
  baseX?: number;
  baseY?: number;
  motion?: any; // Platform motion object
  featureType?: string;
  featureOffset?: number;
  featureWidth?: number;
  featureStrength?: number;
  featureDir?: number;
  featureCooldownMs?: number;
  featureTimerMs?: number;
  rooftopKey?: string;
  rooftopStyle?: any;
  sourceBuildingId?: string;
  sourceFeatureId?: string;
  buildingHeight?: number;
  buildingStyle?: number;
  isRooftopFeature?: boolean;
  isRooftop?: boolean;
  hasThrusters?: boolean;
  // Add any other properties that might be used
};

type PlatformImage = ImageBitmap | HTMLCanvasElement;

export class PlatformCacheManager {
  private cache: Map<string, PlatformImage>;
  private maxCacheSize: number;
  private cacheHits: number;
  private cacheMisses: number;
  
  constructor(maxCacheSize: number = 200) {
    this.cache = new Map();
    this.maxCacheSize = maxCacheSize;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
  
  /**
   * Generate a unique cache key for a platform based on its visual properties
   */
  generateCacheKey(platform: Platform, mapId: string): string {
    // Use the generation anchor when available so moving platforms reuse the same cached art.
    const seedSource = typeof platform.baseX === 'number' ? platform.baseX : platform.x;
    const seed = Math.floor(seedSource / 10);
    
    // Key includes all properties that affect visual appearance
    return `${mapId}_w${platform.width}_h${platform.height}_s${platform.buildingStyle || 0}_k${platform.kind || 'normal'}_f${platform.featureType || 'none'}_seed${seed}`;
  }
  
  /**
   * Get cached platform image if it exists
   */
  get(key: string): PlatformImage | null {
    const cached = this.cache.get(key);
    if (cached) {
      this.cacheHits++;
      return cached;
    }
    this.cacheMisses++;
    return null;
  }
  
  /**
   * Store a rendered platform in cache
   */
  set(key: string, bitmap: PlatformImage): void {
    // Implement simple LRU by deleting oldest when at capacity
    if (this.cache.size >= this.maxCacheSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        const evicted = this.cache.get(firstKey);
        if (evicted && 'close' in evicted) evicted.close();
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(key, bitmap);
  }
  
  /**
   * Clear all cached platforms (call on map change)
   */
  clear(): void {
    for (const item of this.cache.values()) if ('close' in item) item.close();
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
  
  /**
   * Get cache statistics for debugging/profiling
   */
  getStats(): { size: number; maxSize: number; hits: number; misses: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0
    };
  }
  
  /**
   * Check if cache has a specific key
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }
}

/**
 * Create an offscreen canvas for rendering a platform
 */
export function createOffscreenCanvas(width: number, height: number): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} {
  // Try to use OffscreenCanvas for better performance
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      return { canvas, ctx };
    }
  }
  
  // Fallback to regular canvas if OffscreenCanvas not available
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create canvas context');
  }
  return { canvas, ctx };
}
