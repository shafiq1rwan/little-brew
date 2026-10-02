import * as THREE from 'three';
import type { Layout, SeatAnchor, TableLayout } from '../config/layout';
import { PALETTE } from './palette';

/**
 * PLACEHOLDER furniture (Codex replaces). Simple boxes/cylinders that respect the layout
 * footprints and the origin/facing conventions in ./types.ts.
 */

const materials = new Map<number, THREE.MeshStandardMaterial>();
export function mat(color: number): THREE.MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true });
    materials.set(color, m);
  }
  return m;
}

export function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(r: number, h: number, color: number, x = 0, y = 0, z = 0, sides = 8): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, sides), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function createRoom(layout: Layout): THREE.Group {
  const g = new THREE.Group();
  g.name = 'room';
  const { minX, maxX, minZ, maxZ, wallHeight: H, wallThickness: T } = layout.room;
  const W = maxX - minX;
  const D = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  // Floor slab: top at y = 0, with a darker base.
  const floor = box(W, 0.12, D, PALETTE.floor, cx, -0.06, cz);
  floor.castShadow = false;
  g.add(floor);
  const base = box(W + T, 0.22, D + T, PALETTE.floorEdge, cx - T / 2, -0.23, cz - T / 2);
  base.castShadow = false;
  g.add(base);
  // Plank seams (along X).
  for (let z = minZ + 0.45; z < maxZ; z += 0.45) {
    const seam = box(W, 0.004, 0.02, PALETTE.woodLight, cx, 0.002, z);
    seam.castShadow = false;
    g.add(seam);
  }

  // Back-left wall (x = minX) and back-right wall (z = minZ).
  g.add(box(T, H, D + T, PALETTE.wall, minX - T / 2, H / 2, cz - T / 2));
  g.add(box(W, H, T, PALETTE.wall, cx, H / 2, minZ - T / 2));
  // Skirting.
  g.add(box(0.04, 0.12, D, PALETTE.wallTrim, minX + 0.02, 0.06, cz));
  g.add(box(W, 0.12, 0.04, PALETTE.wallTrim, cx, 0.06, minZ + 0.02));

  // Window on the back-right wall.
  const win = new THREE.Group();
  win.position.set(2.2, 1.35, minZ + 0.01);
  win.add(box(2.6, 1.3, 0.04, PALETTE.glass, 0, 0, 0));
  for (const [w, h, x, y] of [
    [2.75, 0.1, 0, 0.68],
    [2.75, 0.1, 0, -0.68],
    [0.1, 1.4, -1.33, 0],
    [0.1, 1.4, 1.33, 0],
    [0.07, 1.3, -0.44, 0],
    [0.07, 1.3, 0.44, 0],
  ]) {
    win.add(box(w, h, 0.08, PALETTE.sage, x, y, 0.03));
  }
  win.add(box(2.8, 0.06, 0.22, PALETTE.wood, 0, -0.74, 0.1));
  g.add(win);

  // Menu board on the back-left wall.
  const board = box(0.05, 0.8, 1.2, PALETTE.coffee, minX + 0.03, 1.6, 1.2);
  board.add(box(0.02, 0.86, 1.26, PALETTE.wood, -0.02, 0, 0));
  g.add(board);

  // Shelf above the back counter.
  g.add(box(0.28, 0.05, 1.6, PALETTE.wood, minX + 0.14, 1.35, -2.4));

  // Plant in the far-right corner.
  const plant = new THREE.Group();
  plant.position.set(maxX - 0.45, 0, minZ + 0.45);
  plant.add(cyl(0.22, 0.4, PALETTE.terracotta, 0, 0.2, 0, 7));
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), mat(PALETTE.leaf));
  leaves.position.y = 0.78;
  leaves.castShadow = true;
  plant.add(leaves);
  g.add(plant);

  // Entrance: door posts at the floor edge and a mat outside.
  const { door, outside, width } = layout.entrance;
  const ez = door.z;
  for (const s of [-1, 1]) g.add(box(0.14, 0.6, 0.14, PALETTE.wood, maxX + 0.02, 0.3, ez + (s * width) / 2));
  const mat_ = box(0.8, 0.03, width - 0.2, PALETTE.sage, (maxX + outside.x) / 2 + 0.05, -0.08, ez);
  mat_.castShadow = false;
  g.add(mat_);
  const step = box(1.0, 0.14, width + 0.2, PALETTE.cream, (maxX + outside.x) / 2 + 0.05, -0.18, ez);
  step.castShadow = false;
  g.add(step);
  return g;
}

export function createCounter(size: { width: number; depth: number; height: number }, kind: 'service' | 'back'): THREE.Group {
  const g = new THREE.Group();
  g.name = `counter-${kind}`;
  const { width: w, depth: d, height: h } = size;
  const top = 0.05;
  g.add(box(w, h - top, d - 0.04, kind === 'service' ? PALETTE.wood : PALETTE.coffee, 0, (h - top) / 2, -0.02));
  g.add(box(w + 0.04, top, d + 0.04, PALETTE.woodLight, 0, h - top / 2, 0));
  if (kind === 'service') {
    // Vertical slats on the customer side (+Z).
    for (let x = -w / 2 + 0.15; x < w / 2 - 0.1; x += 0.2) g.add(box(0.04, h - 0.15, 0.02, PALETTE.woodDark, x, (h - top) / 2, d / 2 - 0.02));
  }
  return g;
}

export function createEspressoMachine(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'espresso-machine';
  g.add(box(0.62, 0.36, 0.4, PALETTE.sage, 0, 0.18, 0));
  g.add(box(0.66, 0.05, 0.44, PALETTE.metal, 0, 0.385, 0));
  g.add(box(0.5, 0.05, 0.12, PALETTE.coffee, 0, 0.3, 0.24)); // group head bar
  for (const x of [-0.14, 0.14]) g.add(cyl(0.035, 0.1, PALETTE.metal, x, 0.22, 0.24, 6));
  g.add(box(0.5, 0.02, 0.14, PALETTE.metal, 0, 0.04, 0.24)); // drip tray
  for (const x of [-0.18, 0, 0.18]) g.add(cyl(0.045, 0.07, PALETTE.cream, x, 0.445, 0, 7)); // cups on top
  return g;
}

export function createTable(table: TableLayout): THREE.Group {
  const g = new THREE.Group();
  g.name = `table-${table.id}`;
  const { sx, sz } = table.size;
  const h = table.height;
  g.add(box(sx, 0.05, sz, PALETTE.woodLight, 0, h - 0.025, 0));
  g.add(cyl(0.05, h - 0.05, PALETTE.coffee, 0, (h - 0.05) / 2, 0, 6));
  g.add(box(0.42, 0.04, 0.42, PALETTE.coffee, 0, 0.02, 0));
  return g;
}

export function createChair(seat: SeatAnchor): THREE.Group {
  const g = new THREE.Group();
  g.name = `chair-${seat.id}`;
  const s = 0.42;
  const h = seat.sitHeight;
  g.add(box(s, 0.05, s, PALETTE.terracotta, 0, h - 0.025, 0));
  g.add(box(s, 0.34, 0.05, PALETTE.terracotta, 0, h + 0.17, -s / 2 + 0.025)); // backrest at -Z
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    g.add(box(0.04, h - 0.05, 0.04, PALETTE.coffee, (x * s) / 2.4, (h - 0.05) / 2, (z * s) / 2.4));
  }
  return g;
}

/** A small cup used by character visuals for `setHolding`. */
export function createCup(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'cup';
  g.add(cyl(0.045, 0.08, PALETTE.cream, 0, 0.04, 0, 8));
  g.add(cyl(0.047, 0.015, PALETTE.terracotta, 0, 0.06, 0, 8));
  return g;
}
