# T001 Repo And Research Scout

## External Research Used

- MDN Canvas optimization: use `requestAnimationFrame`, pre-render repeated drawing to offscreen canvas, avoid floating point coordinates where possible, and avoid unnecessary scaling work. Source: https://developer.mozilla.org/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas
- web.dev Canvas performance: keep offscreen canvases snug to the content, batch canvas calls, and reduce unnecessary canvas state changes. Source: https://web.dev/articles/canvas-performance
- MDN OffscreenCanvas: offscreen rendering can decouple Canvas work from the DOM and can be used in workers when the architecture justifies it. Source: https://developer.mozilla.org/docs/Web/API/OffscreenCanvas
- MDN dedicated worker `requestAnimationFrame`: worker animation frames are available in dedicated workers and are paused in most browsers in background contexts. Source: https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope/requestAnimationFrame
- MDN Long Animation Frames API: frames above 50 ms are a direct jank signal and can be observed in supporting browsers. Source: https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing
- Chrome DevTools rendering performance: paint flashing, layout shift regions, and frame rendering stats are appropriate verification tools for visual/performance work. Source: https://developer.chrome.com/docs/devtools/rendering/performance
- Chrome DevTools heap snapshots: use heap snapshots and comparisons to investigate memory growth rather than relying on FPS alone. Source: https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots/
- React Effects: effects that synchronize with browser APIs, subscriptions, animation, or external systems need cleanup and stable dependencies. Source: https://react.dev/learn/synchronizing-with-effects
- React memo: memoization is an optimization, not a guarantee; stable props and callbacks matter when memoizing React UI. Source: https://react.dev/reference/react/memo
- Next.js static export: static exports work for static assets and client-side fetching but features requiring a Node.js server are unsupported. Current app has API routes, so this matters if the deployment target changes away from Vercel/Node hosting. Source: https://nextjs.org/docs/pages/guides/static-exports
- Next.js route handlers: App Router route handlers are valid server endpoints and run at request time unless explicitly cached/static. Source: https://nextjs.org/docs/app/getting-started/route-handlers
- Next.js viewport API: viewport must be exported through `viewport` or `generateViewport`, not nested in `metadata`. Source: https://nextjs.org/docs/app/api-reference/functions/generate-viewport

## Repo Map

- `package.json`: Next 15.3.2, React 18.2, Ably, simple-peer, proton-engine, stats.js. Scripts are `dev`, `build`, `export`, and `start`; `export` currently aliases `next build`.
- `next.config.js`: keeps images unoptimized and trailing slash enabled. TypeScript and ESLint errors are ignored during Next build.
- `app/layout.tsx`: root providers and metadata. Current viewport config triggers a Next 15 warning.
- `app/page.tsx`: central custom canvas game runtime, roughly 13k lines. Owns input mapping, animation loading, audio, update loop, drawing, HUD, menu, pause/debug overlays, multiplayer sync hooks, and large chunks of map rendering.
- `app/game/ai/stateMachine.ts`: enemy decision system. Direct TypeScript check reports direction fields assigned as generic numbers where the public type expects `-1 | 0 | 1`.
- `app/game/platformCache.ts`: pre-render/cache manager already exists, including OffscreenCanvas and ImageBitmap helpers. Integration is incomplete.
- `app/game/viewportCulling.ts`: generic viewport filtering exists.
- `app/game/spatialHash.ts`: spatial grid exists for broad-phase collision/performance work.
- `app/game/maps/*.ts`: map-specific generation/rendering, with `suburbia.ts` currently drawing all houses and street elements instead of using culling.
- `app/components/multiplayer/*.tsx`: lobby, map selection, and ready screens. Visual style is mixed and includes SVG map previews.
- `app/components/ui/*.tsx`: local button/dialog/panel primitives. Button has strict type errors from assigning possibly numeric CSS background values to DOM style strings.
- `app/theme/*.ts` and `app/theme/css-vars.css`: current theme is heavily grayscale/Windows-classic. It is consistent in places but visually narrow for a modern overhaul.
- `app/api/*`: server route handlers for R2 upload and collision settings. These mean pure static export has deployment caveats unless replaced or disabled for static targets.
- `public/models/Stickfigure Player/**`: large sprite-frame library with paths containing spaces; current loader URL-encodes paths.
- Existing reports (`OPTIMIZATION_TODO.md`, `FINAL_*`, etc.): useful history but contain mojibake and claims that are not all covered by current verification.

## Current Verification

Command: `npm.cmd run build`

Result: pass.

Evidence:

- Next 15.3.2 compiled successfully.
- Routes generated: `/`, `/_not-found`, `/test-images`; API routes remain dynamic.
- Warning: viewport metadata should move from `metadata` to `viewport`.

Command: `npx.cmd tsc --noEmit`

Result: fail.

Evidence:

- `app/components/ui/Button.tsx`: two `Background<string | number>` to `string` assignment errors.
- `app/game/ai/stateMachine.ts`: twelve `number` to `0 | 1 | -1` assignment errors.

## High Level Overhaul Plan

1. Production safety gate.
   Fix the Next viewport warning and direct TypeScript failures first. This gives later visual and performance work a reliable local check instead of relying on a build that skips validation.

2. Visual system and UI polish.
   Replace the mixed grayscale, retro, Windows-classic, and neon styling with one deliberate art direction. Consolidate common button/panel/dialog styles, repair mojibake strings, keep HUD text readable at desktop and mobile sizes, and reduce playfield obstruction.

3. Game runtime rendering pass.
   Finish platform cache integration where assets are static, keep dynamic elements separate, and add lightweight frame telemetry/LoAF visibility so performance changes are measured. Use existing `platformCache.ts`, `viewportCulling.ts`, and `spatialHash.ts` rather than new runtime dependencies.

4. Map and game-feel polish.
   Make each map read clearly as an arena with better depth layers, safer spawn readability, stronger platform silhouettes, and consistent color/contrast. Avoid map generation changes that alter collision until the visual layer is verified.

5. Multiplayer and lobby hardening.
   Preserve Ably lobby and PvP behavior, but improve state presentation, disabled states, readiness feedback, and host/client affordances.

6. Playtest and deployment gate.
   Run build, type check, browser smoke tests, desktop/mobile screenshots, console checks, and then commit/push each reviewable tranche.

## Ranked Improvement Candidates

1. Fix build-warning and type-check failures.
   Impact: high. Risk: low. Verification: strong.

2. Repair UI text encoding artifacts.
   Impact: high visible polish. Risk: low to medium because many strings are embedded in `app/page.tsx`.

3. Consolidate the menu/HUD visual system.
   Impact: high. Risk: medium due large inline styles and overlap risk.

4. Integrate platform cache incrementally.
   Impact: high runtime performance. Risk: medium due async bitmap creation and map-specific drawing branches.

5. Add browser-performance telemetry and playtest checks.
   Impact: medium to high. Risk: low if opt-in/debug only.

6. Split `app/page.tsx` systems.
   Impact: high maintainability. Risk: high; should follow behavior-preserving tests/playtests rather than lead.
