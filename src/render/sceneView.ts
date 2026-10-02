import * as THREE from 'three';
import type { Layout, SeatAnchor } from '../config/layout';
import type { CafeSimulation } from '../sim/simulation';
import type { SimEvent } from '../sim/types';
import { PALETTE } from '../visuals/palette';
import type { CharacterVisual, VisualFactories } from '../visuals/types';
import { IsoCamera, type ViewInsets } from './isoCamera';

/** Heading smoothing (rad/s of simulation time). Presentation only. */
const TURN_RATE = 10;
const SERVE_POSE_SEC = 0.6;

function approachAngle(current: number, target: number, maxStep: number): number {
  let d = target - current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
}

/**
 * Renders the café from simulation state. Reads the simulation, never writes to it.
 * Static furniture is built once from layout data; characters are created/removed by stable id.
 */
export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly iso: IsoCamera;
  private readonly customers = new Map<number, CharacterVisual>();
  private readonly headings = new Map<number, number>();
  private readonly barista: CharacterVisual;
  private baristaHeading = 0;
  private servePoseLeft = 0;
  private readonly seats: Map<number, SeatAnchor>;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly layout: Layout,
    private readonly visuals: VisualFactories,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(PALETTE.background);
    this.iso = new IsoCamera(layout);
    this.seats = new Map(layout.tables.flatMap((t) => t.seats).map((s) => [s.id, s]));
    this.addLights();
    this.buildStatic();
    this.barista = visuals.createBarista();
    this.scene.add(this.barista.root);
  }

  /** LIGHTING (Codex: polish here). */
  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0xb89a7a, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.9);
    sun.position.set(6, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -9;
    c.right = 9;
    c.top = 9;
    c.bottom = -9;
    c.near = 0.5;
    c.far = 30;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
  }

  private buildStatic(): void {
    const L = this.layout;
    const v = this.visuals;
    this.scene.add(v.createRoom(L));

    const place = (g: THREE.Object3D, x: number, y: number, z: number, rotY: number) => {
      g.position.set(x, y, z);
      g.rotation.y = rotY;
      this.scene.add(g);
    };
    // Counters' long side runs along world Z; their front (local +Z) faces world +X.
    for (const [rect, kind] of [
      [L.counter, 'service'],
      [L.backCounter, 'back'],
    ] as const) {
      place(v.createCounter({ width: rect.sz, depth: rect.sx, height: rect.height }, kind), rect.x, 0, rect.z, Math.PI / 2);
    }
    const m = L.espressoMachine;
    place(v.createEspressoMachine(), m.position.x, L.backCounter.height, m.position.z, m.rotationY);
    for (const t of L.tables) {
      place(v.createTable(t), t.center.x, 0, t.center.z, 0);
      for (const s of t.seats) place(v.createChair(s), s.position.x, 0, s.position.z, s.rotationY);
    }
  }

  resize(width: number, height: number, insets: ViewInsets): void {
    this.renderer.setSize(width, height, false);
    this.iso.resize(width, height, insets);
  }

  handleEvent(e: SimEvent): void {
    if (e.type === 'served') this.servePoseLeft = SERVE_POSE_SEC;
  }

  /** Sync visuals to simulation state. `dt` is simulation seconds since the last sync. */
  sync(sim: CafeSimulation, dt: number): void {
    const alive = new Set<number>();
    for (const c of sim.customers) {
      alive.add(c.id);
      let vis = this.customers.get(c.id);
      if (!vis) {
        vis = this.visuals.createCustomer(c.variant % this.visuals.customerVariantCount);
        this.customers.set(c.id, vis);
        this.headings.set(c.id, c.heading);
        this.scene.add(vis.root);
      }
      const seat = c.state === 'drinking' && c.seatId !== null ? this.seats.get(c.seatId) : undefined;
      let heading = approachAngle(this.headings.get(c.id)!, c.heading, TURN_RATE * dt);
      if (seat) {
        vis.root.position.set(seat.position.x, 0, seat.position.z);
        heading = seat.rotationY;
        vis.setAction('sit', { seatHeight: seat.sitHeight });
      } else {
        vis.root.position.set(c.pos.x, 0, c.pos.z);
        vis.setAction(c.path.length > 0 ? 'walk' : 'idle');
      }
      this.headings.set(c.id, heading);
      vis.root.rotation.y = heading;
      vis.setHolding(c.hasDrink);
      vis.update(dt);
    }
    for (const [id, vis] of this.customers) {
      if (alive.has(id)) continue;
      vis.dispose();
      this.customers.delete(id);
      this.headings.delete(id);
    }

    const b = sim.barista;
    this.servePoseLeft = Math.max(0, this.servePoseLeft - dt);
    this.baristaHeading = approachAngle(this.baristaHeading, b.heading, TURN_RATE * dt);
    this.barista.root.position.set(b.pos.x, 0, b.pos.z);
    this.barista.root.rotation.y = this.baristaHeading;
    const walking = b.path.length > 0;
    this.barista.setAction(
      walking ? 'walk' : b.state === 'preparing' ? 'work' : this.servePoseLeft > 0 ? 'serve' : 'idle',
    );
    this.barista.setHolding(b.state === 'toHandoff' && sim.order !== null && !sim.order.discarded);
    this.barista.update(dt);
  }

  render(): void {
    this.renderer.render(this.scene, this.iso.camera);
  }

  private readonly tmp = new THREE.Vector3();
  /** World point → CSS pixels relative to the canvas. */
  worldToScreen(x: number, y: number, z: number): { x: number; y: number } {
    const canvas = this.renderer.domElement;
    this.tmp.set(x, y, z).project(this.iso.camera);
    return {
      x: ((this.tmp.x + 1) / 2) * canvas.clientWidth,
      y: ((1 - this.tmp.y) / 2) * canvas.clientHeight,
    };
  }
}
