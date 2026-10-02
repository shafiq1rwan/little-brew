import { BALANCE, arrivalIntervalSec, clampPrice, formatCents, type BalanceConfig } from '../config/balance';
import { LAYOUT, allSeats, type Layout, type SeatAnchor, type Vec2 } from '../config/layout';
import { NavGrid } from './nav';
import { Rng } from './rng';
import type {
  Barista,
  CommandResult,
  Customer,
  DayLedger,
  DayPhase,
  DayReport,
  Order,
  Progress,
  Seat,
  SimEvent,
} from './types';

export interface SimOptions {
  balance?: BalanceConfig;
  layout?: Layout;
  seed?: number;
  progress?: Progress;
  /** Number of character variants available for `Customer.variant`. */
  variantCount?: number;
}

const emptyLedger = (): DayLedger => ({
  revenueCents: 0,
  ingredientCostCents: 0,
  served: 0,
  lost: 0,
  wasted: 0,
  takeaway: 0,
});

export function defaultProgress(b: BalanceConfig = BALANCE): Progress {
  return { day: 1, cashCents: b.startingCashCents, upgraded: false, priceCents: b.price.defaultCents };
}

/**
 * Authoritative café simulation. Has no dependency on Three.js or the DOM: rendering reads its
 * public state each frame, the UI calls its commands. Advance it only through `step(dt)` with
 * small fixed steps (see GameClock), so pause/speed affect every system identically.
 */
export class CafeSimulation {
  readonly balance: BalanceConfig;
  readonly layout: Layout;
  readonly nav: NavGrid;
  readonly seatAnchors: SeatAnchor[];

  phase: DayPhase = 'preparing';
  day: number;
  cashCents: number;
  upgraded: boolean;
  priceCents: number;

  /** Seconds since the café opened today. */
  dayTime = 0;
  /** Total simulated seconds (drives visuals/animation). */
  simTime = 0;

  readonly customers: Customer[] = [];
  /** Customer ids in queue order; index = queue slot. Authoritative queue membership. */
  queue: number[] = [];
  readonly seats: Seat[];
  readonly barista: Barista;
  order: Order | null = null;
  ledger: DayLedger = emptyLedger();
  lastReport: DayReport | null = null;
  closeReason: 'time' | 'player' | 'outOfCash' | null = null;

  private readonly rng: Rng;
  private readonly variantCount: number;
  private nextArrivalIn = 0;
  private nextCustomerId = 1;
  private nextOrderId = 1;
  private events: SimEvent[] = [];
  private cannotAffordNotified = false;

  constructor(opts: SimOptions = {}) {
    this.balance = opts.balance ?? BALANCE;
    this.layout = opts.layout ?? LAYOUT;
    this.nav = new NavGrid(this.layout);
    this.rng = new Rng(opts.seed ?? (Date.now() & 0xffffffff));
    this.variantCount = Math.max(1, opts.variantCount ?? 12);
    this.seatAnchors = allSeats(this.layout);
    this.seats = this.seatAnchors.map((s) => ({ id: s.id, reservedBy: null }));
    const p = opts.progress ?? defaultProgress(this.balance);
    this.day = p.day;
    this.cashCents = p.cashCents;
    this.upgraded = p.upgraded;
    this.priceCents = clampPrice(p.priceCents, this.balance);
    const b = this.layout.barista;
    this.barista = { state: 'idle', pos: { ...b.idle }, heading: b.handoffRotationY, path: [], restHeading: null };
  }

  // ---------------------------------------------------------------- queries

  get prepDurationSec(): number {
    return this.balance.prepDurationSec * (this.upgraded ? this.balance.upgrade.prepMultiplier : 1);
  }

  get timeRemainingSec(): number {
    return this.phase === 'open' ? Math.max(0, this.balance.dayLengthSec - this.dayTime) : 0;
  }

  /** Customers currently in the queue (including the one whose drink is being made). */
  get waitingCount(): number {
    return this.queue.length;
  }

  /** Cannot afford a single coffee and nothing is pending that would pay. */
  get isBankrupt(): boolean {
    return this.cashCents < this.balance.ingredientCostCents && this.order === null;
  }

  customer(id: number): Customer | undefined {
    return this.customers.find((c) => c.id === id);
  }

  getProgress(): Progress {
    return { day: this.day, cashCents: this.cashCents, upgraded: this.upgraded, priceCents: this.priceCents };
  }

  /**
   * Progression safe to persist, or null mid-service. On the results screen this is already the
   * next day, so a reload resumes at the next day's preparation.
   */
  safeProgress(): Progress | null {
    if (this.phase === 'preparing') return this.getProgress();
    if (this.phase === 'results') return { ...this.getProgress(), day: this.day + 1 };
    return null;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  canBuyUpgrade(): CommandResult {
    if (this.upgraded) return { ok: false, reason: 'Already installed' };
    if (this.phase !== 'preparing') return { ok: false, reason: 'Only before opening' };
    const reserve = this.balance.ingredientCostCents;
    if (this.cashCents - this.balance.upgrade.priceCents < reserve) {
      return {
        ok: false,
        reason: `Need ${formatCents(this.balance.upgrade.priceCents + reserve)} (keeps ${formatCents(reserve)} for ingredients)`,
      };
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- commands

  setPrice(cents: number): CommandResult {
    if (this.phase !== 'preparing') return { ok: false, reason: 'Price is locked during service' };
    this.priceCents = clampPrice(cents, this.balance);
    return { ok: true };
  }

  buyUpgrade(): CommandResult {
    const check = this.canBuyUpgrade();
    if (!check.ok) return check;
    this.cashCents -= this.balance.upgrade.priceCents;
    this.upgraded = true;
    return { ok: true };
  }

  open(): CommandResult {
    if (this.phase !== 'preparing') return { ok: false, reason: 'Café is not in preparation' };
    if (this.isBankrupt) return { ok: false, reason: 'Not enough cash for ingredients' };
    this.phase = 'open';
    this.closeReason = null;
    this.dayTime = 0;
    this.ledger = emptyLedger();
    this.lastReport = null;
    this.cannotAffordNotified = false;
    this.nextArrivalIn = this.balance.arrivals.firstArrivalSec;
    return { ok: true };
  }

  close(): CommandResult {
    if (this.phase !== 'open') return { ok: false, reason: 'Café is not open' };
    this.beginClosing('player');
    return { ok: true };
  }

  nextDay(): CommandResult {
    if (this.phase !== 'results') return { ok: false, reason: 'Day has not ended' };
    if (this.isBankrupt) return { ok: false, reason: 'Out of cash — restart required' };
    this.day += 1;
    this.phase = 'preparing';
    this.ledger = emptyLedger();
    this.dayTime = 0;
    return { ok: true };
  }

  // ---------------------------------------------------------------- stepping

  step(dt: number): void {
    if (dt <= 0) return;
    // Defensive: never integrate a large step in one go.
    const maxStep = 0.1;
    while (dt > maxStep) {
      this.step(maxStep);
      dt -= maxStep;
    }
    this.simTime += dt;

    if (this.phase === 'open') {
      this.dayTime += dt;
      this.updateArrivals(dt);
      if (this.dayTime >= this.balance.dayLengthSec) this.beginClosing('time');
    }
    if (this.phase === 'open' || this.phase === 'closing') {
      this.updateCustomers(dt);
      this.updateBarista(dt);
      if (this.phase === 'open' && this.isBankrupt) {
        this.events.push({ type: 'outOfCash' });
        this.beginClosing('outOfCash');
      }
      if (this.phase === 'closing' && this.customers.length === 0 && this.order === null) this.endDay();
    } else {
      // Keep the barista settling back to their spot between days.
      this.moveAlong(this.barista, this.balance.baristaSpeed, dt);
    }
  }

  private beginClosing(reason: 'time' | 'player' | 'outOfCash'): void {
    if (this.phase !== 'open') return;
    this.phase = 'closing';
    this.closeReason = reason;
    this.events.push({ type: 'closing', reason });
  }

  private endDay(): void {
    const l = this.ledger;
    const report: DayReport = {
      ...l,
      day: this.day,
      profitCents: l.revenueCents - l.ingredientCostCents,
      cashCents: this.cashCents,
      bankrupt: this.isBankrupt,
    };
    this.lastReport = report;
    this.phase = 'results';
    this.events.push({ type: 'dayEnded', report });
  }

  // ---------------------------------------------------------------- arrivals

  private sampleArrivalInterval(): number {
    const j = this.balance.arrivals.jitter;
    return arrivalIntervalSec(this.priceCents, this.balance) * this.rng.range(1 - j, 1 + j);
  }

  private updateArrivals(dt: number): void {
    this.nextArrivalIn -= dt;
    if (this.nextArrivalIn > 0) return;
    this.nextArrivalIn = this.sampleArrivalInterval();
    this.trySpawnCustomer();
  }

  /** Spawns a customer at the entrance if the café and queue have room. */
  trySpawnCustomer(): Customer | null {
    if (this.phase !== 'open') return null;
    if (this.customers.length >= this.balance.maxCustomers) return null;
    if (this.queue.length >= this.layout.queueSlots.length) return null;
    const { outside } = this.layout.entrance;
    const patience = this.balance.patienceSec * this.rng.range(0.9, 1.1);
    const c: Customer = {
      id: this.nextCustomerId++,
      variant: this.rng.int(this.variantCount),
      state: 'entering',
      outcome: 'pending',
      pos: { ...outside },
      heading: -Math.PI / 2,
      path: [],
      restHeading: this.layout.queueRotationY,
      patienceLeft: patience,
      patienceMax: patience,
      seatId: null,
      drinkTimeLeft: 0,
      hasDrink: false,
      paid: false,
    };
    this.customers.push(c);
    this.queue.push(c.id);
    c.path = this.routeTo(c.pos, this.layout.queueSlots[this.queue.length - 1]);
    this.events.push({ type: 'arrived', customerId: c.id });
    return c;
  }

  // ---------------------------------------------------------------- customers

  private updateCustomers(dt: number): void {
    for (const c of [...this.customers]) {
      const arrived = this.moveAlong(c, this.balance.customerSpeed, dt);
      switch (c.state) {
        case 'entering':
        case 'queuing':
        case 'waitingForDrink':
          if (c.state === 'entering' && arrived) c.state = 'queuing';
          c.patienceLeft -= dt;
          if (c.patienceLeft <= 0) this.abandon(c);
          break;
        case 'walkingToSeat':
          if (arrived) {
            c.state = 'drinking';
            this.events.push({ type: 'seated', customerId: c.id, seatId: c.seatId! });
          }
          break;
        case 'drinking':
          c.drinkTimeLeft -= dt;
          if (c.drinkTimeLeft <= 0) {
            c.hasDrink = false; // finished it
            this.leave(c);
          }
          break;
        case 'leaving':
          if (arrived) this.remove(c);
          break;
      }
    }
  }

  private abandon(c: Customer): void {
    this.removeFromQueue(c.id);
    c.outcome = 'abandoned';
    this.ledger.lost += 1;
    if (this.order && this.order.customerId === c.id) this.order.discarded = true;
    this.events.push({ type: 'abandoned', customerId: c.id });
    this.leave(c);
  }

  private leave(c: Customer): void {
    let path: Vec2[];
    if (c.seatId !== null) {
      const anchor = this.seatAnchors.find((s) => s.id === c.seatId)!;
      this.releaseSeat(c);
      path = [{ ...anchor.approach }, ...this.routeTo(anchor.approach, this.layout.entrance.door)];
    } else {
      path = this.routeTo(c.pos, this.layout.entrance.door);
    }
    c.state = 'leaving';
    c.path = [...path, { ...this.layout.entrance.outside }];
    c.restHeading = null;
  }

  private remove(c: Customer): void {
    this.removeFromQueue(c.id);
    this.releaseSeat(c);
    const i = this.customers.indexOf(c);
    if (i >= 0) this.customers.splice(i, 1);
    this.events.push({ type: 'departed', customerId: c.id });
  }

  private removeFromQueue(id: number): void {
    const i = this.queue.indexOf(id);
    if (i < 0) return;
    this.queue.splice(i, 1);
    this.repathQueue();
  }

  /** Re-target every queued customer to the slot matching their queue index. */
  private repathQueue(): void {
    this.queue.forEach((id, i) => {
      const c = this.customer(id)!;
      if (c.state !== 'entering' && c.state !== 'queuing') return;
      const slot = this.layout.queueSlots[i];
      const last = c.path.length ? c.path[c.path.length - 1] : c.pos;
      if (Math.hypot(last.x - slot.x, last.z - slot.z) < 1e-6) return;
      c.path = this.routeTo(c.pos, slot);
      c.restHeading = this.layout.queueRotationY;
    });
  }

  // ---------------------------------------------------------------- seats

  /** Reserve a free seat for a served customer. A customer never holds more than one seat. */
  private claimSeat(c: Customer): SeatAnchor | null {
    if (c.seatId !== null) return this.seatAnchors.find((s) => s.id === c.seatId) ?? null;
    const free = this.seats.filter((s) => s.reservedBy === null);
    if (free.length === 0) return null;
    const seat = free[this.rng.int(free.length)];
    seat.reservedBy = c.id;
    c.seatId = seat.id;
    return this.seatAnchors.find((s) => s.id === seat.id)!;
  }

  private releaseSeat(c: Customer): void {
    for (const s of this.seats) if (s.reservedBy === c.id) s.reservedBy = null;
    c.seatId = null;
  }

  // ---------------------------------------------------------------- barista & orders

  private updateBarista(dt: number): void {
    const b = this.barista;
    const L = this.layout.barista;
    const arrived = this.moveAlong(b, this.balance.baristaSpeed, dt);

    if (!this.order) {
      this.tryStartOrder();
      if (!this.order && b.state !== 'idle' && b.state !== 'returning') {
        b.state = 'returning';
        b.path = [{ ...L.idle }];
        b.restHeading = L.handoffRotationY;
      } else if (b.state === 'returning' && arrived) {
        b.state = 'idle';
      }
      return;
    }

    const order = this.order;
    switch (b.state) {
      case 'toMachine':
        if (arrived) b.state = 'preparing';
        break;
      case 'preparing':
        order.progress = Math.min(order.duration, order.progress + dt);
        if (order.progress >= order.duration) {
          if (order.discarded) {
            this.discardOrder();
          } else {
            b.state = 'toHandoff';
            b.path = [{ ...L.handoff }];
            b.restHeading = L.handoffRotationY;
          }
        }
        break;
      case 'toHandoff':
        if (order.discarded) this.discardOrder();
        else if (arrived) this.handOff();
        break;
      default:
        break;
    }
  }

  private tryStartOrder(): void {
    const frontId = this.queue[0];
    if (frontId === undefined) return;
    const c = this.customer(frontId)!;
    if (c.state !== 'queuing' || c.path.length > 0) return; // still walking to the counter
    const cost = this.balance.ingredientCostCents;
    if (this.cashCents < cost) {
      if (!this.cannotAffordNotified) this.events.push({ type: 'cannotAfford' });
      this.cannotAffordNotified = true;
      return;
    }
    // Ingredient cost is charged exactly once, when preparation begins.
    this.cashCents -= cost;
    this.ledger.ingredientCostCents += cost;
    this.order = { id: this.nextOrderId++, customerId: c.id, progress: 0, duration: this.prepDurationSec, discarded: false };
    c.state = 'waitingForDrink';
    c.patienceLeft = this.balance.orderPatienceSec;
    const L = this.layout.barista;
    this.barista.state = 'toMachine';
    this.barista.path = [{ ...L.machine }];
    this.barista.restHeading = L.machineRotationY;
    this.events.push({ type: 'orderStarted', customerId: c.id, costCents: cost });
  }

  private discardOrder(): void {
    if (!this.order) return;
    this.ledger.wasted += 1;
    this.events.push({ type: 'wasted', customerId: this.order.customerId });
    this.order = null;
  }

  private handOff(): void {
    const order = this.order!;
    const c = this.customer(order.customerId);
    if (!c || order.discarded || c.paid || c.state !== 'waitingForDrink') {
      this.discardOrder();
      return;
    }
    // Revenue is recorded exactly once, at hand-over.
    c.paid = true;
    c.hasDrink = true;
    this.cashCents += this.priceCents;
    this.ledger.revenueCents += this.priceCents;
    this.ledger.served += 1;
    this.order = null;
    this.events.push({ type: 'served', customerId: c.id, priceCents: this.priceCents });
    this.removeFromQueue(c.id);

    const seat = this.claimSeat(c);
    if (seat) {
      c.state = 'walkingToSeat';
      c.outcome = 'seated';
      c.drinkTimeLeft = this.rng.range(this.balance.drinkDurationSec.min, this.balance.drinkDurationSec.max);
      c.path = [...this.routeTo(c.pos, seat.approach), { ...seat.position }];
      c.restHeading = seat.rotationY;
    } else {
      c.outcome = 'takeaway';
      this.ledger.takeaway += 1;
      this.events.push({ type: 'takeaway', customerId: c.id });
      this.leave(c);
    }
  }

  // ---------------------------------------------------------------- movement

  /** Route on the nav grid; points outside the floor (the street) go via the door. */
  private routeTo(from: Vec2, to: Vec2): Vec2[] {
    const { room, nav, entrance } = this.layout;
    const outside = from.x > room.maxX - nav.agentRadius;
    const start = outside ? entrance.door : from;
    const path = this.nav.findPath(start, to) ?? [{ ...to }];
    return outside ? [{ ...entrance.door }, ...path] : path;
  }

  /** Advance along `path`; returns true while standing at the end of the path. */
  private moveAlong(e: { pos: Vec2; heading: number; path: Vec2[]; restHeading: number | null }, speed: number, dt: number): boolean {
    let budget = speed * dt;
    while (e.path.length > 0 && budget > 0) {
      const t = e.path[0];
      const dx = t.x - e.pos.x;
      const dz = t.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) e.heading = Math.atan2(dx, dz);
      if (d <= budget) {
        e.pos.x = t.x;
        e.pos.z = t.z;
        budget -= d;
        e.path.shift();
      } else {
        e.pos.x += (dx / d) * budget;
        e.pos.z += (dz / d) * budget;
        budget = 0;
      }
    }
    if (e.path.length === 0) {
      if (e.restHeading !== null) e.heading = e.restHeading;
      return true;
    }
    return false;
  }
}
