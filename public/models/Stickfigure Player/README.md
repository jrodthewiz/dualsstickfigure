# Stickfigure Player — Animation Map (WASD + Mouse)

This document maps the sprite folders to game states and inputs assuming classic side-scroller controls:
- A/D: move left/right
- W: jump
- Shift: run (hold)
- Mouse: aim; face toward mouse X
- LMB: primary attack (sword slash / pistol shot / unarmed strike)
- RMB: block/guard (uses top/center/bottom variants based on aim angle)

All folders contain sequential PNG frames. Sort by the trailing number in the filename (ascending, zero-padded). Flip frames horizontally to face left when the mouse is left of the player.

## Sets (folders)
- Unarmed (root of this folder)
- 1_Sword
- 2_Pistol

Use one set at a time depending on equipped weapon. Unarmed includes punches/kicks; Sword adds slashes; Pistol adds shooting while idle/walking/running.

## Naming convention
Files follow this pattern:
- Unarmed: `stickman fighter-black-1_-<action>_<frame>.png`
- Sword: `1_Sword/<action>/stickman fighter-black-2_Sword-<action>_<frame>.png`
- Pistol: `2_Pistol/<action>/stickman fighter-black-3_Pistol-<action>_<frame>.png`

Notes:
- `<frame>` is zero-padded: 00, 01, 02 ...
- Always sort by the numeric suffix (regex: `/(\d+)\.png$/`).
- Use folder names to locate animations; do not hardcode the variant number.

## Direction and aiming
- Facing: if `mouse.x < player.x` flip X (scaleX = -1), else normal.
- Vertical aim tiers for block/hurt: choose `top` when aiming above ~+25°, `center` between -25°..+25°, and `bottom` when aiming below ~-25° relative to horizontal.

## Recommended FPS and looping
- Idle: 8–10 fps (loop)
- Walk: 10–12 fps (loop)
- Run: 12–16 fps (loop)
- Jump arcs: 12–16 fps (play once; blend to fall/idle)
- Attacks: 16–20 fps (play once; queue into recovery/idle)
- Block: 12 fps (loop while held)
- Hurt: 12–16 fps (play once; return to previous or idle)
- Die: 12–16 fps (play once; stop at last frame)

---

## State map: Unarmed (root)
- idle (16): `idle/` — loop
- walk (22): `walk normal/` — loop
- walk_fight (22): `walk fight pose/` — loop while holding attack intent without firing
- run (16): `run/` — loop while Shift held
- run_stop (14): `run stop/` — play once on releasing Shift while moving
- jump (choose one arc):
  - `jump A/` (6), `jump B/` (6), `jump C/` (6), `jump D/` (12)
  - Use `jump D` for full takeoff→air→land; otherwise split at apex and blend to fall/idle
- attacks (LMB when Unarmed):
  - jabs: `jab single/` (6), `jab double/` (11)
  - high jabs: `jab high single/` (6), `jab high double/` (11)
  - kicks: `kick low/` (12), `kick straight/` (12), `kick high/` (12), `reverse kick/` (12)
  - specials: `uppercut/` (9), `salto kick/` (16), `flying kick/` (1)
- block (RMB hold):
  - `block top/` (9), `block center/` (9), `block bottom/` (9) — pick by aim tier
- hurt (on damage; pick by hit direction):
  - `hurt top/` (8), `hurt center/` (8), `hurt bottom/` (9)
- die (on death): `die A/` (16) or `die B/` (16)

## State map: Sword (`1_Sword`)
- idle (16): `1_Sword/idle/` — loop
- idle_active (16): `1_Sword/idle active/` — optional breathing/alert loop
- idle_fight (16): `1_Sword/idle fight pose/` — loop while in combat stance
- walk (22): `1_Sword/walk normal/` — loop
- walk_fight (22): `1_Sword/walk fight pose/` — loop while in combat stance
- run (16): `1_Sword/run/` — loop
- run_stop (14): `1_Sword/run stop/` — once
- jump: `1_Sword/jump A/` (6), `B` (6), `C` (6), `D` (12) — play once
- attack_primary (LMB): `1_Sword/slash/` (16) — play once; lock movement briefly or allow root motion
- block (RMB hold): `1_Sword/block top|center|bottom/` (9 each) — loop by aim tier
- hurt: `1_Sword/hurt top|center|bottom/` (8/8/9) — once
- die: `1_Sword/die A/` (16) or `die B/` (16)

## State map: Pistol (`2_Pistol`)
- idle (16): `2_Pistol/idle/` — loop
- idle_active (16): `2_Pistol/idle active/` — optional
- idle_fight (16): `2_Pistol/idle fight pose/` — optional aiming stance
- walk (22): `2_Pistol/walk normal/` — loop
- walk_shoot (22): `2_Pistol/walk shoot/` — loop while moving and firing/aiming
- walk_fight (22): `2_Pistol/walk fight pose/` — optional aiming stride
- run (16): `2_Pistol/run/` — loop
- run_shoot (16): `2_Pistol/run shoot/` — loop while running and firing/aiming
- run_stop (14): `2_Pistol/run stop/` — once
- shoot (LMB tap/hold): `2_Pistol/shoot/` (5) — play once per shot; time muzzle flash at early frames
- jump: `2_Pistol/jump A|B|C|D/` (6/6/6/12) — once
- block/guard (RMB hold): `2_Pistol/block top|center|bottom/` — if not present, fall back to Unarmed blocks
- hurt: `2_Pistol/hurt top|center|bottom/` (8/8/9) — once
- die: `2_Pistol/die A/` (16) or `die B/` (16)

---

## Input → animation selection
- Movement
  - A/D only → walk; with Shift → run
  - Release Shift while moving → run_stop once, then walk/idle
  - No input → idle (or idle_active/idle_fight if in combat stance)
- Jump
  - Press W on ground → jump D (or A/B/C) sequence
  - In air → hold last jump airborne frame or a separate fall frame (pick jump D frames 5..9)
- Combat (sword equipped)
  - LMB → attack_primary (slash) once
  - Hold RMB → block by aim tier (top/center/bottom)
- Combat (pistol equipped)
  - LMB tap → shoot once
  - Hold LMB + move → walk_shoot or run_shoot depending on Shift
  - Hold RMB → optional guard/aim pose (use idle_fight/walk_fight if preferred)
- Hit reactions
  - On damage → play hurt by hit vertical direction (top/center/bottom), then return to previous state
- Death
  - Health ≤ 0 → die A/B once; freeze on last frame

## File loading tips
- Sort frames numerically; do not rely on lexicographic order alone.
- Use a loader that globs all `*.png` in a folder and sorts by trailing digits.
- Keep animation playback speed per action; do not force a global fps.
- Flip horizontally for left-facing; do not create duplicate left assets.

a- Use web paths starting with `/models/...` (Next.js/Phaser). Do not prefix with `public/`.

## Example registry (TypeScript)
```ts
export type AnimDef = { path: string; frames: number; fps: number; loop: boolean };

export const StickmanAnim: Record<string, AnimDef> = {
  // Unarmed
  idle: { path: "/models/Stickfigure Player/idle", frames: 16, fps: 10, loop: true },
  walk: { path: "/models/Stickfigure Player/walk normal", frames: 22, fps: 12, loop: true },
  run: { path: "/models/Stickfigure Player/run", frames: 16, fps: 14, loop: true },
  run_stop: { path: "/models/Stickfigure Player/run stop", frames: 14, fps: 14, loop: false },
  jump_full: { path: "/models/Stickfigure Player/jump D", frames: 12, fps: 14, loop: false },
  block_top: { path: "/models/Stickfigure Player/block top", frames: 9, fps: 12, loop: true },
  block_center: { path: "/models/Stickfigure Player/block center", frames: 9, fps: 12, loop: true },
  block_bottom: { path: "/models/Stickfigure Player/block bottom", frames: 9, fps: 12, loop: true },
  hurt_center: { path: "/models/Stickfigure Player/hurt center", frames: 8, fps: 14, loop: false },
  die_A: { path: "/models/Stickfigure Player/die A", frames: 16, fps: 14, loop: false },

  // Sword
  sword_idle: { path: "/models/Stickfigure Player/1_Sword/idle", frames: 16, fps: 10, loop: true },
  sword_walk: { path: "/models/Stickfigure Player/1_Sword/walk normal", frames: 22, fps: 12, loop: true },
  sword_run: { path: "/models/Stickfigure Player/1_Sword/run", frames: 16, fps: 14, loop: true },
  sword_slash: { path: "/models/Stickfigure Player/1_Sword/slash", frames: 16, fps: 18, loop: false },
  sword_block_top: { path: "/models/Stickfigure Player/1_Sword/block top", frames: 9, fps: 12, loop: true },

  // Pistol
  pistol_idle: { path: "/models/Stickfigure Player/2_Pistol/idle", frames: 16, fps: 10, loop: true },
  pistol_walk: { path: "/models/Stickfigure Player/2_Pistol/walk normal", frames: 22, fps: 12, loop: true },
  pistol_run: { path: "/models/Stickfigure Player/2_Pistol/run", frames: 16, fps: 14, loop: true },
  pistol_walk_shoot: { path: "/models/Stickfigure Player/2_Pistol/walk shoot", frames: 22, fps: 14, loop: true },
  pistol_run_shoot: { path: "/models/Stickfigure Player/2_Pistol/run shoot", frames: 16, fps: 16, loop: true },
  pistol_shoot: { path: "/models/Stickfigure Player/2_Pistol/shoot", frames: 5, fps: 18, loop: false }
} as const;
```

## Integration checklist
- [ ] Load frames from each folder and sort by numeric suffix
- [ ] Configure per-clip fps and looping as above
- [ ] Flip X when facing left (mouse.x < player.x)
- [ ] Choose block top/center/bottom by aim angle when RMB held
- [ ] Use `walk_*` vs `run_*` shooting clips based on Shift
- [ ] Land from jump into `run_stop` if moving, else `idle`
- [ ] On hit, play `hurt_*` then resume previous state; on death, play `die_*` and freeze

That’s it — drop this into your animation system and wire inputs to the states above. Enjoy!
