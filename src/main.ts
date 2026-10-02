import { BALANCE } from './config/balance';
import { LAYOUT } from './config/layout';
import { SceneView } from './render/sceneView';
import { clearSave, loadProgress, saveProgress } from './save/save';
import { GameClock, type Speed } from './sim/clock';
import { CafeSimulation, defaultProgress } from './sim/simulation';
import { Hud } from './ui/hud';
import { WorldOverlay } from './ui/worldOverlay';
import { createVisualFactories } from './visuals';
import { PlaceholderCharacter } from './visuals/placeholderCharacter';

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const visuals = await createVisualFactories();
  if (params.has('placeholders')) {
    // Debug: force placeholder characters (?placeholders).
    visuals.createCustomer = (v) => new PlaceholderCharacter(v);
    visuals.createBarista = () => new PlaceholderCharacter(0, true);
  }

  const sim = new CafeSimulation({
    progress: loadProgress() ?? defaultProgress(),
    variantCount: visuals.customerVariantCount,
  });
  const clock = new GameClock(sim, BALANCE.stepSec);
  let lastSpeed: Exclude<Speed, 0> = 1;

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const view = new SceneView(canvas, LAYOUT, visuals);
  const overlay = new WorldOverlay(document.getElementById('world-overlay')!, view, LAYOUT);

  const save = () => {
    const p = sim.safeProgress();
    if (p) saveProgress(p);
  };

  const hud = new Hud(() => sim, {
    open: () => {
      const r = sim.open();
      if (!r.ok) hud.toast(r.reason ?? 'Cannot open', 'warn');
      else {
        if (clock.paused) clock.speed = lastSpeed;
        hud.toast('Café is open!', 'good');
      }
    },
    close: () => {
      sim.close();
    },
    togglePause: () => {
      if (sim.phase !== 'open' && sim.phase !== 'closing') return;
      clock.speed = clock.paused ? lastSpeed : 0;
    },
    setSpeed: (s) => {
      lastSpeed = s;
      clock.speed = s;
    },
    changePrice: (steps) => {
      const r = sim.setPrice(sim.priceCents + steps * BALANCE.price.stepCents);
      if (!r.ok) hud.toast(r.reason ?? 'Cannot change price', 'warn');
      save();
    },
    buyUpgrade: () => {
      const r = sim.buyUpgrade();
      if (r.ok) {
        hud.toast(`${BALANCE.upgrade.name} installed!`, 'good');
        save();
      } else hud.toast(r.reason ?? 'Cannot buy upgrade', 'warn');
      hud.invalidate();
    },
    nextDay: () => {
      const r = sim.nextDay();
      if (!r.ok) hud.toast(r.reason ?? 'Cannot start next day', 'warn');
      save();
      hud.invalidate();
    },
    restart: () => {
      clearSave();
      location.reload();
    },
    resetSave: () => {
      if (confirm('Reset all saved progress and start again from day 1?')) {
        clearSave();
        location.reload();
      }
    },
    zoom: (f) => view.iso.zoomBy(f),
  });

  // Resize: fit the room between the HUD and the toolbar.
  const resize = () => view.resize(window.innerWidth, window.innerHeight, hud.insets());
  window.addEventListener('resize', resize);
  hud.update(sim, clock.speed); // lay out panels before the first fit
  new ResizeObserver(resize).observe(document.querySelector('.hud-top')!);
  resize();

  // Zoom (wheel) and drag-to-pan when zoomed in.
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      view.iso.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    { passive: false },
  );
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.iso.panByPixels(e.clientX - drag.x, e.clientY - drag.y);
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('pointercancel', () => (drag = null));

  // Avoid a jump when a backgrounded tab resumes.
  let last = performance.now();
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
    clock.resetAccumulator();
  });

  let framedPhase = sim.phase;
  const frame = (now: number) => {
    const realDt = (now - last) / 1000;
    last = now;
    const before = sim.simTime;
    clock.advance(realDt);
    const simDt = sim.simTime - before;

    for (const e of sim.drainEvents()) {
      hud.handleEvent(e);
      view.handleEvent(e);
      overlay.handleEvent(e, sim);
      if (e.type === 'dayEnded') {
        save(); // results boundary: stores the next day's progression
        clock.speed = lastSpeed;
      }
    }
    view.sync(sim, simDt);
    view.render();
    overlay.update(sim);
    hud.update(sim, clock.speed);
    if (sim.phase !== framedPhase) {
      framedPhase = sim.phase;
      resize(); // panels shown/hidden per phase change the free area
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.getElementById('loading')!.hidden = true;
  save();

  console.info(`[cafe] characters: ${visuals.characterSource}`);
  if (import.meta.env.DEV || params.has('debug')) {
    (window as unknown as Record<string, unknown>).__cafe = { sim, clock, view };
  }
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = 'Something went wrong while loading the café. See the console for details.';
});
