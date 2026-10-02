# Little Brew — café management sim

A browser-based, low-poly isometric café management MVP built with **Vite + TypeScript + Three.js**.
Everything runs client-side: no backend, accounts or paid services.

The gameplay, economy, movement, UI, save data and tests are complete. Visuals are simple
placeholders, apart from the Kenney Mini Characters, which are integrated. Final art goes through the
interfaces described in [docs/visual-handoff.md](docs/visual-handoff.md).

## Run it

Requires Node.js 20+ (developed on Node 23, npm 10).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation tests (Vitest, headless)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm run probe      # balancing aid: average day results per price (base vs upgraded machine)
```

URL flags: `?placeholders` forces placeholder characters; `?debug` exposes `window.__cafe`
(`{ sim, clock, view }`) in production builds. It is always exposed in `npm run dev`.

## How to play

You manage the café, and the barista serves customers automatically.

1. **Before opening**: check the day and your cash. Set the coffee price ($1.50–$6.00 in $0.25 steps).
   The panel shows your margin and the expected number of visitors. Buy the **Dual-boiler espresso
   machine** once you can afford it.
2. **Open café**: a day lasts 3 minutes at 1×. Customers arrive (fewer at higher prices), queue and
   order. The barista makes one coffee at a time. A bubble over each queued customer shows their
   patience; a bar over the machine shows brewing progress. Customers who wait too long give up
   without paying. Served customers pay at hand-over and then sit down, or take the drink away if
   every seat is taken. Use **Pause** (Space) and **1× / 2× / 3×** (keys 1–3). Zoom with the mouse
   wheel or the +/− buttons, and drag to pan while zoomed in. The price is locked while open.
3. **Closing**: happens at the end of the day, or press **Close early**. No new customers arrive, and
   everyone inside finishes normally. The **day report** appears once the café is empty: revenue,
   ingredient costs, profit, customers served/lost, wasted drinks and takeaways. Then press
   **Start day N+1**.

**First goal:** save $140.90 (the $140 upgrade plus one coffee's ingredients) for the faster machine.
At the default price this takes about three days.

## Architecture

```
src/
  config/balance.ts     all balancing values (integer cents, seconds, meters) + rationale
  config/layout.ts      SHARED: room, furniture footprints, entrance, queue slots, seats, barista points
  sim/                  pure simulation — no Three.js, no DOM
    simulation.ts       CafeSimulation: day phases, customers, queue, orders, seats, ledger
    nav.ts              walkability grid + A* + line-of-sight smoothing
    clock.ts            fixed-timestep GameClock (pause, 1–3×, frame clamp)
    types.ts, rng.ts    state types/events; seeded RNG
  save/save.ts          localStorage progression (validated)
  render/               SceneView (syncs visuals to sim state) + IsoCamera (fit, zoom, pan)
  visuals/              replaceable visual factories (Codex) — see docs/visual-handoff.md
  ui/                   HUD (DOM), world-anchored overlays, styles
  main.ts               wiring + main loop
tests/                  Vitest simulation tests (+ opt-in balance probe)
public/assets/kenney-mini-characters/   GLBs + texture + LICENSE.md
```

**Simulation vs rendering.** `CafeSimulation` is the single source of truth. Queue membership
(`sim.queue`), order ownership (`sim.order.customerId`), seat reservations (`sim.seats[].reservedBy`)
and payments (`customer.paid`, `sim.ledger`) are all simulation data. The renderer only reads them and
never writes to them. Nothing in gameplay depends on meshes or animation clips.

**Time.** The main loop feeds real frame time into `GameClock`, which runs fixed 1/60 s steps
multiplied by the speed. Pause adds no time, so movement, preparation, patience, drinking and the day
timer all freeze together; 3× is exactly three times as many identical steps. Frame time is clamped
to 0.25 s and the accumulator is reset when the tab becomes visible, so a resumed tab never jumps
ahead. Gameplay uses no `setTimeout` or `setInterval`; toast fade-outs are the only browser timers.

**Day states:** `preparing → open → closing → results → preparing (next day)`.

**Customer states:** `entering → queuing → waitingForDrink → walkingToSeat → drinking → leaving`.
Customers can also go straight to `leaving` (abandoned, or takeaway). IDs increase and are never
reused.

**Movement.** Customers path on a 0.25 m grid that keeps 0.3 m of clearance from walls, floor edges,
the counters, the staff area, tables and chairs. Each queue position has its own slot, and customers
re-path forward when someone ahead leaves. Customers reserve a seat before walking to it, step in
from the seat's approach point, and release it when they leave. The barista walks straight lines
behind the counter.

### Economy rules and edge cases

- Money is integer cents throughout.
- **Ingredient cost is charged once**, when preparation starts. **Revenue is recorded once**, at
  hand-over. The two are tracked separately, so wasted drinks still count as expenses.
- **The customer leaves during preparation:** the drink is finished, then discarded (counted as
  wasted), and the barista moves to the next order.
- **Not enough cash for ingredients:** the order is not started.
- **Unrecoverable:** if the café can't afford ingredients and no paid order is pending, it closes. The
  report then offers **Restart from day 1** instead of the next day. The same check runs before
  opening.
- **Upgrade:** buy once, only before opening, and only if at least one coffee's ingredients
  (`cash − price ≥ ingredient cost`) remain afterwards, so buying can't soft-lock the café.
- Cash never goes negative, and nothing is paid or charged twice. The tests check both on every
  simulation step.

### Balancing (src/config/balance.ts)

| Setting | Value |
|---|---|
| Starting cash | $40.00 |
| Coffee price | default $3.00, range $1.50–$6.00, step $0.25 |
| Ingredient cost | $0.90 per coffee |
| Arrivals | every 6.5 s at $3.00 (±35% jitter); interval × (price/$3)^2.2, clamped to 3–45 s |
| Preparation | 10 s (5 s with the upgrade) |
| Patience | 40 s in the queue; 25 s more once the order starts |
| Drinking | 12–20 s |
| Walking speed | customer 1.3 m/s, barista 1.6 m/s |
| Max customers | 10 inside; 6 queue slots (arrivals are turned away when either is full) |
| Day length | 180 s |
| Upgrade | $140, preparation × 0.5 |

Measured with `npm run probe` (4 seeds per price; average served, lost and profit per day):

| Price | $2.50 | $3.00 | $3.50 | $4.00 | $5.00 |
|---|---|---|---|---|---|
| Base machine | 18 / 8 / $29 | 18 / 6 / $37 | 18 / 2 / $46 | 15 / 0 / $45 | 9 / 0 / $37 |
| Upgraded | 30 / 0 / $48 | 27 / 0 / $57 | 20 / 0 / $51 | 15 / 0 / $47 | 9 / 0 / $37 |

The base machine limits the café to about 18 coffees a day, so the best base price is around $3.50.
The upgrade lifts capacity to about 30, and the best price then drops to around $3.

### Save data

`localStorage["cafe-sim.save"]` (key kept from the working title so existing saves still load) holds `{ version, day, cashCents, upgraded, priceCents }`, and it is
validated on load: anything corrupt or out of range is ignored. The game saves at safe boundaries:
on load, after price changes and the upgrade purchase (before opening), when the day report appears,
and when the next day starts.

- **Reloading mid-service** restores the last boundary, i.e. that day's preparation with the cash you
  had before opening. In-progress customers, orders and the day's ledger are deliberately not saved.
- **Reloading on the report screen** resumes at the next day's preparation, keeping the day's
  earnings.
- **Reset saved progress…** (in the plan panel) asks for confirmation, then clears the save and
  restarts.

## Ownership

| Area | Owner |
|---|---|
| Simulation, economy, movement, UI, save data, tests | Claude |
| Final models, materials, scene composition, lighting, character visuals, camera polish | Codex |
| `src/config/layout.ts`, `src/visuals/types.ts` (layout + visual interfaces) | Shared — document changes in the handoff |

## Known limitations

- Furniture, room and props are placeholder geometry. Lighting and shadows are basic.
- Customers don't avoid each other while walking (they pass through each other), but queue
  positions never overlap.
- Customers turned away at the door (queue or café full) aren't counted as "lost"; only customers who
  gave up waiting are.
- Camera rotation is deferred. Zoom is limited to 1×–2.5×, with pan clamped while zoomed.
- The layout is tuned for desktop and tablet. On phone-width screens (~420 px) the plan panel
  overlaps the scene before opening.
- `npm audit` reports a moderate advisory in the dev-only `vitest` 3.x test runner. Upgrading to
  4.1.11+ is blocked by an npm 10.9.2 resolver crash (`Cannot read properties of null (reading
  'edgesOut')`); try again with a newer npm. The shipped game doesn't use it.
