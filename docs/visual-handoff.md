# Visual handoff (for Codex)

The gameplay is complete and runs on placeholder geometry. This document covers what you can
replace and the contract the gameplay depends on. The art direction comes from
`design/visual-brief.md` and `design/cafe-mvp-reference-v1.png`: warm wood, cream, sage and
terracotta.

## Ownership

- **Codex:** final models, materials, scene composition, lighting, character visuals, camera polish.
- **Claude:** simulation, economy, movement, UI, save data, tests.
- **Shared:** `src/config/layout.ts` (layout + anchors) and `src/visuals/types.ts` (visual
  interfaces). If you change either, note what changed and why in this file. A layout change moves
  gameplay too, so run `npm test`: the navigation tests check that every queue slot and seat is
  still reachable without crossing furniture.

## Files to replace or edit

| File | What it is | Codex action |
|---|---|---|
| `src/visuals/placeholderFurniture.ts` | Room, counters, espresso machine, table, chair, cup (boxes) | Replace freely; keep the factory signatures |
| `src/visuals/placeholderCharacter.ts` | Procedural box character (fallback when the GLBs fail) | Optional; keep it as the fallback |
| `src/visuals/kenneyCharacters.ts` | Kenney GLB loading, cloning, clip mapping, cup attachment | Tune scale, offsets, clip mapping, materials |
| `src/visuals/index.ts` | Assembles `VisualFactories` | Swap in new factories here |
| `src/visuals/palette.ts` | Palette constants | Edit |
| `src/render/sceneView.ts` → `addLights()` | Hemisphere + one shadow-casting directional light | Replace lighting |
| `src/render/sceneView.ts` → `buildStatic()` | Places furniture from layout data | Edit only if adding decor; don't hard-code gameplay positions |
| `src/render/isoCamera.ts` → `CAMERA` | Azimuth 45°, elevation 35.264°, zoom 1–2.5×, margin | Polish framing; the fit logic frames the room between HUD and toolbar |
| `src/ui/styles.css` | HUD styling | Claude-owned, but small visual tweaks are fine |

Don't change `src/sim/*`, `src/config/balance.ts` or `src/save/*` for visual work.

## Conventions

- 1 unit = 1 m. Y is up. The floor surface is at Y = 0.
- The simulation runs on the XZ plane. Yaw is a rotation around +Y in radians: **yaw 0 faces +Z**,
  yaw π/2 faces +X.
- **Character** roots have their origin at the feet and face local **+Z**. Put any import correction
  (scale, rotation, offset) on a child wrapper. The scene overwrites `root.position` and
  `root.rotation.y` every frame from simulation state.
- **Furniture** groups have their origin at floor level, centred on the footprint, with their
  "front" facing local +Z. The scene positions and rotates them from layout data.
- Gameplay never looks up model children by name. Every semantic location comes from
  `layout.ts`.

Room orientation (seen from the default camera at +X/+Z):

- The back-left wall is the plane `x = room.minX`; the service counter runs along it.
- The back-right wall is the plane `z = room.minZ` (window side).
- The front edges (`x = maxX`, `z = maxZ`) are open. The entrance is on the near-right edge (`x = maxX`).

## Visual factory interface (`src/visuals/types.ts`)

```ts
interface VisualFactories {
  createRoom(layout): THREE.Group;                       // placed at world origin
  createCounter({ width, depth, height }, kind: 'service' | 'back'): THREE.Group;
  createEspressoMachine(): THREE.Group;                  // placed on top of the back counter
  createTable(table: TableLayout): THREE.Group;
  createChair(seat: SeatAnchor): THREE.Group;            // sitter faces local +Z, backrest at -Z
  createCustomer(variant: number): CharacterVisual;      // variant ∈ [0, customerVariantCount)
  createBarista(): CharacterVisual;
  readonly customerVariantCount: number;
  readonly characterSource: string;                      // logged at startup
}

interface CharacterVisual {
  readonly root: THREE.Group;                            // scene drives position + yaw
  update(dt: number): void;                              // dt = simulation seconds (0 when paused, ×speed)
  setAction(action: CharacterAction, opts?: { seatHeight?: number }): void; // idempotent
  setHolding(holding: boolean): void;                    // show/hide a cup in hand
  dispose(): void;                                       // detach + free per-instance resources
}

type CharacterAction = 'idle' | 'walk' | 'sit' | 'work' | 'serve';
```

How the scene drives actions (`SceneView.sync`):

| Situation | Action | Holding |
|---|---|---|
| Customer moving along a path | `walk` | cup once served (takeaway / walking to seat) |
| Customer standing in the queue or at the counter | `idle` | no |
| Customer seated (`drinking`) — root placed at the seat anchor, yaw = seat facing | `sit` + `seatHeight` | yes |
| Barista walking | `walk` | yes while carrying a finished drink to the hand-off point |
| Barista at the machine while an order is being prepared | `work` | no |
| Barista for 0.6 s after a hand-over | `serve` | no |
| Otherwise | `idle` | no |

Counters: the layout rects give `sx` (depth, along world X) and `sz` (length, along world Z). The
scene calls `createCounter({ width: sz, depth: sx, height })` and rotates the result by π/2, so the
counter's local +Z front faces world +X (the customer side for the service counter, the barista
side for the back counter).

## Layout and interaction anchors (`src/config/layout.ts`)

| Key | Meaning | Current value |
|---|---|---|
| `room` | Floor bounds, wall height/thickness | x −4.5…4.5, z −3.75…3.75, walls 2.6 m |
| `entrance.outside` / `entrance.door` / `width` | Spawn/despawn point off the floor / first point inside / opening width | (5.4, 2.7) / (4.0, 2.7) / 1.4 m |
| `counter` | Service counter footprint + height | centre (−2.6, −1.45), 0.7 × 4.6, h 0.55 |
| `backCounter` | Back counter footprint + height | centre (−4.2, −1.7), 0.6 × 3.2, h 0.55 |
| `espressoMachine.position` / `rotationY` / `indicatorHeight` | Machine on the back counter, front faces +X; progress-bar height | (−4.2, −1.3), π/2, 1.35 m |
| `staffZone` | Area behind the counter that customers can't enter | x −4.5…−2.25, z −3.75…1.15 |
| `barista.idle` / `machine` / `handoff` (+ rotations) | Barista stand points | (−3.25, −1.9) / (−3.55, −1.3) facing −X / (−2.95, −2.5) facing +X |
| `queueSlots[0..5]` / `queueRotationY` | Slot 0 is the pickup point at the counter; later slots run toward +X, 0.9 m apart; queuers face −X | (−1.8, −2.5) … (2.7, −2.5) |
| `tables[i].center/size/height` | Three square tables | (−1.0, 2.0), (0.9, 0.1), (2.4, 2.4); 0.8 × 0.8, h 0.42 |
| `tables[i].seats[j]` | `position` (chair centre = seated position), `rotationY` (faces the table), `approach` (walkable step-in point), `sitHeight` (0.24 m) | two per table, on the −X / +X sides |
| `chairSize` | Chair footprint (blocks walking) | 0.5 × 0.5 |
| `customerIndicatorHeight` | Order-bubble height over customers | 1.55 m |
| `nav.cellSize` / `nav.agentRadius` | Pathing grid / clearance | 0.25 m / 0.3 m |

Furniture heights are deliberately low to fit Kenney's short, big-headed characters (≈1.2 m tall at
the current scale, shoulders at ≈0.45 m). If you resize furniture, update the footprints and heights
here rather than only in the meshes, so pathing stays consistent with what's on screen.

## Kenney Mini Characters (verified)

Location: `public/assets/kenney-mini-characters/` contains 12 `character-*.glb` files,
`Textures/colormap.png` (external texture referenced by every GLB) and `LICENSE.md` (CC0). The
originals in `/mini-character` are untouched; the wheelchair and aid GLBs were not copied. The
supplied pack had no `License.txt`, which `LICENSE.md` notes.

Inspected from the GLB files:

- **Rig** (identical in all 12): nodes `root`, `leg-left`, `leg-right`, `torso`, `arm-left`,
  `arm-right`, `head`, with skinned meshes `body-mesh` and `head-mesh`. The bind pose has identity
  rotations.
- **Size and orientation:** about 0.78–0.79 units tall, origin at the feet, facing **+Z** (checked in
  game: queuers face the counter, seated customers face their table).
- **Clips (32):** `static`, `idle` (1.33 s), `walk` (0.67 s), `sprint`, `jump`, `fall`, `crouch`, `sit`
  (pose), `drive`, `die`, `pick-up`, `emote-yes`, `emote-no`, `holding-right`, `holding-left`,
  `holding-both`, `holding-right-shoot`, `holding-left-shoot`, `holding-both-shoot`,
  `attack-melee-right`, `attack-melee-left`, `attack-kick-right`, `attack-kick-left`,
  `interact-right`, `interact-left`, `wheelchair-sit`, `wheelchair-look-left`,
  `wheelchair-look-right`, `wheelchair-move-forward`, `wheelchair-move-back`,
  `wheelchair-move-left`, `wheelchair-move-right`.
- The pack has **no** dedicated barista, carrying or coffee-making animations.
- `idle` and `walk` hold the arms out at 45°. That's the pack's style, not a bug.
- `sit` lowers the `root` bone by 0.15 model units and rotates the legs about 75° forward.
- `holding-right` only animates the arms. The integration builds composite clips
  (`<clip>+holding`) that take the arm tracks from `holding-right` and everything else from the base
  clip, so customers can walk or sit while holding a cup.

Current mapping (`KENNEY_ACTION_CLIPS`; first available clip wins, otherwise falls back to `idle`,
then `static`):

| Action | Clip |
|---|---|
| idle | `idle` |
| walk | `walk` |
| sit | `sit`, with `model.y = seatHeight + KENNEY_SIT_OFFSET` (0.02) |
| work | `interact-right` (looped) |
| serve | `interact-left` (fallback `pick-up`) |
| holding (overlay) | `holding-right` arm tracks + a cup parented to the `arm-right` bone |

Implementation notes:

- Each instance is a `SkeletonUtils.clone` with its own `AnimationMixer`, so animation state is
  independent per instance. Clips, geometry, materials and textures are shared, so `dispose()` only
  stops the mixer and detaches.
- `KENNEY_SCALE = 1.5`. The barista uses `character-female-d` plus a sage apron box on the torso.
  Customers use the other 11 models.
- Skinned meshes set `frustumCulled = false` because their bounds don't follow the animation.
- If loading fails, the game falls back to `PlaceholderCharacter`. You can force this with
  `?placeholders`.
- Gameplay never waits on an animation. Clips can be missing or renamed without affecting the
  simulation.

## Overlays

The order bubbles, preparation bar and floating "+$3.00" texts are DOM elements
(`src/ui/worldOverlay.ts`). They are positioned each frame by projecting the layout anchors above:
`customerIndicatorHeight` and `espressoMachine.indicatorHeight`. If your models are taller or
shorter, adjust those two heights.

## Remaining visual limitations

- Every prop is placeholder geometry: plain boxes and cylinders with flat-shaded matte materials.
  Decor (window, menu board, shelf, plant, door posts, mat) is minimal and lives in `createRoom`.
- Lighting is a quick hemisphere + directional setup. Shadows are faint, and there is no contact
  shadow or ambient occlusion.
- The cup position in the Kenney hand (`cup.position` in `KenneyCharacter`) and `KENNEY_SIT_OFFSET`
  were tuned by eye from screenshots.
- At 1600×900 the room fills about 50% of the screen width, against about 75% in the reference,
  because the 2.6 m walls set the vertical fit. Lower walls or a tighter `marginPx` would enlarge
  it.
- Customers walk through each other; there is no avoidance.
- No camera rotation (deferred by design).
