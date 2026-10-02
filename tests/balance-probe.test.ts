/**
 * Balancing aid, skipped by `npm test`. Run with `npm run probe` to print average daily results
 * per price for the current BALANCE (or override: PROBE="baseInterval,elasticity,prepMult,prepSec;...").
 */
import { it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { balanceWith, makeSim, runUntil } from './helpers';

const current = `${BALANCE.arrivals.baseIntervalSec},${BALANCE.arrivals.elasticity},${BALANCE.upgrade.prepMultiplier},${BALANCE.prepDurationSec}`;
const cfgs = (process.env.PROBE ?? current).split(';').map((s) => s.split(',').map(Number));

it.skipIf(import.meta.env.MODE !== 'probe')('balance probe', () => {
  for (const [base, e, mult, prep] of cfgs) {
    console.log(`== baseInterval ${base}s, elasticity ${e}, upgrade x${mult}, prep ${prep}s`);
    const balance = balanceWith({
      prepDurationSec: prep,
      arrivals: { baseIntervalSec: base, elasticity: e },
      upgrade: { ...BALANCE.upgrade, prepMultiplier: mult },
    });
    for (const upgraded of [false, true]) {
      const row: string[] = [];
      for (const price of [200, 250, 300, 350, 400, 450, 500, 600]) {
        let served = 0, lost = 0, profit = 0;
        const N = 4;
        for (let s = 0; s < N; s++) {
          const sim = makeSim({ balance, seed: s + 1, progress: { priceCents: price, upgraded } });
          sim.open();
          runUntil(sim, () => sim.phase === 'results', BALANCE.dayLengthSec + 400);
          const r = sim.lastReport!;
          served += r.served; lost += r.lost; profit += r.profitCents;
        }
        row.push(`$${(price / 100).toFixed(2)}: ${(served / N).toFixed(0)} served/${(lost / N).toFixed(0)} lost, $${(profit / N / 100).toFixed(0)}`);
      }
      console.log(`${upgraded ? 'upgraded' : 'base    '} ` + row.join(' | '));
    }
  }
});
