import { BALANCE, type BalanceConfig } from '../src/config/balance';
import { CafeSimulation, defaultProgress, type SimOptions } from '../src/sim/simulation';
import type { Progress, SimEvent } from '../src/sim/types';

export const STEP = BALANCE.stepSec;

export type BalanceOverrides = Omit<Partial<BalanceConfig>, 'arrivals'> & { arrivals?: Partial<BalanceConfig['arrivals']> };

export function balanceWith(overrides: BalanceOverrides = {}): BalanceConfig {
  return { ...BALANCE, ...overrides, arrivals: { ...BALANCE.arrivals, ...(overrides.arrivals ?? {}) } };
}

/** Balance where nobody arrives on their own; tests spawn customers explicitly. */
export const NO_ARRIVALS: BalanceOverrides = { arrivals: { firstArrivalSec: 1e9, minIntervalSec: 1e9, maxIntervalSec: 1e9 } };

export function makeSim(opts: Omit<SimOptions, 'progress'> & { progress?: Partial<Progress> } = {}): CafeSimulation {
  const balance = opts.balance ?? BALANCE;
  return new CafeSimulation({
    seed: 42,
    ...opts,
    balance,
    progress: { ...defaultProgress(balance), ...(opts.progress ?? {}) },
  });
}

/** Steps until `pred` is true; throws if it takes longer than maxSec. Collects events. */
export function runUntil(sim: CafeSimulation, pred: () => boolean, maxSec = 600, events: SimEvent[] = []): SimEvent[] {
  const maxSteps = Math.ceil(maxSec / STEP);
  for (let i = 0; i < maxSteps; i++) {
    if (pred()) return events;
    sim.step(STEP);
    events.push(...sim.drainEvents());
    checkInvariants(sim);
  }
  if (pred()) return events;
  throw new Error(`condition not reached within ${maxSec}s (phase=${sim.phase})`);
}

export function runFor(sim: CafeSimulation, sec: number, events: SimEvent[] = []): SimEvent[] {
  const steps = Math.round(sec / STEP);
  for (let i = 0; i < steps; i++) {
    sim.step(STEP);
    events.push(...sim.drainEvents());
    checkInvariants(sim);
  }
  return events;
}

/** Structural invariants that must hold after every step. */
export function checkInvariants(sim: CafeSimulation): void {
  const fail = (msg: string) => {
    throw new Error(`invariant: ${msg}`);
  };
  if (!Number.isInteger(sim.cashCents) || sim.cashCents < 0) fail(`cash ${sim.cashCents}`);
  const ids = new Set(sim.customers.map((c) => c.id));
  if (ids.size !== sim.customers.length) fail('duplicate customer ids');
  if (new Set(sim.queue).size !== sim.queue.length) fail('duplicate queue entry');
  if (sim.queue.length > sim.layout.queueSlots.length) fail('queue overflow');
  for (const id of sim.queue) {
    const c = sim.customer(id);
    if (!c) fail(`queue has missing customer ${id}`);
    else if (!['entering', 'queuing', 'waitingForDrink'].includes(c.state)) fail(`queued customer in state ${c.state}`);
  }
  const holders = sim.seats.filter((s) => s.reservedBy !== null).map((s) => s.reservedBy!);
  if (new Set(holders).size !== holders.length) fail('customer holds more than one seat');
  for (const s of sim.seats) {
    if (s.reservedBy === null) continue;
    const c = sim.customer(s.reservedBy);
    if (!c) fail(`seat ${s.id} held by departed customer`);
    else if (c.seatId !== s.id) fail(`seat ${s.id} / customer ${c.id} mismatch`);
  }
  if (sim.customers.length > sim.balance.maxCustomers) fail('too many customers');
  const waiting = sim.customers.filter((c) => c.state === 'waitingForDrink');
  if (waiting.length > 1) fail('more than one customer waiting at the counter');
  if (sim.order && !sim.order.discarded && waiting[0]?.id !== sim.order.customerId) fail('order owner mismatch');
}
