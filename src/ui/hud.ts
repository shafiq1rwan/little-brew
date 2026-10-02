import { arrivalIntervalSec, formatCents } from '../config/balance';
import type { Speed } from '../sim/clock';
import type { CafeSimulation } from '../sim/simulation';
import type { DayPhase, DayReport, SimEvent } from '../sim/types';

export interface HudActions {
  open(): void;
  close(): void;
  togglePause(): void;
  setSpeed(speed: 1 | 2 | 3): void;
  changePrice(deltaSteps: number): void;
  buyUpgrade(): void;
  nextDay(): void;
  restart(): void;
  resetSave(): void;
  zoom(factor: number): void;
}

const PHASE_LABEL: Record<DayPhase, string> = {
  preparing: 'Before opening',
  open: 'Open',
  closing: 'Closing',
  results: 'Day report',
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

function fmtTime(sec: number): string {
  const s = Math.ceil(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** DOM HUD. Reads simulation state every frame and forwards button presses to HudActions. */
export class Hud {
  private readonly el = {
    day: $('day-label'),
    phase: $('phase-label'),
    time: $('time-label'),
    timeFill: $('time-fill'),
    cash: $('cash'),
    cashChip: document.querySelector('.chip-cash') as HTMLElement,
    served: $('served'),
    waiting: $('waiting'),
    plan: $('plan-panel'),
    priceValue: $('price-value'),
    priceHint: $('price-hint'),
    priceDown: $<HTMLButtonElement>('price-down'),
    priceUp: $<HTMLButtonElement>('price-up'),
    upgradeName: $('upgrade-name'),
    upgradeEffect: $('upgrade-effect'),
    upgradeBadge: $('upgrade-badge'),
    upgradeBtn: $<HTMLButtonElement>('upgrade-btn'),
    goal: $('goal'),
    goalFill: $('goal-fill'),
    goalLabel: $('goal-label'),
    bankruptNote: $('bankrupt-note'),
    openBtn: $<HTMLButtonElement>('open-btn'),
    pauseBtn: $<HTMLButtonElement>('pause-btn'),
    speedBtns: [...document.querySelectorAll<HTMLButtonElement>('[data-speed]')],
    pausedBanner: $('paused-banner'),
    results: $('results'),
    nextDayBtn: $<HTMLButtonElement>('next-day-btn'),
    restartBtn: $<HTMLButtonElement>('restart-btn'),
    toasts: $('toasts'),
  };
  private lastCash = -1;
  private lastKey = '';
  private shownReport: DayReport | null = null;

  constructor(
    private readonly sim: () => CafeSimulation,
    actions: HudActions,
  ) {
    const e = this.el;
    e.openBtn.addEventListener('click', () => (this.sim().phase === 'open' ? actions.close() : actions.open()));
    e.pauseBtn.addEventListener('click', () => actions.togglePause());
    for (const b of e.speedBtns) b.addEventListener('click', () => actions.setSpeed(Number(b.dataset.speed) as 1 | 2 | 3));
    e.priceDown.addEventListener('click', () => actions.changePrice(-1));
    e.priceUp.addEventListener('click', () => actions.changePrice(1));
    e.upgradeBtn.addEventListener('click', () => actions.buyUpgrade());
    e.nextDayBtn.addEventListener('click', () => actions.nextDay());
    e.restartBtn.addEventListener('click', () => actions.restart());
    $('bankrupt-restart').addEventListener('click', () => actions.restart());
    $('reset-btn').addEventListener('click', () => actions.resetSave());
    $('zoom-in').addEventListener('click', () => actions.zoom(1.25));
    $('zoom-out').addEventListener('click', () => actions.zoom(0.8));
    window.addEventListener('keydown', (ev) => {
      if (ev.target instanceof HTMLInputElement) return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        actions.togglePause();
      } else if (ev.key === '1' || ev.key === '2' || ev.key === '3') {
        actions.setSpeed(Number(ev.key) as 1 | 2 | 3);
      }
    });
  }

  /** Pixels covered by the top HUD and bottom toolbar, for camera framing. */
  insets(): { top: number; bottom: number } {
    const top = document.querySelector('.hud-top')!.getBoundingClientRect();
    const bar = document.querySelector('.toolbar')!.getBoundingClientRect();
    let bottomEdge = bar.top;
    // On narrow screens the plan panel docks above the toolbar: frame the room above it too.
    if (!this.el.plan.hidden) {
      const plan = this.el.plan.getBoundingClientRect();
      if (plan.top > window.innerHeight / 2) bottomEdge = Math.min(bottomEdge, plan.top);
    }
    return { top: top.bottom + 4, bottom: Math.max(0, window.innerHeight - bottomEdge + 4) };
  }

  toast(text: string, kind: 'info' | 'good' | 'warn' = 'info', ms = 2600): void {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild!.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 350);
  }

  handleEvent(e: SimEvent): void {
    switch (e.type) {
      case 'closing':
        if (e.reason === 'time') this.toast('Closing time — finishing up with the last customers');
        else if (e.reason === 'player') this.toast('Closing early — no new customers');
        break;
      case 'outOfCash':
        this.toast('Out of cash for ingredients — closing the café', 'warn', 4000);
        break;
      case 'cannotAfford':
        this.toast('Not enough cash for ingredients', 'warn');
        break;
      default:
        break;
    }
  }

  update(sim: CafeSimulation, speed: Speed): void {
    const e = this.el;
    const b = sim.balance;
    const phase = sim.phase;

    e.day.textContent = `Day ${sim.day}`;
    e.phase.textContent = phase === 'open' && speed === 0 ? 'Paused' : PHASE_LABEL[phase];
    e.phase.className = `phase phase-${phase}`;
    const remaining = phase === 'preparing' ? b.dayLengthSec : sim.timeRemainingSec;
    e.time.textContent = phase === 'closing' ? 'Last orders' : phase === 'results' ? 'Closed' : fmtTime(remaining);
    e.timeFill.style.width = `${(remaining / b.dayLengthSec) * 100}%`;

    if (sim.cashCents !== this.lastCash) {
      if (this.lastCash >= 0 && sim.cashCents > this.lastCash) {
        e.cashChip.classList.remove('bump');
        void e.cashChip.offsetWidth;
        e.cashChip.classList.add('bump');
      }
      this.lastCash = sim.cashCents;
      e.cash.textContent = formatCents(sim.cashCents);
    }
    e.served.textContent = String(sim.ledger.served);
    e.waiting.textContent = String(sim.waitingCount);

    // Toolbar
    const busy = phase === 'open' || phase === 'closing';
    e.openBtn.textContent = phase === 'open' ? 'Close early' : phase === 'closing' ? 'Closing…' : 'Open café';
    e.openBtn.className = `btn wide ${phase === 'open' ? 'warn' : 'primary'}`;
    e.openBtn.disabled = phase === 'closing' || phase === 'results' || (phase === 'preparing' && sim.isBankrupt);
    e.openBtn.title = phase === 'preparing' && sim.isBankrupt ? 'Not enough cash for ingredients' : '';
    e.pauseBtn.disabled = !busy;
    e.pauseBtn.textContent = speed === 0 ? 'Resume' : 'Pause';
    e.pauseBtn.setAttribute('aria-pressed', String(speed === 0));
    for (const btn of e.speedBtns) btn.setAttribute('aria-pressed', String(Number(btn.dataset.speed) === speed));
    e.pausedBanner.hidden = !(busy && speed === 0);

    // Plan panel (only before opening)
    e.plan.hidden = phase !== 'preparing';
    if (phase === 'preparing') this.updatePlan(sim);

    // Results
    const showResults = phase === 'results' && sim.lastReport !== null;
    e.results.hidden = !showResults;
    if (showResults && this.shownReport !== sim.lastReport) this.showReport(sim, sim.lastReport!);
  }

  private updatePlan(sim: CafeSimulation): void {
    const e = this.el;
    const b = sim.balance;
    const key = `${sim.priceCents}|${sim.cashCents}|${sim.upgraded}|${sim.day}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    e.priceValue.textContent = formatCents(sim.priceCents);
    e.priceDown.disabled = sim.priceCents <= b.price.minCents;
    e.priceUp.disabled = sim.priceCents >= b.price.maxCents;
    const visitors = Math.round(b.dayLengthSec / arrivalIntervalSec(sim.priceCents, b));
    const demand = visitors >= 30 ? 'very busy' : visitors >= 22 ? 'busy' : visitors >= 14 ? 'steady' : 'quiet';
    e.priceHint.innerHTML = `Margin <b>${formatCents(sim.priceCents - b.ingredientCostCents)}</b> per cup ` +
      `(ingredients ${formatCents(b.ingredientCostCents)}).<br>Expect <b>~${visitors} visitors</b> — ${demand}.`;

    const u = b.upgrade;
    const prepBase = b.prepDurationSec;
    e.upgradeName.textContent = u.name;
    e.upgradeEffect.textContent = `Brew time ${prepBase}s → ${+(prepBase * u.prepMultiplier).toFixed(1)}s`;
    e.upgradeBadge.hidden = !sim.upgraded;
    e.upgradeBtn.hidden = sim.upgraded;
    e.goal.hidden = sim.upgraded;
    const check = sim.canBuyUpgrade();
    e.upgradeBtn.disabled = !check.ok;
    e.upgradeBtn.className = `btn ${check.ok ? 'primary' : ''}`;
    e.upgradeBtn.textContent = `Buy for ${formatCents(u.priceCents)}`;
    const needed = u.priceCents + b.ingredientCostCents;
    e.goalFill.style.width = `${Math.min(100, (sim.cashCents / needed) * 100)}%`;
    e.goalLabel.textContent = check.ok
      ? 'Goal reached — you can afford the upgrade!'
      : `Goal: save ${formatCents(needed)} (${formatCents(Math.max(0, needed - sim.cashCents))} to go)`;
    e.bankruptNote.hidden = !sim.isBankrupt;
  }

  private showReport(sim: CafeSimulation, r: DayReport): void {
    this.shownReport = r;
    const set = (id: string, v: string) => ($(id).textContent = v);
    set('results-title', `Day ${r.day} report`);
    set('results-subtitle', r.bankrupt ? 'The café ran out of money for ingredients.' : 'The café is closed and empty.');
    set('r-revenue', formatCents(r.revenueCents));
    set('r-costs', `−${formatCents(r.ingredientCostCents)}`);
    set('r-profit', formatCents(r.profitCents));
    $('r-profit').classList.toggle('loss', r.profitCents < 0);
    set('r-served', String(r.served));
    set('r-lost', String(r.lost));
    set('r-wasted', String(r.wasted));
    set('r-takeaway', String(r.takeaway));
    set('r-cash', formatCents(r.cashCents));

    const u = sim.balance.upgrade;
    let tip = '';
    if (r.bankrupt) tip = 'Without cash for ingredients the café cannot continue.';
    else if (!sim.upgraded && sim.cashCents >= u.priceCents + sim.balance.ingredientCostCents)
      tip = `You can now afford the ${u.name.toLowerCase()}. Buy it before opening tomorrow!`;
    else if (r.lost >= 3) tip = 'Several customers gave up waiting. Try a higher price or a faster machine.';
    else if (r.served > 0 && r.lost === 0 && sim.priceCents < sim.balance.price.maxCents)
      tip = 'Nobody gave up waiting — you might be able to charge a little more.';
    set('results-tip', tip);

    this.el.nextDayBtn.hidden = r.bankrupt;
    this.el.restartBtn.hidden = !r.bankrupt;
    this.el.nextDayBtn.textContent = `Start day ${r.day + 1}`;
    (r.bankrupt ? this.el.restartBtn : this.el.nextDayBtn).focus();
  }

  /** Force the plan panel to re-render on next update. */
  invalidate(): void {
    this.lastKey = '';
  }
}
