/**
 * SHARED layout configuration (gameplay + visuals). Changes here move both the simulation's
 * logical anchors and the placeholder/final furniture. Document changes in docs/visual-handoff.md.
 *
 * Conventions: 1 unit = 1 m, Y up, floor at Y = 0. The simulation works on the XZ plane.
 * Rotations are yaw around +Y in radians; a yaw of 0 faces +Z, PI/2 faces +X.
 * Furniture origins are at floor level, centered on their footprint.
 *
 * Room orientation as seen by the default camera (azimuth 45°, looking from +X/+Z):
 * - Back-left wall:  plane x = room.minX  (service counter runs along it)
 * - Back-right wall: plane z = room.minZ  (window side)
 * - Front edges (x = maxX, z = maxZ) are open; the entrance is on the near-right edge (x = maxX).
 */
export interface Vec2 {
  x: number;
  z: number;
}

export interface Rect {
  /** Center on the floor. */
  x: number;
  z: number;
  /** Full size along X and Z (before rotation). */
  sx: number;
  sz: number;
}

export interface SeatAnchor {
  id: number;
  tableId: number;
  /** Chair footprint center (floor level); the seated character's logical position. */
  position: Vec2;
  /** Direction a seated character faces (toward the table). */
  rotationY: number;
  /** Walkable point beside the chair where the customer steps in/out. */
  approach: Vec2;
  /** Seat surface height above the floor, for visuals. */
  sitHeight: number;
}

export interface TableLayout {
  id: number;
  center: Vec2;
  size: { sx: number; sz: number };
  height: number;
  seats: SeatAnchor[];
}

const yawFacing = (dx: number, dz: number) => Math.atan2(dx, dz);

const ROOM = { minX: -4.5, maxX: 4.5, minZ: -3.75, maxZ: 3.75, wallHeight: 2.6, wallThickness: 0.2 };

const TABLE_SIZE = { sx: 0.8, sz: 0.8 };
const TABLE_HEIGHT = 0.42;
const CHAIR_SIZE = { sx: 0.5, sz: 0.5 };
const CHAIR_OFFSET = 0.7; // table center -> chair center
const APPROACH_OFFSET = 0.65;// chair center -> approach point (away from the table)
const SIT_HEIGHT = 0.24;

function makeTable(id: number, cx: number, cz: number): TableLayout {
  const seats: SeatAnchor[] = [-1, 1].map((side, i) => ({
    id: id * 2 + i,
    tableId: id,
    position: { x: cx + side * CHAIR_OFFSET, z: cz },
    rotationY: yawFacing(-side, 0),
    approach: { x: cx + side * (CHAIR_OFFSET + APPROACH_OFFSET), z: cz },
    sitHeight: SIT_HEIGHT,
  }));
  return { id, center: { x: cx, z: cz }, size: TABLE_SIZE, height: TABLE_HEIGHT, seats };
}

const TABLES: TableLayout[] = [makeTable(0, -1.0, 2.0), makeTable(1, 0.9, 0.1), makeTable(2, 2.4, 2.4)];

/** Main service counter (customer side faces +X). Runs from the back-right wall forward. */
const COUNTER: Rect & { height: number } = { x: -2.6, z: -1.45, sx: 0.7, sz: 4.6, height: 0.55 };
/** Back counter against the back-left wall holding the espresso machine. */
const BACK_COUNTER: Rect & { height: number } = { x: -4.2, z: -1.7, sx: 0.6, sz: 3.2, height: 0.55 };

const QUEUE_SPACING = 0.9;
const QUEUE_ORIGIN: Vec2 = { x: -1.8, z: -2.5 };
const QUEUE_SLOTS: Vec2[] = Array.from({ length: 6 }, (_, i) => ({
  x: QUEUE_ORIGIN.x + i * QUEUE_SPACING,
  z: QUEUE_ORIGIN.z,
}));

export const LAYOUT = {
  room: ROOM,
  entrance: {
    /** Spawn/despawn point just outside the floor. */
    outside: { x: ROOM.maxX + 0.9, z: 2.7 } as Vec2,
    /** First walkable point inside the room. */
    door: { x: ROOM.maxX - 0.5, z: 2.7 } as Vec2,
    /** Opening width along the edge (visual only; edges are open). */
    width: 1.4,
  },
  counter: COUNTER,
  backCounter: BACK_COUNTER,
  espressoMachine: {
    position: { x: -4.2, z: -1.3 } as Vec2,
    /** Machine front faces +X, toward the barista. */
    rotationY: Math.PI / 2,
    /** Height of the progress indicator above the floor. */
    indicatorHeight: 1.35,
  },
  /** Behind-counter area. Only the barista walks here (straight lines, no pathing needed). */
  staffZone: { x: -3.375, z: -1.3, sx: 2.25, sz: 4.9 } as Rect,
  barista: {
    idle: { x: -3.25, z: -1.9 } as Vec2,
    machine: { x: -3.55, z: -1.3 } as Vec2,
    machineRotationY: -Math.PI / 2,
    handoff: { x: -2.95, z: -2.5 } as Vec2,
    handoffRotationY: Math.PI / 2,
  },
  /** queueSlots[0] is the pickup point at the counter; later slots extend toward +X. */
  queueSlots: QUEUE_SLOTS,
  queueRotationY: -Math.PI / 2,
  tables: TABLES,
  chairSize: CHAIR_SIZE,
  /** Height above floor for order bubbles over customers' heads. */
  customerIndicatorHeight: 1.55,
  nav: {
    cellSize: 0.25,
    /** Clearance kept from walls, furniture and floor edges (chunky characters). */
    agentRadius: 0.3,
  },
};

export type Layout = typeof LAYOUT;

export function allSeats(layout: Layout = LAYOUT): SeatAnchor[] {
  return layout.tables.flatMap((t) => t.seats);
}

/** Footprints customers must not walk through. */
export function customerObstacles(layout: Layout = LAYOUT): Rect[] {
  return [
    layout.counter,
    layout.backCounter,
    layout.staffZone,
    ...layout.tables.map((t) => ({ x: t.center.x, z: t.center.z, ...t.size })),
    ...allSeats(layout).map((s) => ({ x: s.position.x, z: s.position.z, ...layout.chairSize })),
  ];
}
