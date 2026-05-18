export type MouseTarget = { x: number; y: number };

export type AttackInput = {
  jab: boolean;
  kickHigh: boolean;
  kickLow: boolean;
  reverseKick: boolean;
  uppercut: boolean;
  saltoKick: boolean;
  jabHighDouble: boolean;
};

export type RangedInput = {
  shootHeld: boolean;
  shoot: boolean;
  slash: boolean;
  block: boolean;
};

export type CharacterInput = AttackInput & RangedInput & {
  left: boolean;
  right: boolean;
  up: boolean;
  run: boolean;
  mouse: MouseTarget;
};

export type AttackCapableCharacter = {
  attackCooldown: number;
  jabPressed: boolean;
  kickHighPressed: boolean;
  kickLowPressed: boolean;
  reverseKickPressed: boolean;
  uppercutPressed: boolean;
  saltoKickPressed: boolean;
  jabHighDoublePressed: boolean;
};

type AttackFlagKey = Exclude<keyof AttackCapableCharacter, 'attackCooldown'>;

const ATTACK_FLAG_MAP: Array<{ inputKey: keyof AttackInput; flagKey: AttackFlagKey }> = [
  { inputKey: 'jab', flagKey: 'jabPressed' },
  { inputKey: 'kickHigh', flagKey: 'kickHighPressed' },
  { inputKey: 'kickLow', flagKey: 'kickLowPressed' },
  { inputKey: 'reverseKick', flagKey: 'reverseKickPressed' },
  { inputKey: 'uppercut', flagKey: 'uppercutPressed' },
  { inputKey: 'saltoKick', flagKey: 'saltoKickPressed' },
  { inputKey: 'jabHighDouble', flagKey: 'jabHighDoublePressed' },
];

export function createCharacterInput(): CharacterInput {
  return {
    left: false,
    right: false,
    up: false,
    run: false,
    mouse: { x: 0, y: 0 },
    shootHeld: false,
    jab: false,
    kickHigh: false,
    kickLow: false,
    reverseKick: false,
    uppercut: false,
    saltoKick: false,
    jabHighDouble: false,
    shoot: false,
    slash: false,
    block: false,
  };
}

export function resetCharacterInput(input: CharacterInput): void {
  input.left = false;
  input.right = false;
  input.up = false;
  input.run = false;
  input.shootHeld = false;
  input.jab = false;
  input.kickHigh = false;
  input.kickLow = false;
  input.reverseKick = false;
  input.uppercut = false;
  input.saltoKick = false;
  input.jabHighDouble = false;
  input.shoot = false;
  input.slash = false;
  input.block = false;
}

export function updateAttackEdgeFlags<T extends AttackCapableCharacter>(
  character: T,
  input: AttackInput,
  options: { cooldownThreshold?: number } = {}
): void {
  const cooldownThreshold = options.cooldownThreshold ?? 0;

  for (const { inputKey, flagKey } of ATTACK_FLAG_MAP) {
    const isHeld = !!input[inputKey];
    const wasHeld = !!character[flagKey];

    if (isHeld && !wasHeld && character.attackCooldown <= cooldownThreshold) {
      character[flagKey] = true;
    }

    if (!isHeld) {
      character[flagKey] = false;
    }
  }
}
