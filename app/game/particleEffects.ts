import * as Proton from 'proton-engine';

// ========== Weapon FX Palette ==========
export const WEAPON_FX: Record<string, { 
  muzzleColor: string; 
  trailColor: string; 
  sparkColor: string; 
  lightColor: string; 
  lightRadius: number 
}> = {
  pistol:   { muzzleColor: '#ff6b6b', trailColor: '#ff6b6b', sparkColor: '#ff6b6b', lightColor: 'rgba(255,100,100,1)', lightRadius: 110 },
  shotgun:  { muzzleColor: '#ff5555', trailColor: '#ff7777', sparkColor: '#ff8888', lightColor: 'rgba(255,85,85,1)', lightRadius: 140 },
  rifle:    { muzzleColor: '#ff4444', trailColor: '#ff4444', sparkColor: '#ff6666', lightColor: 'rgba(255,68,68,1)', lightRadius: 120 },
  minigun:  { muzzleColor: '#ff5544', trailColor: '#ff7766', sparkColor: '#ff8877', lightColor: 'rgba(255,85,68,1)', lightRadius: 90 },
  rocket:   { muzzleColor: '#ff3333', trailColor: '#cccccc', sparkColor: '#ff5555', lightColor: 'rgba(255,51,51,1)', lightRadius: 220 },
  grenade:  { muzzleColor: '#ff4444', trailColor: '#cccccc', sparkColor: '#ff6666', lightColor: 'rgba(255,68,68,1)', lightRadius: 180 },
  bomb:     { muzzleColor: '#ff2222', trailColor: '#cccccc', sparkColor: '#ff4444', lightColor: 'rgba(255,34,34,1)', lightRadius: 260 },
  railgun:  { muzzleColor: '#ff6666', trailColor: '#ff3333', sparkColor: '#ff9999', lightColor: 'rgba(255,100,100,1)', lightRadius: 160 },
  laser:    { muzzleColor: '#ff6666', trailColor: '#ff3333', sparkColor: '#ff9999', lightColor: 'rgba(255,100,100,1)', lightRadius: 130 },
  plasma:   { muzzleColor: '#b08bff', trailColor: '#b08bff', sparkColor: '#b08bff', lightColor: 'rgba(176,139,255,1)', lightRadius: 200 },
  flame:    { muzzleColor: '#ff9e66', trailColor: '#ff9e66', sparkColor: '#ff9e66', lightColor: 'rgba(255,158,102,1)', lightRadius: 120 },
  ice:      { muzzleColor: '#ff99cc', trailColor: '#ff66aa', sparkColor: '#ffaadd', lightColor: 'rgba(255,150,200,1)', lightRadius: 120 },
  bow:      { muzzleColor: '#ff5555', trailColor: '#ff5555', sparkColor: '#ff7777', lightColor: 'rgba(255,85,85,1)', lightRadius: 100 },
  crossbow: { muzzleColor: '#ff6666', trailColor: '#ff6666', sparkColor: '#ff8888', lightColor: 'rgba(255,100,100,1)', lightRadius: 110 },
  boomerang:{ muzzleColor: '#ff7777', trailColor: '#ff7777', sparkColor: '#ff9999', lightColor: 'rgba(255,119,119,1)', lightRadius: 100 },
  wand:     { muzzleColor: '#aa66ff', trailColor: '#aa66ff', sparkColor: '#cc88ff', lightColor: 'rgba(170,102,255,1)', lightRadius: 140 },
  axe:      { muzzleColor: '#ff6666', trailColor: '#ff6666', sparkColor: '#ff8888', lightColor: 'rgba(255,100,100,1)', lightRadius: 120 },
  spear:    { muzzleColor: '#ff5555', trailColor: '#ff5555', sparkColor: '#ff7777', lightColor: 'rgba(255,85,85,1)', lightRadius: 110 },
  beam:     { muzzleColor: '#88ffff', trailColor: '#88ffff', sparkColor: '#aaffff', lightColor: 'rgba(136,255,255,1)', lightRadius: 180 },
  lightning:{ muzzleColor: '#eeff66', trailColor: '#eeff66', sparkColor: '#ffff88', lightColor: 'rgba(238,255,102,1)', lightRadius: 200 },
};

// ========== Particle Effect Functions ==========

/**
 * Creates an arcane burst effect at the specified position
 * Used for magical hit impacts
 */
export const createArcaneBurst = (
  proton: any,
  x: number,
  y: number,
  intensity: number = 1
) => {
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

/**
 * Creates a directional arcane slash trail effect
 * Used for sword/slash attacks
 */
export const createArcaneSlashTrail = (
  proton: any,
  x: number,
  y: number,
  angle: number,
  length: number
) => {
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

/**
 * Creates sparks effect for metal impacts
 */
export const createSparks = (
  proton: any,
  x: number,
  y: number,
  direction: number
) => {
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

/**
 * Creates blood spray effect for organic damage
 */
export const createBloodSpray = (
  proton: any,
  x: number,
  y: number,
  direction: number
) => {
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

/**
 * Creates explosion burst with shockwave particles
 */
export const createExplosionBurst = (
  proton: any,
  x: number,
  y: number,
  radius: number,
  color1: string,
  color2: string
) => {
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
  const repulsionPoint = new Proton.Vector2D(x, y);
  emitter.addBehaviour(new Proton.Repulsion(repulsionPoint, 10, radius * 3));
  emitter.p.x = x;
  emitter.p.y = y;
  emitter.emit('once');
  proton.addEmitter(emitter);
  setTimeout(() => proton.removeEmitter(emitter), 1500);
};

/**
 * Creates muzzle flash with realistic gun smoke
 */
export const createMuzzleFlash = (
  proton: any,
  x: number,
  y: number,
  angle: number,
  weaponType: string
) => {
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

/**
 * Creates continuous flame stream for flame weapons
 */
export const createFlameStream = (
  proton: any,
  x: number,
  y: number,
  angle: number,
  durationMs: number
) => {
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

/**
 * Creates energy beam particles with attraction to beam line
 */
export const createBeamParticles = (
  proton: any,
  x: number,
  y: number,
  angle: number,
  length: number,
  color: string
) => {
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

/**
 * Creates ice/frost particles with crystalline effect
 */
export const createIceBurst = (
  proton: any,
  x: number,
  y: number,
  radius: number
) => {
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
  emitter.addBehaviour(new Proton.Rotate('random', 'random'));
  emitter.p.x = x;
  emitter.p.y = y;
  emitter.emit('once');
  proton.addEmitter(emitter);
  setTimeout(() => proton.removeEmitter(emitter), 1500);
};

/**
 * Creates plasma/energy particles with glow and oscillation
 */
export const createPlasmaImpact = (
  proton: any,
  x: number,
  y: number,
  color: string
) => {
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
  emitter.addBehaviour(new Proton.CrossZone(new Proton.CircleZone(x, y, 50), 'bound'));
  emitter.addBehaviour(new Proton.Gravity(-200)); // float upward
  emitter.p.x = x;
  emitter.p.y = y;
  emitter.emit('once');
  proton.addEmitter(emitter);
  setTimeout(() => proton.removeEmitter(emitter), 1000);
};

/**
 * Creates shell casing ejection with realistic physics
 */
export const createShellCasing = (
  proton: any,
  x: number,
  y: number,
  angle: number,
  weaponType: string
) => {
  const emitter = new Proton.Emitter();
  emitter.rate = new Proton.Rate(1, new Proton.Span(0.01));
  emitter.addInitialize(new Proton.Mass(2));
  emitter.addInitialize(new Proton.Life(1.5, 2.5));
  emitter.addInitialize(new Proton.Body(new Proton.RectZone(0, 0, 4, 2)));
  emitter.addInitialize(new Proton.Radius(3, 4));
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

/**
 * Creates generic hit burst with customizable color
 */
export const createHitBurst = (
  proton: any,
  x: number,
  y: number,
  color: string,
  intensity: number = 1
) => {
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

