// ========== Collision Detection Utilities ==========

/**
 * Hitbox shape types for attack collision detection
 */
export type HitboxShape = 'circle' | 'rectangle' | 'arc';

/**
 * Attack hitbox configuration
 */
export type AttackHitbox = {
  shape: HitboxShape;
  // For circle
  radius?: number;
  // For rectangle (relative to player position and facing)
  offsetX?: number;
  offsetY?: number;
  width?: number;
  height?: number;
  // For arc (sweeping attacks like kicks)
  arcRadius?: number;
  arcStartAngle?: number; // in radians, 0 = right, relative to facing
  arcEndAngle?: number;
  // Common properties
  damage: number;
  knockback: number;
  knockbackAngle?: number; // override automatic angle
  activeFrameStart: number; // frame when hitbox becomes active
  activeFrameEnd: number; // frame when hitbox deactivates
  hitStun: number; // hitstop duration in ms
  cameraShake: number; // camera shake magnitude
  invulnFrames: number; // invulnerability frames for enemy after hit
  effectColor: string; // visual effect color
  effectIntensity: number; // particle/effect intensity (1-3)
};

/**
 * Collision box configuration for characters
 */
export type CollisionBox = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

/**
 * Collision settings for player and enemy
 */
export type CollisionSettings = {
  player: CollisionBox;
  enemy: CollisionBox;
};

/**
 * Debug settings with collision multiplier
 */
export type DebugSettings = {
  collisionSizeMultiplier?: number;
};

/**
 * Check if a point/circle collides with a character's collision box
 */
export const checkPointVsCharacterBox = (
  pointX: number,
  pointY: number,
  pointRadius: number,
  charX: number,
  charY: number,
  isPlayer: boolean,
  collisionSettings: CollisionSettings
): boolean => {
  const charBox = isPlayer ? collisionSettings.player : collisionSettings.enemy;
  const boxX = charX + charBox.offsetX;
  const boxY = charY + charBox.offsetY;

  // Find closest point on box to the circle
  const closestX = Math.max(boxX - charBox.width / 2, Math.min(pointX, boxX + charBox.width / 2));
  const closestY = Math.max(boxY - charBox.height / 2, Math.min(pointY, boxY + charBox.height / 2));

  const distX = pointX - closestX;
  const distY = pointY - closestY;
  const distSq = distX * distX + distY * distY;

  return distSq <= (pointRadius * pointRadius);
};

/**
 * Check if a rectangle hitbox collides with enemy (using box collision)
 */
export const checkRectangleCollision = (
  enemyX: number,
  enemyY: number,
  enemyRadius: number,
  attackerX: number,
  attackerY: number,
  facing: number,
  hitbox: AttackHitbox,
  collisionSettings: CollisionSettings
): boolean => {
  const rectX = attackerX + (hitbox.offsetX || 0) * facing;
  const rectY = attackerY + (hitbox.offsetY || 0);
  const rectWidth = hitbox.width || 40;
  const rectHeight = hitbox.height || 30;

  // Use enemy collision box instead of radius
  const isPlayer = false; // This is checking against enemy
  return checkPointVsCharacterBox(
    rectX,
    rectY,
    Math.max(rectWidth, rectHeight) / 2,
    enemyX,
    enemyY,
    isPlayer,
    collisionSettings
  );
};

/**
 * Check if an arc hitbox collides with enemy (for sweeping attacks)
 */
export const checkArcCollision = (
  enemyX: number,
  enemyY: number,
  enemyRadius: number,
  attackerX: number,
  attackerY: number,
  facing: number,
  hitbox: AttackHitbox,
  debugSettings: DebugSettings
): boolean => {
  const arcRadius = hitbox.arcRadius || 60;
  const startAngle = (hitbox.arcStartAngle || 0);
  const endAngle = (hitbox.arcEndAngle || Math.PI / 2);

  // Arc center (with offset)
  const centerX = attackerX + (hitbox.offsetX || 0) * facing;
  const centerY = attackerY + (hitbox.offsetY || 0);

  // Check if enemy is within arc radius (more lenient)
  const dx = enemyX - centerX;
  const dy = enemyY - centerY;
  const dist = Math.hypot(dx, dy);

  const collisionMultiplier = debugSettings.collisionSizeMultiplier || 1.0;
  const effectiveRadius = enemyRadius * collisionMultiplier * 1.2; // Arc attacks get extra range

  // Only check max distance - allow hits at any close range (no minimum distance)
  if (dist > arcRadius + effectiveRadius) return false;

  // Calculate angle from arc center to enemy
  // When facing right: use angle as-is
  // When facing left: flip horizontally
  let angle = Math.atan2(dy, dx);

  // If facing left, mirror the angle horizontally
  if (facing < 0) {
    angle = Math.PI - angle;
  }

  // Normalize angle to -π to π range
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;

  // Add angle tolerance for more generous detection
  const angleTolerance = Math.PI / 6; // ~30 degrees extra on each side
  const start = startAngle - angleTolerance;
  const end = endAngle + angleTolerance;

  // Check if angle is within arc (handle wrapping)
  if (start <= end) {
    return angle >= start && angle <= end;
  } else {
    // Arc wraps around (e.g., from 150° to -150°)
    return angle >= start || angle <= end;
  }
};

/**
 * Check if a circle hitbox collides with enemy
 */
export const checkCircleCollision = (
  enemyX: number,
  enemyY: number,
  enemyRadius: number,
  attackerX: number,
  attackerY: number,
  facing: number,
  hitbox: AttackHitbox,
  debugSettings: DebugSettings
): boolean => {
  const centerX = attackerX + (hitbox.offsetX || 0) * facing;
  const centerY = attackerY + (hitbox.offsetY || 0);
  const radius = hitbox.radius || 40;

  const dx = enemyX - centerX;
  const dy = enemyY - centerY;
  const dist = Math.hypot(dx, dy);

  // More lenient circle collision
  const collisionMultiplier = debugSettings.collisionSizeMultiplier || 1.0;
  const effectiveRadius = enemyRadius * collisionMultiplier * 1.1; // Circle attacks get slight extra range
  return dist <= radius + effectiveRadius;
};

/**
 * Main hitbox collision check - dispatches to appropriate shape checker
 */
export const checkHitboxCollision = (
  enemyX: number,
  enemyY: number,
  enemyRadius: number,
  attackerX: number,
  attackerY: number,
  facing: number,
  hitbox: AttackHitbox,
  collisionSettings: CollisionSettings,
  debugSettings: DebugSettings
): boolean => {
  switch (hitbox.shape) {
    case 'rectangle':
      return checkRectangleCollision(
        enemyX,
        enemyY,
        enemyRadius,
        attackerX,
        attackerY,
        facing,
        hitbox,
        collisionSettings
      );
    case 'arc':
      return checkArcCollision(
        enemyX,
        enemyY,
        enemyRadius,
        attackerX,
        attackerY,
        facing,
        hitbox,
        debugSettings
      );
    case 'circle':
      return checkCircleCollision(
        enemyX,
        enemyY,
        enemyRadius,
        attackerX,
        attackerY,
        facing,
        hitbox,
        debugSettings
      );
    default:
      return false;
  }
};

