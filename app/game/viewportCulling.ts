/**
 * Viewport Culling Utilities
 * Efficiently determine which entities are visible on screen
 */

type Camera = { x: number; y: number };

/**
 * Check if a rectangular area is within the viewport
 * @param x - World X position (top-left)
 * @param y - World Y position (top-left)
 * @param width - Width of the area
 * @param height - Height of the area
 * @param camera - Camera position
 * @param canvas - Canvas element (to get viewport size)
 * @param padding - Extra padding around viewport (default 0)
 * @returns true if area intersects viewport
 */
export function isInViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  camera: Camera,
  canvas: HTMLCanvasElement,
  padding: number = 0
): boolean {
  const viewportLeft = camera.x - padding;
  const viewportRight = camera.x + canvas.clientWidth + padding;
  const viewportTop = camera.y - padding;
  const viewportBottom = camera.y + canvas.clientHeight + padding;
  
  // Check if rectangles overlap
  return !(
    x + width < viewportLeft ||
    x > viewportRight ||
    y + height < viewportTop ||
    y > viewportBottom
  );
}

/**
 * Get viewport bounds for manual culling
 * @param camera - Camera position
 * @param canvas - Canvas element
 * @param padding - Extra padding around viewport
 * @returns Viewport bounds object
 */
export function getViewportBounds(
  camera: Camera,
  canvas: HTMLCanvasElement,
  padding: number = 0
): { left: number; right: number; top: number; bottom: number } {
  return {
    left: camera.x - padding,
    right: camera.x + canvas.clientWidth + padding,
    top: camera.y - padding,
    bottom: camera.y + canvas.clientHeight + padding
  };
}

/**
 * Filter entities to only those visible in viewport
 * @param entities - Array of entities to filter
 * @param camera - Camera position
 * @param canvas - Canvas element
 * @param getBounds - Function to extract bounding box from entity
 * @param padding - Extra padding around viewport
 * @returns Filtered array of visible entities
 */
export function getVisibleEntities<T>(
  entities: T[],
  camera: Camera,
  canvas: HTMLCanvasElement,
  getBounds: (entity: T) => { x: number; y: number; width: number; height: number },
  padding: number = 0
): T[] {
  const viewportLeft = camera.x - padding;
  const viewportRight = camera.x + canvas.clientWidth + padding;
  const viewportTop = camera.y - padding;
  const viewportBottom = camera.y + canvas.clientHeight + padding;
  
  return entities.filter(entity => {
    const bounds = getBounds(entity);
    return !(
      bounds.x + bounds.width < viewportLeft ||
      bounds.x > viewportRight ||
      bounds.y + bounds.height < viewportTop ||
      bounds.y > viewportBottom
    );
  });
}

