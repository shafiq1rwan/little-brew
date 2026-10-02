import { formatCents } from '../config/balance';
import type { Layout } from '../config/layout';
import type { SceneView } from '../render/sceneView';
import type { CafeSimulation } from '../sim/simulation';
import type { SimEvent } from '../sim/types';

const CUP_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="#493426" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" fill="#b76d49" stroke="#493426"/>' +
  '<path d="M11 7h1a1.5 1.5 0 0 1 0 3h-1"/><path d="M6 1.5c-.6.8.6 1.4 0 2.4M8.5 1.5c-.6.8.6 1.4 0 2.4"/></svg>';

/**
 * Screen-space indicators that follow world objects: order bubbles with a patience ring over
 * queued customers, the barista's preparation bar, and floating "+$3.00" / "Left" texts.
 */
export class WorldOverlay {
  private readonly bubbles = new Map<number, HTMLDivElement>();
  private readonly prep: HTMLDivElement;
  private readonly prepFill: HTMLDivElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly view: SceneView,
    private readonly layout: Layout,
  ) {
    this.prep = document.createElement('div');
    this.prep.className = 'prep-bar';
    this.prepFill = document.createElement('div');
    this.prep.appendChild(this.prepFill);
    this.prep.hidden = true;
    root.appendChild(this.prep);
  }

  handleEvent(e: SimEvent, sim: CafeSimulation): void {
    const at = (id: number) => sim.customer(id)?.pos;
    if (e.type === 'served') {
      const p = at(e.customerId);
      if (p) this.float(p.x, p.z, `+${formatCents(e.priceCents)}`, 'money');
    } else if (e.type === 'abandoned') {
      const p = at(e.customerId);
      if (p) this.float(p.x, p.z, 'Gave up', 'lost');
    } else if (e.type === 'wasted') {
      const m = this.layout.espressoMachine.position;
      this.float(m.x, m.z, 'Drink wasted', 'lost', this.layout.espressoMachine.indicatorHeight);
    }
  }

  private float(x: number, z: number, text: string, kind: string, h = this.layout.customerIndicatorHeight): void {
    const s = this.view.worldToScreen(x, h, z);
    const el = document.createElement('div');
    el.className = `float-text ${kind}`;
    el.textContent = text;
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y}px`;
    this.root.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  update(sim: CafeSimulation): void {
    const h = this.layout.customerIndicatorHeight;
    const seen = new Set<number>();
    for (const c of sim.customers) {
      if (c.state !== 'queuing' && c.state !== 'waitingForDrink') continue;
      seen.add(c.id);
      let el = this.bubbles.get(c.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'order-bubble';
        el.innerHTML = CUP_SVG;
        this.root.appendChild(el);
        this.bubbles.set(c.id, el);
      }
      const p = Math.max(0, c.patienceLeft / (c.state === 'waitingForDrink' ? sim.balance.orderPatienceSec : c.patienceMax));
      el.style.setProperty('--p', p.toFixed(3));
      el.style.setProperty('--ring', p > 0.5 ? '#697955' : p > 0.25 ? '#c79a4a' : '#b76d49');
      el.classList.toggle('active', c.state === 'waitingForDrink');
      const s = this.view.worldToScreen(c.pos.x, h, c.pos.z);
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    }
    for (const [id, el] of this.bubbles) {
      if (seen.has(id)) continue;
      el.remove();
      this.bubbles.delete(id);
    }

    const o = sim.order;
    this.prep.hidden = !o || o.progress <= 0;
    if (o) {
      const m = this.layout.espressoMachine;
      const s = this.view.worldToScreen(m.position.x, m.indicatorHeight, m.position.z);
      this.prep.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      this.prepFill.style.width = `${(o.progress / o.duration) * 100}%`;
      this.prep.classList.toggle('wasted', o.discarded);
    }
  }
}
