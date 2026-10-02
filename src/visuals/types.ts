import type * as THREE from 'three';
import type { Layout, SeatAnchor, TableLayout } from '../config/layout';

/**
 * Visual contract between gameplay (Claude) and art (Codex). See docs/visual-handoff.md.
 *
 * - 1 unit = 1 m, Y up, floor at Y = 0.
 * - Furniture factories return a THREE.Group whose origin is at floor level, centered on the
 *   footprint, with its "front" facing local +Z. The scene positions and rotates it from layout data.
 * - Character roots have their origin at the feet and face local +Z. The scene drives position
 *   and yaw from the simulation every frame; the visual must not move its own root.
 */

/** Semantic character actions. Visuals map these to clips; missing clips fall back to idle/static. */
export type CharacterAction =
  /** Standing still (queueing, waiting, barista idle). */
  | 'idle'
  /** Moving along a path. */
  | 'walk'
  /** Seated at a chair (root is at the chair footprint center, floor level). */
  | 'sit'
  /** Barista working the espresso machine. */
  | 'work'
  /** Barista handing over a drink. */
  | 'serve';

export interface ActionOptions {
  /** For 'sit': seat surface height above the floor. */
  seatHeight?: number;
}

export interface CharacterVisual {
  /** Positioned/rotated by the scene. Add meshes as children. */
  readonly root: THREE.Group;
  /** Advance animation by `dt` simulation seconds (0 while paused; scaled by game speed). */
  update(dt: number): void;
  /** Idempotent: calling with the current action must not restart it. */
  setAction(action: CharacterAction, opts?: ActionOptions): void;
  /** Show/hide a coffee cup in the character's hand. */
  setHolding(holding: boolean): void;
  dispose(): void;
}

export interface VisualFactories {
  /** Floor slab, back walls, entrance marker and any static decor. Placed at world origin. */
  createRoom(layout: Layout): THREE.Group;
  /**
   * Service counter: `width` along local X, `depth` along local Z, customer side facing local +Z.
   * Also used for the back counter.
   */
  createCounter(size: { width: number; depth: number; height: number }, kind: 'service' | 'back'): THREE.Group;
  /** Front (barista side controls) faces local +Z. Origin at its base; placed on the back counter. */
  createEspressoMachine(): THREE.Group;
  createTable(table: TableLayout): THREE.Group;
  /** A seated character faces local +Z; backrest toward local -Z. */
  createChair(seat: SeatAnchor): THREE.Group;
  /** `variant` is a stable per-customer integer in [0, customerVariantCount). */
  createCustomer(variant: number): CharacterVisual;
  createBarista(): CharacterVisual;
  /** Number of distinct customer looks available. */
  readonly customerVariantCount: number;
  /** Human-readable source, shown in the console/debug ("kenney" | "placeholder"). */
  readonly characterSource: string;
}
