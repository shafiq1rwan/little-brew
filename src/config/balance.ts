/**
 * All gameplay balancing values. Money is always integer cents; time is simulation seconds
 * (1x speed = real seconds); distance is meters.
 *
 * Starter-value rationale (measured with the headless simulation; see README "Balancing"):
 * - At the default $3.00 a customer arrives about every 6.5 s (~27 per 3-minute day), more than
 *   the base machine can serve (10 s prep + barista walking ≈ 18 coffees/day). Expect ~$37 profit
 *   and a few customers walking out of a long queue — a visible nudge to raise the price or upgrade.
 * - Demand is fairly price-sensitive (elasticity 2.2): ~$3.50 is the best base-machine price
 *   (~$46/day); $5+ empties the café.
 * - The $140 upgrade halves preparation time (~30 coffees/day). It is affordable after about three
 *   days; afterwards the best price drops to ~$3.00 for ~$57/day.
 * - Queue patience of 40 s tolerates ~3 people ahead; once ordered, customers wait up to 25 s
 *   (normal service takes ~12 s), so drinks are rarely wasted.
 */
export interface BalanceConfig {
  startingCashCents: number;
  price: { defaultCents: number; minCents: number; maxCents: number; stepCents: number };
  ingredientCostCents: number;
  arrivals: {
    /** Mean seconds between arrivals at the reference price. */
    baseIntervalSec: number;
    /** Price at which the base interval applies. */
    referencePriceCents: number;
    /** interval = base * (price / reference) ^ elasticity. Higher = more price-sensitive. */
    elasticity: number;
    /** Each interval is randomized by ±jitter (fraction). */
    jitter: number;
    minIntervalSec: number;
    maxIntervalSec: number;
    /** Delay before the first customer after opening. */
    firstArrivalSec: number;
  };
  prepDurationSec: number;
  /** Seconds a customer will wait in the queue (from entering) before their order is started. */
  patienceSec: number;
  /** Once their order has started, seconds they will wait for it to be handed over. */
  orderPatienceSec: number;
  drinkDurationSec: { min: number; max: number };
  customerSpeed: number;
  baristaSpeed: number;
  /** Hard cap on customers inside the café at once (any state). */
  maxCustomers: number;
  dayLengthSec: number;
  upgrade: {
    name: string;
    priceCents: number;
    /** Preparation duration is multiplied by this once purchased. */
    prepMultiplier: number;
  };
  /** Fixed simulation step. */
  stepSec: number;
}

export const BALANCE: BalanceConfig = {
  startingCashCents: 40_00,
  price: { defaultCents: 3_00, minCents: 1_50, maxCents: 6_00, stepCents: 25 },
  ingredientCostCents: 90,
  arrivals: {
    baseIntervalSec: 6.5,
    referencePriceCents: 3_00,
    elasticity: 2.2,
    jitter: 0.35,
    minIntervalSec: 3,
    maxIntervalSec: 45,
    firstArrivalSec: 2,
  },
  prepDurationSec: 10,
  patienceSec: 40,
  orderPatienceSec: 25,
  drinkDurationSec: { min: 12, max: 20 },
  customerSpeed: 1.3,
  baristaSpeed: 1.6,
  maxCustomers: 10,
  dayLengthSec: 180,
  upgrade: {
    name: 'Dual-boiler espresso machine',
    priceCents: 140_00,
    prepMultiplier: 0.5,
  },
  stepSec: 1 / 60,
};

/** Mean seconds between arrivals for a given price (before jitter). */
export function arrivalIntervalSec(priceCents: number, b: BalanceConfig = BALANCE): number {
  const a = b.arrivals;
  const raw = a.baseIntervalSec * Math.pow(priceCents / a.referencePriceCents, a.elasticity);
  return Math.min(a.maxIntervalSec, Math.max(a.minIntervalSec, raw));
}

/** Clamp and snap a price to the configured range and step. */
export function clampPrice(priceCents: number, b: BalanceConfig = BALANCE): number {
  const { minCents, maxCents, stepCents } = b.price;
  const snapped = Math.round(priceCents / stepCents) * stepCents;
  return Math.min(maxCents, Math.max(minCents, snapped));
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
