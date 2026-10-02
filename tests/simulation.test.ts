import { describe, expect, it } from 'vitest';
import { BALANCE, arrivalIntervalSec } from '../src/config/balance';
import { LAYOUT, allSeats, customerObstacles, type Vec2 } from '../src/config/layout';
import { GameClock } from '../src/sim/clock';
import { NavGrid } from '../src/sim/nav';
import { clearSave, loadProgress, parseSave, saveProgress, SAVE_KEY, type KeyValueStore } from '../src/save/save';
import { NO_ARRIVALS, STEP, balanceWith, makeSim, runFor, runUntil } from './helpers';

const count = (events: { type: string }[], type: string) => events.filter((e) => e.type === type).length;

describe('orders and payment', () => {
  it('charges ingredients once at preparation start and takes payment once at hand-over', () => {
    const balance = balanceWith(NO_ARRIVALS);
    const sim = makeSim({ balance });
    const start = sim.cashCents;
    sim.open();
    const c = sim.trySpawnCustomer()!;
    const events = runUntil(sim, () => sim.order !== null);
    expect(sim.cashCents).toBe(start - balance.ingredientCostCents);
    expect(sim.ledger.ingredientCostCents).toBe(balance.ingredientCostCents);
    expect(sim.ledger.revenueCents).toBe(0);

    runUntil(sim, () => c.paid, 120, events);
    expect(sim.cashCents).toBe(start - balance.ingredientCostCents + sim.priceCents);

    sim.close();
    runUntil(sim, () => sim.phase === 'results', 300, events);
    expect(count(events, 'orderStarted')).toBe(1);
    expect(count(events, 'served')).toBe(1);
    expect(sim.ledger).toMatchObject({
      served: 1,
      revenueCents: sim.priceCents,
      ingredientCostCents: balance.ingredientCostCents,
      wasted: 0,
      lost: 0,
    });
    expect(sim.lastReport!.profitCents).toBe(sim.priceCents - balance.ingredientCostCents);
  });

  it('finishes and discards a drink whose customer left, keeping the cost as an expense', () => {
    const sim = makeSim({ balance: balanceWith(NO_ARRIVALS) });
    sim.open();
    const a = sim.trySpawnCustomer()!;
    const b = sim.trySpawnCustomer()!;
    runUntil(sim, () => sim.order?.customerId === a.id);
    a.patienceLeft = 0.01; // walks out mid-preparation
    const events = runUntil(sim, () => sim.order?.customerId === b.id, 120);
    expect(count(events, 'abandoned')).toBe(1);
    expect(count(events, 'wasted')).toBe(1);
    expect(a.paid).toBe(false);
    runUntil(sim, () => b.paid, 120, events);
    expect(sim.ledger.ingredientCostCents).toBe(2 * sim.balance.ingredientCostCents);
    expect(sim.ledger.revenueCents).toBe(sim.priceCents);
    expect(sim.ledger.wasted).toBe(1);
  });
});

describe('queue', () => {
  it('abandonment frees the queue position and later customers are still served', () => {
    const sim = makeSim({ balance: balanceWith(NO_ARRIVALS) });
    sim.open();
    const [a, b, c] = [sim.trySpawnCustomer()!, sim.trySpawnCustomer()!, sim.trySpawnCustomer()!];
    expect(sim.queue).toEqual([a.id, b.id, c.id]);
    runFor(sim, 10);
    b.patienceLeft = 0.01;
    runFor(sim, STEP * 2);
    expect(b.state).toBe('leaving');
    expect(sim.queue).not.toContain(b.id);
    expect(sim.queue.indexOf(c.id)).toBe(sim.queue.indexOf(a.id) + 1);
    // c now heads for b's old slot (or the counter), not its original one.
    const target = c.path[c.path.length - 1] ?? c.pos;
    expect(target).not.toEqual(LAYOUT.queueSlots[2]);
    runUntil(sim, () => c.paid, 120);
    expect(sim.ledger.lost).toBe(1);
    expect(sim.ledger.served).toBe(2);
  });

  it('gives queued customers distinct standing positions', () => {
    const sim = makeSim({ balance: balanceWith({ ...NO_ARRIVALS, prepDurationSec: 1000, patienceSec: 1000 }) });
    sim.open();
    for (let i = 0; i < 5; i++) sim.trySpawnCustomer();
    runFor(sim, 20);
    const spots = sim.queue.map((id) => {
      const c = sim.customer(id)!;
      return `${c.pos.x.toFixed(2)},${c.pos.z.toFixed(2)}`;
    });
    expect(new Set(spots).size).toBe(5);
  });

  it('turns arrivals away when the queue is full', () => {
    const sim = makeSim({ balance: balanceWith(NO_ARRIVALS) });
    sim.open();
    for (let i = 0; i < LAYOUT.queueSlots.length; i++) expect(sim.trySpawnCustomer()).not.toBeNull();
    expect(sim.trySpawnCustomer()).toBeNull();
  });
});

describe('seats', () => {
  it('never lets two customers hold the same seat, and overflow customers take away', () => {
    const balance = balanceWith({
      ...NO_ARRIVALS,
      prepDurationSec: 0.5,
      patienceSec: 1000,
      drinkDurationSec: { min: 500, max: 500 },
      maxCustomers: 20,
    });
    const sim = makeSim({ balance });
    sim.open();
    const served = new Set<number>();
    // Keep the queue topped up until 9 customers have been served.
    runUntil(
      sim,
      () => {
        if (sim.queue.length < 3) sim.trySpawnCustomer();
        for (const c of sim.customers) if (c.paid) served.add(c.id);
        return served.size >= 9;
      },
      600,
    );
    runFor(sim, 15);
    const seated = sim.customers.filter((c) => c.seatId !== null);
    expect(seated.length).toBe(allSeats().length);
    expect(new Set(seated.map((c) => c.seatId)).size).toBe(seated.length);
    expect(sim.ledger.takeaway).toBeGreaterThanOrEqual(3);
  });
});

describe('time control', () => {
  const snapshot = (sim: ReturnType<typeof makeSim>) =>
    JSON.stringify({
      t: sim.simTime.toFixed(6),
      day: sim.dayTime.toFixed(6),
      cash: sim.cashCents,
      order: sim.order,
      customers: sim.customers.map((c) => [c.id, c.state, c.pos, c.patienceLeft, c.drinkTimeLeft]),
      barista: sim.barista,
    });

  it('pause freezes every system', () => {
    const sim = makeSim();
    sim.open();
    const clock = new GameClock(sim, STEP);
    for (let i = 0; i < 1200; i++) clock.advance(STEP);
    const before = snapshot(sim);
    clock.speed = 0;
    for (let i = 0; i < 1200; i++) clock.advance(STEP);
    expect(snapshot(sim)).toBe(before);
  });

  it('2x and 3x produce exactly the same simulation as 1x over equal simulated time', () => {
    const results = ([1, 2, 3] as const).map((speed) => {
      const sim = makeSim();
      sim.open();
      const clock = new GameClock(sim, STEP);
      clock.speed = speed;
      const frames = 3600 / speed; // 60 simulated seconds
      for (let i = 0; i < frames; i++) clock.advance(STEP);
      return snapshot(sim);
    });
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
    expect(JSON.parse(results[0]).customers.length).toBeGreaterThan(0);
  });

  it('clamps long frames such as a resumed background tab', () => {
    const sim = makeSim();
    sim.open();
    const clock = new GameClock(sim, STEP, 0.25);
    clock.speed = 3;
    clock.advance(600); // ten minutes away
    expect(sim.simTime).toBeLessThanOrEqual(0.75 + 1e-9);
  });
});

describe('day cycle', () => {
  it('closing stops arrivals and eventually reaches results with an empty café', () => {
    const sim = makeSim();
    sim.open();
    runUntil(sim, () => sim.customers.length >= 3, 120);
    sim.close();
    expect(sim.phase).toBe('closing');
    const events = runUntil(sim, () => sim.phase === 'results', 600);
    expect(count(events, 'arrived')).toBe(0);
    expect(sim.customers.length).toBe(0);
    expect(sim.order).toBeNull();
    expect(sim.lastReport).not.toBeNull();
  });

  it('a full day ends by itself, reports consistent totals and carries cash into the next day', () => {
    const sim = makeSim();
    const start = sim.cashCents;
    sim.open();
    expect(sim.setPrice(500).ok).toBe(false); // price locked during service
    const events = runUntil(sim, () => sim.phase === 'results', BALANCE.dayLengthSec + 300);
    const r = sim.lastReport!;
    expect(r.served).toBe(count(events, 'served'));
    expect(r.lost).toBe(count(events, 'abandoned'));
    expect(r.revenueCents).toBe(r.served * sim.priceCents);
    expect(r.ingredientCostCents).toBe((r.served + r.wasted) * BALANCE.ingredientCostCents);
    expect(sim.cashCents).toBe(start + r.profitCents);
    expect(r.served).toBeGreaterThan(5);
    expect(sim.nextDay().ok).toBe(true);
    expect(sim.day).toBe(2);
    expect(sim.phase).toBe('preparing');
    expect(sim.cashCents).toBe(start + r.profitCents);
  });

  it('higher prices bring fewer arrivals', () => {
    expect(arrivalIntervalSec(500)).toBeGreaterThan(arrivalIntervalSec(300));
    expect(arrivalIntervalSec(200)).toBeLessThan(arrivalIntervalSec(300));
    const arrivals = (price: number) => {
      const sim = makeSim({ progress: { priceCents: price } });
      sim.open();
      return count(runFor(sim, BALANCE.dayLengthSec), 'arrived');
    };
    expect(arrivals(550)).toBeLessThan(arrivals(200));
  });

  it('never goes negative and ends gracefully when it cannot afford ingredients', () => {
    const balance = balanceWith(NO_ARRIVALS);
    expect(makeSim({ balance, progress: { cashCents: 50 } }).open().ok).toBe(false);

    const sim = makeSim({ balance, progress: { cashCents: balance.ingredientCostCents } });
    sim.open();
    const a = sim.trySpawnCustomer()!;
    runUntil(sim, () => sim.order !== null);
    expect(sim.cashCents).toBe(0);
    a.patienceLeft = 0.01; // leaves; the only paid service is lost
    const events = runUntil(sim, () => sim.phase === 'results', 300);
    expect(count(events, 'outOfCash')).toBe(1);
    expect(sim.lastReport!.bankrupt).toBe(true);
    expect(sim.nextDay().ok).toBe(false);
  });

  it('runs many days at every price without breaking invariants', () => {
    for (const price of [150, 300, 450, 600]) {
      const sim = makeSim({ seed: price, progress: { priceCents: price } });
      for (let d = 0; d < 3; d++) {
        sim.open();
        runUntil(sim, () => sim.phase === 'results', BALANCE.dayLengthSec + 400);
        sim.nextDay();
      }
      expect(sim.day).toBe(4);
    }
  });
});

describe('upgrade', () => {
  it('enforces affordability, applies once and speeds up preparation', () => {
    const price = BALANCE.upgrade.priceCents;
    const poor = makeSim({ progress: { cashCents: price } }); // would leave nothing for ingredients
    expect(poor.buyUpgrade().ok).toBe(false);
    expect(poor.cashCents).toBe(price);

    const sim = makeSim({ progress: { cashCents: price + 500 } });
    const before = sim.prepDurationSec;
    expect(sim.buyUpgrade().ok).toBe(true);
    expect(sim.cashCents).toBe(500);
    expect(sim.upgraded).toBe(true);
    expect(sim.buyUpgrade().ok).toBe(false);
    expect(sim.cashCents).toBe(500);
    expect(sim.prepDurationSec).toBeCloseTo(before * BALANCE.upgrade.prepMultiplier);

    const open = makeSim({ progress: { cashCents: price * 3 } });
    open.open();
    expect(open.buyUpgrade().ok).toBe(false);
  });
});

describe('save data', () => {
  const memoryStore = (): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  };

  it('round-trips progression and restores a simulation from it', () => {
    const store = memoryStore();
    const p = { day: 4, cashCents: 12345, upgraded: true, priceCents: 375 };
    expect(saveProgress(p, store)).toBe(true);
    const loaded = loadProgress(store)!;
    expect(loaded).toEqual(p);
    const sim = makeSim({ progress: loaded });
    expect(sim.getProgress()).toEqual(p);
    clearSave(store);
    expect(loadProgress(store)).toBeNull();
  });

  it('only exposes safe progress at boundaries; results saves as the next day', () => {
    const sim = makeSim({ balance: balanceWith(NO_ARRIVALS) });
    expect(sim.safeProgress()).toEqual(sim.getProgress());
    sim.open();
    expect(sim.safeProgress()).toBeNull();
    sim.close();
    runUntil(sim, () => sim.phase === 'results');
    expect(sim.safeProgress()!.day).toBe(2);
  });

  it('rejects corrupt or invalid saves', () => {
    expect(parseSave('not json')).toBeNull();
    expect(parseSave(JSON.stringify({ version: 1, day: 0, cashCents: 10, upgraded: false, priceCents: 300 }))).toBeNull();
    expect(parseSave(JSON.stringify({ version: 1, day: 2, cashCents: -5, upgraded: false, priceCents: 300 }))).toBeNull();
    expect(parseSave(JSON.stringify({ version: 1, day: 2, cashCents: 1.5, upgraded: false, priceCents: 300 }))).toBeNull();
    expect(parseSave(JSON.stringify({ version: 99, day: 2, cashCents: 10, upgraded: false, priceCents: 300 }))).toBeNull();
    expect(parseSave(JSON.stringify({ version: 1, day: 2, cashCents: 10, upgraded: false, priceCents: 99999 }))!.priceCents).toBe(
      BALANCE.price.maxCents,
    );
    const store = memoryStore();
    store.setItem(SAVE_KEY, '{"broken"');
    expect(loadProgress(store)).toBeNull();
  });
});

describe('navigation', () => {
  const nav = new NavGrid(LAYOUT);
  const insideObstacle = (p: Vec2) =>
    customerObstacles().some((o) => Math.abs(p.x - o.x) < o.sx / 2 && Math.abs(p.z - o.z) < o.sz / 2);

  const walkSegments = (from: Vec2, path: Vec2[], check: (p: Vec2) => void) => {
    let a = from;
    for (const b of path) {
      for (let t = 0; t <= 1; t += 0.02) check({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      a = b;
    }
  };

  it('reaches every queue slot and seat approach from the door without crossing furniture', () => {
    const targets = [...LAYOUT.queueSlots, ...allSeats().map((s) => s.approach)];
    for (const t of targets) {
      expect(nav.isWalkable(t)).toBe(true);
      const path = nav.findPath(LAYOUT.entrance.door, t);
      expect(path).not.toBeNull();
      walkSegments(LAYOUT.entrance.door, path!, (p) => expect(insideObstacle(p)).toBe(false));
    }
  });

  it('keeps the queue in front of the counter', () => {
    for (const s of LAYOUT.queueSlots) expect(s.x).toBeGreaterThan(LAYOUT.counter.x + LAYOUT.counter.sx / 2);
  });
});
