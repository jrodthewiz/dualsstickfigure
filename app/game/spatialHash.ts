/**
 * Spatial Hash Grid for efficient collision detection
 * Divides world space into grid cells to reduce collision checks from O(n*m) to O(n+m)
 * Enhanced with incremental updates to avoid full rebuilds every frame
 */

export class SpatialHashGrid<T> {
  private cellSize: number;
  private grid: Map<string, T[]>;
  private entityPositions: Map<T, { x: number; y: number; radius: number; cells: string[] }>;
  private isDirty: boolean = false;
  
  constructor(cellSize: number = 200) {
    this.cellSize = cellSize;
    this.grid = new Map();
    this.entityPositions = new Map();
  }
  
  /**
   * Clear all entities from the grid
   */
  clear() {
    this.grid.clear();
    this.entityPositions.clear();
    this.isDirty = false;
  }
  
  /**
   * Insert an entity into the grid (legacy method for compatibility)
   * @param x - World X position
   * @param y - World Y position
   * @param entity - Entity to insert
   * @param radius - Collision radius (entity will be inserted into all overlapping cells)
   */
  insert(x: number, y: number, entity: T, radius: number = 0) {
    this.updateEntity(entity, x, y, radius);
  }

  /**
   * Update an entity's position in the grid (incremental approach)
   * @param entity - Entity to update
   * @param x - New world X position
   * @param y - New world Y position
   * @param radius - Collision radius
   */
  updateEntity(entity: T, x: number, y: number, radius: number = 0) {
    const existingData = this.entityPositions.get(entity);
    
    // Calculate new cells
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    
    const newCells: string[] = [];
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        newCells.push(`${cx},${cy}`);
      }
    }
    
    // If entity already exists, remove from old cells
    if (existingData) {
      // Check if position actually changed to avoid unnecessary work
      const posChanged = Math.abs(existingData.x - x) > 0.1 || 
                        Math.abs(existingData.y - y) > 0.1 || 
                        Math.abs(existingData.radius - radius) > 0.1;
      
      if (!posChanged) return; // No meaningful change, skip update
      
      // Remove from old cells
      for (const cellKey of existingData.cells) {
        const cell = this.grid.get(cellKey);
        if (cell) {
          const index = cell.indexOf(entity);
          if (index >= 0) {
            cell.splice(index, 1);
            // Clean up empty cells to save memory
            if (cell.length === 0) {
              this.grid.delete(cellKey);
            }
          }
        }
      }
    }
    
    // Insert into new cells
    for (const cellKey of newCells) {
      if (!this.grid.has(cellKey)) {
        this.grid.set(cellKey, []);
      }
      this.grid.get(cellKey)!.push(entity);
    }
    
    // Update position tracking
    this.entityPositions.set(entity, { x, y, radius, cells: newCells });
  }

  /**
   * Remove an entity from the grid
   * @param entity - Entity to remove
   */
  removeEntity(entity: T) {
    const existingData = this.entityPositions.get(entity);
    if (!existingData) return;
    
    // Remove from all cells
    for (const cellKey of existingData.cells) {
      const cell = this.grid.get(cellKey);
      if (cell) {
        const index = cell.indexOf(entity);
        if (index >= 0) {
          cell.splice(index, 1);
          // Clean up empty cells
          if (cell.length === 0) {
            this.grid.delete(cellKey);
          }
        }
      }
    }
    
    this.entityPositions.delete(entity);
  }
  
  /**
   * Check if an entity is being tracked in the grid
   * @param entity - Entity to check
   * @returns true if entity is tracked, false otherwise
   */
  hasEntity(entity: T): boolean {
    return this.entityPositions.has(entity);
  }
  
  /**
   * Cleanup orphaned entities that may have been removed from the game
   * but not properly cleaned up from the spatial hash
   * @param activeEntities - Array of entities that should still be in the grid
   */
  cleanupOrphanedEntities(activeEntities: T[]) {
    const activeSet = new Set(activeEntities);
    const trackedEntities = Array.from(this.entityPositions.keys());
    
    for (const entity of trackedEntities) {
      if (!activeSet.has(entity)) {
        this.removeEntity(entity);
      }
    }
  }
  
  /**
   * Query all entities near a position
   * @param x - World X position
   * @param y - World Y position
   * @param radius - Query radius
   * @returns Array of entities in nearby cells (may contain duplicates if entity spans multiple cells)
   */
  query(x: number, y: number, radius: number = 0): T[] {
    // Calculate which cells to query
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    
    // Use Set to avoid duplicates from entities in multiple cells
    const results = new Set<T>();
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const key = `${cx},${cy}`;
        const cell = this.grid.get(key);
        if (cell) {
          cell.forEach(e => results.add(e));
        }
      }
    }
    return Array.from(results);
  }
  
  /**
   * Get statistics about the grid (for debugging/profiling)
   */
  getStats(): { 
    cellCount: number; 
    totalEntries: number; 
    avgPerCell: number; 
    trackedEntities: number;
    memoryUsage: number;
  } {
    let totalEntries = 0;
    this.grid.forEach(cell => {
      totalEntries += cell.length;
    });
    
    // Rough memory usage estimate (bytes)
    const memoryUsage = this.grid.size * 50 + // grid overhead
                       this.entityPositions.size * 100 + // position tracking
                       totalEntries * 8; // entity references
    
    return {
      cellCount: this.grid.size,
      totalEntries,
      avgPerCell: this.grid.size > 0 ? totalEntries / this.grid.size : 0,
      trackedEntities: this.entityPositions.size,
      memoryUsage
    };
  }
}

