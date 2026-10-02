import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Layout, SeatAnchor, TableLayout } from '../config/layout';
import { PALETTE as P } from './palette';

// Hand-built, reusable low-poly assets. All dimensions obey the simulation's anchors.
const materials = new Map<number, THREE.MeshStandardMaterial>();
const geometry = new Map<string, THREE.BufferGeometry>();
function material(color: number): THREE.MeshStandardMaterial {
  let value = materials.get(color);
  if (!value) {
    value = new THREE.MeshStandardMaterial({ color, roughness: 0.88, flatShading: true });
    materials.set(color, value);
  }
  return value;
}
function mesh(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material(color));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function block(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, bevel = 0): THREE.Mesh {
  const key = [w, h, d, bevel].join('/');
  let geo = geometry.get(key);
  if (!geo) {
    geo = bevel ? new RoundedBoxGeometry(w, h, d, 1, Math.min(bevel, w / 4, h / 4, d / 4)) : new THREE.BoxGeometry(w, h, d);
    geometry.set(key, geo);
  }
  return mesh(geo, color, x, y, z);
}
function cylinder(top: number, bottom: number, height: number, color: number, x = 0, y = 0, z = 0, sides = 10): THREE.Mesh {
  const key = ['c', top, bottom, height, sides].join('/');
  let geo = geometry.get(key);
  if (!geo) { geo = new THREE.CylinderGeometry(top, bottom, height, sides); geometry.set(key, geo); }
  return mesh(geo, color, x, y, z);
}

/** Merge opaque static parts by material; detail needn't mean hundreds of draw calls. */
function batch(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, { source: THREE.Mesh[]; geometry: THREE.BufferGeometry[] }>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) || object.material.transparent) return;
    let bucket = buckets.get(object.material);
    if (!bucket) { bucket = { source: [], geometry: [] }; buckets.set(object.material, bucket); }
    bucket.source.push(object);
    bucket.geometry.push(object.geometry.clone().applyMatrix4(object.matrixWorld));
  });
  for (const [mat, bucket] of buckets) {
    const combined = mergeGeometries(bucket.geometry, false);
    bucket.geometry.forEach((g) => g.dispose());
    if (!combined) continue;
    bucket.source.forEach((m) => m.removeFromParent());
    const m = new THREE.Mesh(combined, mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

function plant(scale = 1): THREE.Group {
  const g = new THREE.Group();
  g.add(cylinder(0.19, 0.14, 0.3, P.terracotta, 0, 0.15));
  g.add(cylinder(0.205, 0.205, 0.05, 0xc88864, 0, 0.285));
  g.add(cylinder(0.17, 0.17, 0.02, P.coffee, 0, 0.31));
  g.add(cylinder(0.025, 0.035, 0.57, P.woodDark, 0, 0.56));
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4;
    const r = i < 6 ? 0.19 : 0.1;
    const leaf = mesh(new THREE.IcosahedronGeometry(0.2, 0), [P.leaf, P.sageLight, 0x8b9b51][i % 3], Math.cos(a) * r, 0.48 + i * 0.055, Math.sin(a) * r);
    leaf.scale.set(0.65, 1.55, 0.65);
    leaf.rotation.set(Math.sin(a) * 0.6, a, Math.cos(a) * 0.6);
    g.add(leaf);
  }
  g.scale.setScalar(scale);
  return g;
}

export function createCafeCup(): THREE.Group {
  const g = new THREE.Group();
  g.add(cylinder(0.052, 0.038, 0.085, P.cream, 0, 0.047));
  g.add(cylinder(0.042, 0.042, 0.004, P.coffee, 0, 0.091));
  const handle = mesh(new THREE.TorusGeometry(0.025, 0.009, 5, 8), P.cream, 0.057, 0.051, 0);
  g.add(handle);
  return g;
}

function labelTexture(draw: (ctx: CanvasRenderingContext2D) => void, w = 512, h = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function framedMenu(): THREE.Group {
  const g = new THREE.Group();
  g.add(block(1.27, 1.02, 0.065, P.wood, 0, 0, 0, 0.02));
  const texture = labelTexture((ctx) => {
    ctx.fillStyle = '#39463b'; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#f6ebd8'; ctx.textAlign = 'center';
    ctx.font = '600 49px Georgia'; ctx.fillText('COFFEE', 256, 98);
    ctx.strokeStyle = '#b8bc96'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(68, 134); ctx.lineTo(444, 134); ctx.stroke();
    ctx.font = '30px Georgia'; ctx.fillText('Freshly brewed', 256, 200);
    ctx.font = 'italic 27px Georgia'; ctx.fillText('A little cup of happiness', 256, 254);
    ctx.font = '24px sans-serif'; ctx.fillText('TAKE A SEAT & STAY AWHILE', 256, 424);
    ctx.strokeStyle = '#f6ebd8'; ctx.lineWidth = 5;
    ctx.strokeRect(215, 290, 72, 51);
    ctx.beginPath(); ctx.arc(294, 313, 17, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(201, 356); ctx.lineTo(306, 356); ctx.stroke();
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.88), new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
  face.position.z = 0.035; g.add(face);
  return g;
}

export function createRoom(layout: Layout): THREE.Group {
  const g = new THREE.Group(); g.name = 'cafe-room';
  const { minX, maxX, minZ, maxZ, wallHeight: H, wallThickness: T } = layout.room;
  const W = maxX - minX, D = maxZ - minZ;
  g.add(block(W + T, 0.25, D + T, 0xaa9076, -T / 2, -0.2, -T / 2, 0.035));
  g.add(block(W, 0.08, D, P.woodDark, 0, -0.045));
  // Staggered oak planks. Deterministic variations keep reloads visually identical.
  const woods = [0xcfa36f, 0xd4aa79, 0xc99b66, 0xd9b17f, 0xcda171];
  const rows = 22, rowDepth = D / rows;
  for (let row = 0; row < rows; row++) {
    const z = minZ + (row + 0.5) * rowDepth;
    let x = minX, col = 0;
    while (x < maxX - 0.001) {
      const length = Math.min(col === 0 ? 0.75 + (row % 3) * 0.53 : 1.7, maxX - x);
      g.add(block(length - 0.009, 0.045, rowDepth - 0.009, woods[(row * 7 + col * 3) % woods.length], x + length / 2, -0.0225, z));
      x += length; col++;
    }
  }
  g.add(block(T, H, D + T, P.wall, minX - T / 2, H / 2, -T / 2));
  // Window opening is made from wall segments, not glass pasted over an opaque wall.
  const wx = 1.75, ww = 3.55, bottom = 0.83, top = H - 0.24;
  const left = wx - ww / 2, right = wx + ww / 2;
  g.add(block(left - minX, H, T, P.wall, (minX + left) / 2, H / 2, minZ - T / 2));
  g.add(block(maxX - right, H, T, P.wall, (maxX + right) / 2, H / 2, minZ - T / 2));
  g.add(block(ww, bottom, T, P.wall, wx, bottom / 2, minZ - T / 2));
  g.add(block(ww, H - top, T, P.wall, wx, (H + top) / 2, minZ - T / 2));
  g.add(block(T + 0.035, 0.055, D + T, P.cream, minX - T / 2, H + 0.012, -T / 2));
  g.add(block(W, 0.055, T + 0.035, P.cream, 0, H + 0.012, minZ - T / 2));
  g.add(block(0.065, 0.14, D, P.wood, minX + 0.032, 0.07));
  g.add(block(W, 0.14, 0.065, P.wood, 0, 0.07, minZ + 0.032));
  const wh = top - bottom;
  const landscape = labelTexture((ctx) => {
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#d5e5e5'); sky.addColorStop(1, '#f4edd7');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 11; i++) {
      const x = i * 108 - 30, y = 280 + (i % 3) * 35;
      ctx.fillStyle = ['#b8c59d', '#a9ba8b', '#c4cea5'][i % 3];
      ctx.beginPath(); ctx.moveTo(x - 75, 512); ctx.lineTo(x - 75, y + 68); ctx.lineTo(x, y - 40);
      ctx.lineTo(x + 69, y); ctx.lineTo(x + 106, 512); ctx.fill();
    }
  }, 1024, 512);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshBasicMaterial({ map: landscape }));
  outside.position.set(wx, (top + bottom) / 2, minZ - T - 0.015); g.add(outside);
  for (let i = 0; i < 5; i++) g.add(block(0.075, wh + 0.1, 0.12, P.sage, left + i * ww / 4, (top + bottom) / 2, minZ + 0.015));
  for (const y of [bottom, bottom + wh * 0.68, top]) g.add(block(ww + 0.14, 0.075, 0.12, P.sage, wx, y, minZ + 0.015));
  g.add(block(ww + 0.28, 0.09, 0.38, P.woodLight, wx, bottom - 0.04, minZ + 0.11, 0.015));
  for (const x of [left + 0.18, right - 0.2]) {
    const p = plant(0.3); p.position.set(x, bottom, minZ + 0.12); g.add(p);
  }
  const menu = framedMenu(); menu.rotation.y = Math.PI / 2;
  menu.position.set(minX + 0.055, 1.5, 1.7); g.add(menu);
  // Shelves sit on the wall above the staff-only area.
  for (const [z, width, y] of [[-1.6, 2.5, 1.57], [-2.5, 1.3, 2.06]]) {
    g.add(block(0.32, 0.075, width, P.wood, minX + 0.16, y, z, 0.012));
    for (const dz of [-width * 0.32, width * 0.32]) g.add(block(0.22, 0.15, 0.045, P.woodDark, minX + 0.11, y - 0.1, z + dz));
    for (let i = 0; i < 4; i++) {
      const zz = z - width * 0.33 + i * width * 0.22;
      if (y > 2) {
        g.add(cylinder(0.07, 0.07, 0.15, [P.sage, P.cream, P.coffee, P.terracotta][i], minX + 0.17, y + 0.11, zz));
      } else {
        g.add(block(0.14, 0.23, 0.16, [P.cream, 0xd3b58e][i % 2], minX + 0.17, y + 0.15, zz, 0.012));
        g.add(block(0.015, 0.075, 0.08, P.sage, minX + 0.25, y + 0.15, zz));
      }
    }
  }
  // Compact print between the window and service wall.
  g.add(block(0.65, 0.86, 0.065, P.wood, -1.2, 1.55, minZ + 0.055, 0.015));
  g.add(block(0.55, 0.76, 0.012, P.cream, -1.2, 1.55, minZ + 0.094));
  g.add(block(0.015, 0.46, 0.015, P.sage, -1.2, 1.55, minZ + 0.11));
  for (let i = 0; i < 5; i++) {
    const leaf = mesh(new THREE.IcosahedronGeometry(0.11, 0), P.sage, -1.2 + (i % 2 ? -0.075 : 0.075), 1.38 + i * 0.075, minZ + 0.12);
    leaf.scale.set(1, 0.48, 0.16); leaf.rotation.z = i % 2 ? -0.6 : 0.6; g.add(leaf);
  }
  // Raised wall planter avoids introducing an untracked floor obstacle.
  const cornerPlant = plant(0.65); cornerPlant.position.set(maxX - 0.36, 0.55, minZ + 0.24); g.add(cornerPlant);
  g.add(block(0.55, 0.08, 0.4, P.wood, maxX - 0.36, 0.51, minZ + 0.17));
  const { outside: entry, door, width } = layout.entrance;
  for (const s of [-1, 1]) g.add(block(0.12, 0.48, 0.12, P.wood, maxX + 0.02, 0.24, door.z + s * width / 2, 0.018));
  g.add(block(1.08, 0.15, width + 0.15, P.cream, (maxX + entry.x) / 2, -0.15, door.z, 0.03));
  g.add(block(0.65, 0.026, width - 0.23, P.sage, (maxX + entry.x) / 2, -0.061, door.z, 0.01));
  return batch(g);
}

export function createCounter(size: { width: number; depth: number; height: number }, kind: 'service' | 'back'): THREE.Group {
  const g = new THREE.Group(); g.name = `cafe-${kind}-counter`;
  const { width: w, depth: d, height: h } = size;
  g.add(block(w - 0.04, h - 0.07, d - 0.05, kind === 'service' ? P.wood : 0x65594b, 0, (h - 0.07) / 2, 0, 0.02));
  g.add(block(w, 0.055, d, P.woodLight, 0, h - 0.0275, 0, 0.015));
  g.add(block(w - 0.08, 0.055, d - 0.08, P.woodDark, 0, 0.028));
  if (kind === 'service') {
    const n = Math.floor(w / 0.18), spacing = (w - 0.06) / n;
    for (let i = 0; i < n; i++) g.add(block(spacing - 0.012, h - 0.15, 0.028, i % 3 ? P.wood : 0xbf9059, -w / 2 + 0.03 + (i + 0.5) * spacing, h / 2 - 0.025, d / 2 - 0.012, 0.005));
    // Register toward the pickup end; center remains clear for the handover.
    const rx = w * 0.28;
    g.add(block(0.32, 0.05, 0.25, P.coffee, rx, h + 0.025, 0));
    g.add(block(0.055, 0.16, 0.05, P.coffee, rx, h + 0.115, 0));
    const terminal = block(0.3, 0.22, 0.045, P.coffee, rx, h + 0.24, 0, 0.018);
    terminal.rotation.x = -0.22; g.add(terminal);
    const screen = block(0.255, 0.165, 0.007, 0x8eaa9b, rx, h + 0.24, -0.026);
    screen.rotation.x = -0.22; g.add(screen);
    // Pastry dome sits at the opposite end of the counter.
    const px = -w * 0.29;
    g.add(block(0.73, 0.045, d * 0.72, P.woodDark, px, h + 0.0225));
    for (let i = 0; i < 3; i++) {
      const bread = mesh(new THREE.TorusGeometry(0.074, 0.035, 5, 7, Math.PI * 1.45), 0xd59c51, px - 0.21 + i * 0.21, h + 0.085, 0);
      bread.rotation.x = -Math.PI / 2; g.add(bread);
    }
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.23, d * 0.7), new THREE.MeshStandardMaterial({ color: 0xe1eeeb, transparent: true, opacity: 0.17, roughness: 0.2, depthWrite: false }));
    glass.position.set(px, h + 0.16, 0); g.add(glass);
    for (const side of [-1, 1]) g.add(block(0.018, 0.24, 0.018, P.metal, px + side * 0.35, h + 0.15, -d * 0.34));
    g.add(block(0.73, 0.018, 0.018, P.metal, px, h + 0.27, -d * 0.34));
    const napkins = block(0.16, 0.1, 0.14, P.cream, 0.34, h + 0.05, 0, 0.01); g.add(napkins);
  } else {
    const n = Math.floor(w / 0.55);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * w / n;
      g.add(block(w / n - 0.03, h - 0.15, 0.025, 0x786859, x, h / 2, d / 2 - 0.015, 0.01));
      g.add(block(0.16, 0.022, 0.04, P.metal, x, h - 0.16, d / 2 + 0.01));
    }
    // Grinder, away from the espresso-machine anchor.
    g.add(block(0.23, 0.22, 0.23, P.coffee, -w * 0.34, h + 0.11, 0, 0.025));
    g.add(cylinder(0.13, 0.07, 0.22, 0x8d7960, -w * 0.34, h + 0.33));
    g.add(cylinder(0.135, 0.135, 0.025, P.coffee, -w * 0.34, h + 0.45));
    for (let i = 0; i < 3; i++) {
      const cup = createCafeCup(); cup.position.set(w * 0.32, h + i * 0.045, 0); g.add(cup);
    }
  }
  return batch(g);
}

export function createEspressoMachine(): THREE.Group {
  const g = new THREE.Group(); g.name = 'sage-espresso-machine';
  g.add(block(0.78, 0.065, 0.49, P.coffee, 0, 0.0325, 0, 0.025));
  g.add(block(0.78, 0.34, 0.3, P.sage, 0, 0.23, -0.07, 0.045));
  for (const x of [-0.35, 0.35]) g.add(block(0.07, 0.37, 0.44, P.sage, x, 0.235, 0, 0.02));
  g.add(block(0.68, 0.15, 0.06, 0xa9b39a, 0, 0.31, 0.115, 0.012));
  for (const x of [-0.18, 0.18]) {
    const dial = cylinder(0.045, 0.045, 0.02, P.cream, x, 0.33, 0.156); dial.rotation.x = Math.PI / 2; g.add(dial);
    g.add(block(0.012, 0.035, 0.01, P.coffee, x, 0.34, 0.17));
    g.add(cylinder(0.043, 0.055, 0.055, P.metal, x, 0.207, 0.16));
    g.add(block(0.035, 0.027, 0.13, P.coffee, x, 0.185, 0.23, 0.009));
    const cup = createCafeCup(); cup.position.set(x, 0.072, 0.16); g.add(cup);
  }
  g.add(block(0.66, 0.025, 0.19, P.metal, 0, 0.065, 0.16));
  for (let i = 0; i < 10; i++) g.add(block(0.018, 0.006, 0.14, 0x726f62, -0.28 + i * 0.062, 0.081, 0.16));
  g.add(block(0.8, 0.04, 0.43, P.metal, 0, 0.423, -0.025, 0.012));
  for (let i = 0; i < 4; i++) { const cup = createCafeCup(); cup.position.set(-0.25 + i * 0.165, 0.445, -0.04); g.add(cup); }
  return batch(g);
}

export function createTable(table: TableLayout): THREE.Group {
  const g = new THREE.Group(); g.name = `oak-table-${table.id}`;
  const { sx, sz } = table.size, h = table.height;
  g.add(block(sx, 0.065, sz, P.woodLight, 0, h - 0.0325, 0, 0.025));
  for (const z of [-sz / 6, sz / 6]) g.add(block(sx - 0.035, 0.001, 0.005, P.wood, 0, h + 0.0005, z));
  g.add(cylinder(0.052, 0.07, h - 0.085, P.coffee, 0, (h - 0.085) / 2 + 0.02, 0, 8));
  g.add(block(sx * 0.6, 0.035, sz * 0.6, P.coffee, 0, 0.0175, 0, 0.02));
  const p = plant(0.18); p.position.set(0, h, -0.13); g.add(p);
  g.add(block(0.11, 0.015, 0.11, P.cream, 0.2, h + 0.009, -0.16));
  return batch(g);
}

export function createChair(seat: SeatAnchor): THREE.Group {
  const g = new THREE.Group(); g.name = `terracotta-chair-${seat.id}`;
  const h = seat.sitHeight;
  g.add(block(0.44, 0.06, 0.44, P.terracotta, 0, h - 0.03, 0, 0.025));
  const back = block(0.44, 0.29, 0.065, P.terracotta, 0, h + 0.15, -0.19, 0.025);
  back.rotation.x = -0.08; g.add(back);
  for (const x of [-0.16, 0.16]) for (const z of [-0.16, 0.16]) {
    g.add(block(0.048, h - 0.035, 0.048, P.coffee, x, (h - 0.035) / 2, z, 0.006));
  }
  return batch(g);
}
