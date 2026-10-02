import type { Vec2 } from '../config/layout';

export type DayPhase = 'preparing' | 'open' | 'closing' | 'results';

export type CustomerState =
  /** Walking from the entrance to their queue slot. */
  | 'entering'
  /** In the queue (standing, or shuffling forward to a new slot). */
  | 'queuing'
  /** At the counter; the barista is preparing their order. */
  | 'waitingForDrink'
  /** Paid, holding a drink, walking to their reserved seat. */
  | 'walkingToSeat'
  /** Seated with a drink. */
  | 'drinking'
  /** Walking to the exit (after drinking, as takeaway, or after abandoning). */
  | 'leaving';

export type CustomerOutcome = 'pending' | 'seated' | 'takeaway' | 'abandoned';

export interface Customer {
  /** Stable for the customer's lifetime; never reused within a simulation. */
  readonly id: number;
  /** Visual variety hint (index into the character roster). */
  readonly variant: number;
  state: CustomerState;
  outcome: CustomerOutcome;
  pos: Vec2;
  /** Yaw in radians; 0 faces +Z. */
  heading: number;
  /** Remaining waypoints. Empty = standing still. */
  path: Vec2[];
  /** Heading to adopt once the path ends (e.g. face the counter or the table). */
  restHeading: number | null;
  patienceLeft: number;
  readonly patienceMax: number;
  seatId: number | null;
  drinkTimeLeft: number;
  hasDrink: boolean;
  paid: boolean;
}

export type BaristaState = 'idle' | 'toMachine' | 'preparing' | 'toHandoff' | 'returning';

export interface Barista {
  state: BaristaState;
  pos: Vec2;
  heading: number;
  path: Vec2[];
  restHeading: number | null;
}

export interface Order {
  readonly id: number;
  readonly customerId: number;
  /** Seconds of preparation completed / required. */
  progress: number;
  readonly duration: number;
  /** Set when the customer left before hand-off; the drink is finished and thrown away. */
  discarded: boolean;
}

export interface Seat {
  readonly id: number;
  /** Customer holding this seat (reserved while walking, occupied while drinking), or null. */
  reservedBy: number | null;
}

export interface DayLedger {
  revenueCents: number;
  ingredientCostCents: number;
  served: number;
  lost: number;
  wasted: number;
  takeaway: number;
}

/** Progression that survives between days (and in the save file). */
export interface Progress {
  day: number;
  cashCents: number;
  upgraded: boolean;
  priceCents: number;
}

export interface DayReport extends DayLedger {
  day: number;
  profitCents: number;
  cashCents: number;
  /** True when the café cannot afford another coffee: offer a restart. */
  bankrupt: boolean;
}

export type SimEvent =
  | { type: 'arrived'; customerId: number }
  | { type: 'orderStarted'; customerId: number; costCents: number }
  | { type: 'served'; customerId: number; priceCents: number }
  | { type: 'abandoned'; customerId: number }
  | { type: 'wasted'; customerId: number }
  | { type: 'seated'; customerId: number; seatId: number }
  | { type: 'takeaway'; customerId: number }
  | { type: 'departed'; customerId: number }
  | { type: 'cannotAfford' }
  | { type: 'outOfCash' }
  | { type: 'closing'; reason: 'time' | 'player' | 'outOfCash' }
  | { type: 'dayEnded'; report: DayReport };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}
