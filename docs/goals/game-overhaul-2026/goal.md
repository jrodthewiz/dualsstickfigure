# Game Overhaul 2026

## Objective

Overhaul the Stickfigure Platformer so the deployed game looks more polished, runs more smoothly, and remains easy to install, build, commit, push, and deploy with the existing Next.js setup.

## Goal Kind

`open_ended`

## Current Tranche

Create a researched production plan, save a baseline commit, then complete the first safe implementation tranche that improves production reliability before larger visual and runtime refactors.

## Non-Negotiable Constraints

- Preserve the existing Next.js app structure and deployment path unless evidence shows a change is required.
- Keep multiplayer, map selection, local solo play, collision editing, voice hooks, and current animation assets working.
- Prefer incremental, reviewable commits over one untraceable rewrite.
- Use official or primary technical sources for web, React, Next.js, and Canvas performance decisions.
- Verify with `npm.cmd run build`; use `npx.cmd tsc --noEmit` as the stricter type gate even though Next currently skips type validation.
- Do not remove existing assets or user-facing gameplay without a clear replacement and verification.

## Stop Rule

Stop when the tranche audit passes, all safe local work is blocked, or continuing would require owner input, credentials, destructive operations, or a deployment strategy change the board cannot decide.

## Canonical Board

Machine truth lives at:

`docs/goals/game-overhaul-2026/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/game-overhaul-2026/goal.md
```

## PM Loop

On every continuation:

1. Read this charter.
2. Read `state.yaml`.
3. Work only on the active board task.
4. Assign Scout, Judge, Worker, or PM according to the task.
5. Write a compact task receipt.
6. Update the board.
7. Select the next active task or finish with a Judge/PM audit receipt.
