import type { CharacterInput } from "../characterShared";

export type EnemyStateId = 'neutral' | 'approach' | 'pressure' | 'spacing' | 'combo' | 'retreat' | 'engage';
export type EnemyAttackName = 'jab' | 'kickHigh' | 'kickLow' | 'reverseKick' | 'uppercut' | 'saltoKick' | 'jabHighDouble';

export interface EnemyProfileConfig {
  preferredRange: number;
  meleeRange: number;
  strafeDurationMs: number;
  strafePauseMs: number;
  burstSize: number;
  meleeAttacks: EnemyAttackName[];
}

export interface PlayerSnapshot {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  facing: number;
  onGround: boolean;
}

export interface EnemyAgentSnapshot {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  facing: number;
  onGround: boolean;
  hp: number;
  maxHp: number;
  attackCooldown: number;
  animWeapon: 'unarmed' | 'pistol' | 'sword';
  aiType?: string;
  aiState?: string;
  aiData?: EnemyAIData;
  strafeDir?: number;
  strafeTimerMs?: number;
  strafePauseMs?: number;
  strafeDurationMs?: number;
  burstSize?: number;
  nextMeleeMs?: number;
}

export interface EnemyAIData {
  state: EnemyStateId;
  stateTimer: number;
  actionCooldown: number;
  decisionCooldown: number;
  moveTimer: number;
  comboPattern?: EnemyAttackName[];
  comboStep: number;
  strafeDir: number;
  strafePhaseMs?: number;
  strafePauseMs?: number;
  retreatAfterCombo?: boolean;
  rangedCooldownMs?: number;
  jumpCooldownMs?: number;
  playerVisible?: boolean;
  horizontalGap?: number;
  debugLines?: string[];
  lastState?: EnemyStateId;
  lastStateReason?: string;
  lastPlayerDir: number;
  stuckTimer: number;
  lastRangedIntent?: boolean;
}

export interface EnemyDecision {
  state: EnemyStateId;
  moveDir: -1 | 0 | 1;
  run: boolean;
  jump: boolean;
  shootHeld: boolean;
  block: boolean;
  meleeAttack?: EnemyAttackName;
  wantsRangedIntent: boolean;
  weapon: 'unarmed' | 'pistol';
  debug: string[];
  speedMultiplier: number; // Multiplier for movement speed (0.5-1.0)
}

export interface EnemyStateMachineParams {
  enemy: EnemyAgentSnapshot;
  player: PlayerSnapshot;
  profile: EnemyProfileConfig;
  dt: number;
  dx: number;
  dy: number;
  horizontalDistance: number;
  totalDistance: number;
  playerVisible: boolean;
  playerClosingFast: boolean;
  random: () => number;
}

const DEFAULT_STATE: EnemyStateId = 'approach';

const clampTimer = (value: number, deltaMs: number): number => Math.max(0, value - deltaMs);

const randomBetween = (rand: () => number, min: number, max: number): number => min + rand() * (max - min);

export function ensureEnemyAIData(enemy: EnemyAgentSnapshot, random: () => number): EnemyAIData {
  if (!enemy.aiData) {
    enemy.aiData = {
      state: DEFAULT_STATE,
      stateTimer: 620,
      actionCooldown: 0,
      decisionCooldown: 0,
      moveTimer: 0,
      comboStep: 0,
      strafeDir: enemy.strafeDir ?? (random() < 0.5 ? -1 : 1),
      lastPlayerDir: random() < 0.5 ? -1 : 1,
      stuckTimer: 0,
    };
  }

  const ai = enemy.aiData;
  if (!ai.debugLines) {
    ai.debugLines = [];
  } else {
    ai.debugLines.length = 0;
  }

  if (ai.strafeDir === undefined || ai.strafeDir === 0) {
    ai.strafeDir = enemy.strafeDir ?? (random() < 0.5 ? -1 : 1);
  }
  if (ai.lastPlayerDir === undefined || ai.lastPlayerDir === 0) {
    ai.lastPlayerDir = random() < 0.5 ? -1 : 1;
  }

  return ai;
}

function pickCombo(aiType: string | undefined, random: () => number): EnemyAttackName[] {
  const baseCombos: EnemyAttackName[][] = [
    ['jab', 'jab'],
    ['kickLow', 'jab'],
    ['jab', 'kickHigh'],
  ];

  const duelistCombos: EnemyAttackName[][] = [
    ['jab', 'kickHigh', 'uppercut'],
    ['kickLow', 'reverseKick'],
    ['jab', 'saltoKick'],
  ];

  const bruteCombos: EnemyAttackName[][] = [
    ['uppercut', 'kickHigh'],
    ['jabHighDouble', 'uppercut'],
    ['kickLow', 'kickHigh', 'uppercut'],
  ];

  const rangerCombos: EnemyAttackName[][] = [
    ['kickLow', 'jab'],
    ['jab', 'jabHighDouble'],
    ['reverseKick', 'kickHigh'],
  ];

  let list = baseCombos;
  switch (aiType) {
    case 'duelist':
      list = duelistCombos;
      break;
    case 'brute':
      list = bruteCombos;
      break;
    case 'ranger':
      list = rangerCombos;
      break;
    default:
      list = baseCombos;
      break;
  }

  return list[Math.floor(random() * list.length)].slice();
}

export function stepEnemyStateMachine(params: EnemyStateMachineParams): EnemyDecision {
  const { enemy, player, profile, dt, dx, dy, horizontalDistance, totalDistance, playerVisible, playerClosingFast, random } = params;
  const ai = ensureEnemyAIData(enemy, random);
  const dtMs = dt * 1000;
  
  // Detect if player is running past the enemy
  const playerSpeed = Math.hypot(player.velocity.x, player.velocity.y);
  const playerMovingFast = playerSpeed > 180;
  const playerToEnemyDir = Math.sign(dx);
  const playerMovingTowardEnemy = Math.sign(player.velocity.x) === -playerToEnemyDir;
  const playerRunningAway = playerMovingFast && !playerMovingTowardEnemy;
  
  // Track if player just passed by (within close range but moving away fast)
  const playerJustPassedBy = playerRunningAway && horizontalDistance < 100;

  ai.stateTimer = clampTimer(ai.stateTimer, dtMs);
  ai.actionCooldown = clampTimer(ai.actionCooldown, dtMs);
  ai.decisionCooldown = clampTimer(ai.decisionCooldown, dtMs);
  ai.moveTimer = clampTimer(ai.moveTimer, dtMs);
  ai.rangedCooldownMs = clampTimer(ai.rangedCooldownMs ?? 0, dtMs);
  ai.jumpCooldownMs = clampTimer(ai.jumpCooldownMs ?? 0, dtMs);

  const strafeDuration = profile.strafeDurationMs > 0 ? profile.strafeDurationMs : 520;
  ai.strafePhaseMs = clampTimer(
    ai.strafePhaseMs ?? randomBetween(random, strafeDuration * 0.75, strafeDuration * 1.25),
    dtMs,
  );

  const debug = ai.debugLines!;
  const pushDebug = (line: string) => {
    if (debug.length < 6) debug.push(line);
  };

  const dirX = Math.sign(dx) || ai.lastPlayerDir || 1;
  ai.lastPlayerDir = dirX;

  const meleeRange = Math.max(80, profile.meleeRange); // Melee attack distance (increased)
  const preferredRange = Math.max(meleeRange + 80, profile.preferredRange); // Optimal shooting distance (reduced)
  const farRange = preferredRange * 1.5; // Reduced far range
  const closeRange = meleeRange * 1.6; // Wider melee initiation range
  const optimalMeleeRange = meleeRange * 0.85; // Best melee distance
  const closeBuffer = meleeRange * 0.7; // Distance where we start easing off
  const spacingRange = preferredRange * 1.2;

  const healthRatio = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
  const lowHealth = healthRatio < 0.25; // Only retreat when critically low

  ai.playerVisible = playerVisible;
  ai.horizontalGap = horizontalDistance;

  const enterState = (state: EnemyStateId, durationMs: number, reason: string) => {
    if (ai.state !== state) {
      ai.lastState = ai.state;
      ai.state = state;
      ai.comboPattern = undefined;
      ai.comboStep = 0;
      ai.retreatAfterCombo = state === 'retreat' ? ai.retreatAfterCombo : false;
      ai.stateTimer = durationMs;
      ai.decisionCooldown = 160;
      pushDebug(`state→${state} (${reason})`);
    } else {
      ai.stateTimer = Math.max(ai.stateTimer, durationMs);
    }
    ai.lastStateReason = reason;
  };

  if (!ai.state) {
    ai.state = DEFAULT_STATE;
    ai.stateTimer = 600;
  }

  // State transition logic - aggressive melee-focused
  const canMelee = horizontalDistance <= meleeRange * 1.15 && enemy.attackCooldown <= 0 && ai.actionCooldown <= 0 && enemy.onGround;
  const extremelyClose = horizontalDistance <= closeBuffer;
  const withinEngageBand = horizontalDistance <= closeRange;
  
  // Only retreat when critically low on health
  if (ai.state === 'retreat') {
    if (ai.stateTimer <= 0 || healthRatio > 0.4) {
      // Re-engage after retreat timer or if health recovered (shield pickup)
      enterState('engage', 600, 're-engage');
    }
  }
  // Exit combo if player escaped far away
  else if (ai.state === 'combo' && horizontalDistance > meleeRange * 2.5) {
    enterState('engage', 400, 'player escaped');
  }
  // Enter combo when in melee range with cooldown ready
  else if (canMelee) {
    enterState('combo', 1200, 'melee opportunity');
  }
  // Transition based on distance - prefer engagement but keep breathing room
  else if (ai.decisionCooldown <= 0 || (ai.stateTimer <= 0 && ai.state !== 'combo')) {
    if (lowHealth && horizontalDistance < preferredRange * 1.5) {
      // Only retreat when critically wounded
      enterState('retreat', 800, 'critical health');
    } else if (extremelyClose) {
      enterState('pressure', 720, 'too close');
    } else if (withinEngageBand) {
      enterState('engage', 960, 'engage band');
    } else if (horizontalDistance <= spacingRange) {
      enterState('spacing', 900, 'maintain spacing');
    } else if (horizontalDistance <= farRange) {
      // Far range: approach while shooting
      enterState('approach', 800, 'closing distance');
    } else {
      // Very far: sprint close
      enterState('approach', 600, 'far pursuit');
    }
  }

  const decision: EnemyDecision = {
    state: ai.state,
    moveDir: 0,
    run: false,
    jump: false,
    shootHeld: false,
    block: false,
    wantsRangedIntent: false,
    weapon: 'pistol',
    debug,
    speedMultiplier: 1.0, // Always move at full speed
  };

  switch (ai.state) {
    case 'approach': {
      decision.moveDir = dirX;
      decision.run = true; // Always run when approaching
      
      // Prefer melee when getting close
      decision.weapon = horizontalDistance < meleeRange * 2.0 ? 'unarmed' : 'pistol';
      
      // Only shoot if very far away - otherwise just close distance
      const shouldShoot = playerVisible && (ai.rangedCooldownMs ?? 0) <= 0 && 
                          horizontalDistance > farRange * 0.9;
      
      if (shouldShoot && decision.weapon === 'pistol') {
        decision.shootHeld = true;
        decision.wantsRangedIntent = true;
        ai.rangedCooldownMs = 400 + randomBetween(random, 100, 200);
        pushDebug('covering fire');
      }
      break;
    }
    case 'engage': {
      const insideMelee = horizontalDistance < meleeRange * 1.1;
      const slightlyClose = horizontalDistance < closeBuffer;

      decision.weapon = horizontalDistance < preferredRange ? 'unarmed' : 'pistol';

      if (slightlyClose) {
        // Maintain a short buffer by circling / sidestepping
        if ((ai.strafePhaseMs ?? 0) <= 0) {
          ai.strafeDir = -ai.strafeDir;
          ai.strafePhaseMs = 320 + randomBetween(random, -80, 80);
        }
        decision.moveDir = ai.strafeDir;
        decision.run = false;
        pushDebug('melee strafe');
      } else {
        // Close in quickly when outside the buffer
        decision.moveDir = dirX;
        decision.run = true;
        pushDebug('closing gap');
      }

      // Occasional covering fire while closing
      const atMediumRange = !slightlyClose && horizontalDistance > meleeRange * 1.4 && horizontalDistance < preferredRange;
      if (atMediumRange && playerVisible && (ai.rangedCooldownMs ?? 0) <= 0 && random() < 0.25) {
        decision.shootHeld = true;
        decision.wantsRangedIntent = true;
        ai.rangedCooldownMs = 520 + randomBetween(random, 220, 320);
        pushDebug('covering burst');
      }

      if (insideMelee && ai.actionCooldown <= 0 && enemy.attackCooldown <= 0 && random() < 0.5) {
        const attacks: EnemyAttackName[] = ['jab', 'kickLow', 'kickHigh', 'uppercut'];
        decision.meleeAttack = attacks[Math.floor(random() * attacks.length)];
        ai.actionCooldown = 220 + randomBetween(random, 30, 90);
        pushDebug(`combo poke (${decision.meleeAttack})`);
      }
      break;
    }
    case 'pressure': {
      const tooClose = horizontalDistance < closeBuffer;
      decision.weapon = 'unarmed';

      if (tooClose) {
        decision.moveDir = -dirX;
        decision.run = false;
        pushDebug('pressure reset');
      } else {
        if ((ai.strafePhaseMs ?? 0) <= 0) {
          ai.strafeDir = -ai.strafeDir;
          ai.strafePhaseMs = 260 + randomBetween(random, -60, 60);
        }
        decision.moveDir = ai.strafeDir;
        decision.run = false;
        pushDebug('pressure strafe');
      }

      if (!tooClose && ai.actionCooldown <= 0 && enemy.attackCooldown <= 0 && random() < 0.45) {
        const attacks: EnemyAttackName[] = ['jab', 'kickLow'];
        decision.meleeAttack = attacks[Math.floor(random() * attacks.length)];
        ai.actionCooldown = 260 + randomBetween(random, 40, 100);
        pushDebug(`pressure jab (${decision.meleeAttack})`);
      }
      break;
    }
    case 'spacing': {
      decision.weapon = horizontalDistance < preferredRange ? 'unarmed' : 'pistol';

      const wantCloser = horizontalDistance > spacingRange;
      const withinSpacingBand = horizontalDistance <= spacingRange && horizontalDistance > closeBuffer;

      if (wantCloser) {
        decision.moveDir = dirX;
        decision.run = true;
        pushDebug('spacing advance');
      } else if (withinSpacingBand) {
        if ((ai.strafePhaseMs ?? 0) <= 0) {
          ai.strafeDir = -ai.strafeDir;
          ai.strafePhaseMs = 240 + randomBetween(random, -70, 70);
        }
        decision.moveDir = ai.strafeDir;
        decision.run = false;
        pushDebug('spacing strafe');
      } else {
        // Slightly too close - step back gently
        decision.moveDir = -dirX;
        decision.run = false;
        pushDebug('spacing retreat');
      }

      if (playerVisible && (ai.rangedCooldownMs ?? 0) <= 0 && horizontalDistance > closeBuffer) {
        decision.shootHeld = true;
        decision.wantsRangedIntent = true;
        ai.rangedCooldownMs = 360 + randomBetween(random, 160, 260);
        pushDebug('spacing burst');
      }
      break;
    }
    case 'combo': {
      decision.weapon = 'unarmed';
      
      // Aggressive melee - always chase and close distance
      const atMeleeRange = horizontalDistance <= meleeRange * 1.3;
      
      if (atMeleeRange) {
        // At good melee range - minimal movement, focus on attacks
        decision.moveDir = horizontalDistance > meleeRange * 0.6 ? dirX : 0;
        decision.run = false;
      } else {
        // Not in range - aggressively close distance
        decision.moveDir = dirX;
        decision.run = true;
      }

      // Initialize combo pattern
      if (!ai.comboPattern || ai.comboPattern.length === 0 || ai.comboStep >= ai.comboPattern.length) {
        ai.comboPattern = pickCombo(enemy.aiType, random);
        ai.comboStep = 0;
        pushDebug(`combo:${ai.comboPattern.join('>')}`);
      }

      // Execute combo attacks when in range
      if (ai.comboPattern && ai.comboStep < ai.comboPattern.length && ai.actionCooldown <= 0 && enemy.attackCooldown <= 0 && atMeleeRange) {
        const attack = ai.comboPattern[ai.comboStep];
        decision.meleeAttack = attack;
        ai.comboStep += 1;

        // Fast attack cooldowns for fluid combos
        let base = 180;
        if (attack === 'uppercut') base = 250;
        else if (attack === 'saltoKick') base = 280;
        else if (attack === 'jabHighDouble') base = 240;
        ai.actionCooldown = base + randomBetween(random, 20, 60);
        pushDebug(`combo:${attack}`);
      }

      // After combo completes, continue pressure (don't retreat)
      if (ai.comboPattern && ai.comboStep >= ai.comboPattern.length && ai.actionCooldown <= 0) {
        if (lowHealth) {
          // Only retreat if critically low on health
          enterState('retreat', 600, 'critical retreat');
        } else {
          // Otherwise keep up the pressure
          enterState('engage', 600, 'combo complete');
        }
        decision.state = ai.state;
      }
      break;
    }
    case 'retreat': {
      // Only used when critically low on health
      decision.weapon = 'pistol';
      decision.moveDir = -dirX;
      decision.run = true;
      
      // Shoot while retreating
      if (playerVisible && (ai.rangedCooldownMs ?? 0) <= 0) {
        decision.shootHeld = true;
        decision.wantsRangedIntent = true;
        ai.rangedCooldownMs = 180 + randomBetween(random, 80, 140);
        pushDebug('covering fire');
      }
      
      // Block if player is closing fast
      if (playerClosingFast && horizontalDistance < meleeRange * 1.2) {
        decision.block = true;
        pushDebug('defensive block');
      }
      break;
    }
    case 'neutral':
    default: {
      decision.moveDir = dirX;
      decision.run = horizontalDistance > preferredRange * 1.3;
      break;
    }
  }

  if (enemy.onGround && (ai.jumpCooldownMs ?? 0) <= 0) {
    const wantsAirDodge = (ai.state === 'pressure' && playerClosingFast && random() < 0.15) ||
      (ai.state === 'retreat' && random() < 0.08);
    if (wantsAirDodge) {
      decision.jump = true;
      ai.jumpCooldownMs = 900 + randomBetween(random, 0, 600);
      pushDebug('jump');
    }
  }

  decision.weapon = decision.weapon === 'unarmed' || (decision.meleeAttack && decision.weapon === 'pistol') ? 'unarmed' : decision.weapon;

  if (debug.length === 0) {
    pushDebug(`state:${ai.state}`);
  }
  pushDebug(`range:${Math.round(horizontalDistance)}/${Math.round(preferredRange)}`);
  if (decision.meleeAttack) {
    pushDebug(`melee:${decision.meleeAttack}`);
  } else if (decision.shootHeld) {
    pushDebug('ranged:burst');
  }

  ai.lastRangedIntent = decision.wantsRangedIntent;

  return decision;
}

export function applyDecisionToInput(input: CharacterInput, decision: EnemyDecision): void {
  if (decision.moveDir < 0) input.left = true;
  else if (decision.moveDir > 0) input.right = true;

  if (decision.run) input.run = true;
  if (decision.jump) input.up = true;
  if (decision.shootHeld) input.shootHeld = true;
  if (decision.block) input.block = true;

  switch (decision.meleeAttack) {
    case 'jab':
      input.jab = true;
      break;
    case 'kickHigh':
      input.kickHigh = true;
      break;
    case 'kickLow':
      input.kickLow = true;
      break;
    case 'reverseKick':
      input.reverseKick = true;
      break;
    case 'uppercut':
      input.uppercut = true;
      break;
    case 'saltoKick':
      input.saltoKick = true;
      break;
    case 'jabHighDouble':
      input.jabHighDouble = true;
      break;
    default:
      break;
  }
}
