import * as THREE from 'three';
import type { Layout } from '../config/layout';

/** Camera framing settings (Codex: camera polish lives here). */
export const CAMERA = {
  azimuthDeg: 45,
  elevationDeg: 35.264,
  distance: 40,
  minZoom: 1,
  maxZoom: 2.5,
  /** Extra screen margin around the room, in pixels. */
  marginPx: 24,
};

export interface ViewInsets {
  /** Pixels covered by UI at the top/bottom (HUD and toolbar); the room is framed between them. */
  top: number;
  bottom: number;
}

/**
 * Fixed orthographic isometric camera. The frustum is fitted so the whole room (floor, walls and
 * entrance) fits between the HUD and the toolbar; zoom and pan are bounded. Rotation is deferred.
 */
export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;
  private zoom = 1;
  /** Pan offset in view-space units, clamped by zoom. */
  private pan = new THREE.Vector2();
  private bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private width = 1;
  private height = 1;
  private insets: ViewInsets = { top: 0, bottom: 0 };

  constructor(private readonly layout: Layout) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const az = THREE.MathUtils.degToRad(CAMERA.azimuthDeg);
    const el = THREE.MathUtils.degToRad(CAMERA.elevationDeg);
    const { room } = layout;
    const target = new THREE.Vector3((room.minX + room.maxX) / 2, 0, (room.minZ + room.maxZ) / 2);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.camera.position.copy(target).addScaledVector(dir, CAMERA.distance);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld(true);
    this.computeBounds();
  }

  /** Room bounding box (incl. walls and entrance step) projected into view space. */
  private computeBounds(): void {
    const { room, entrance } = this.layout;
    const t = room.wallThickness;
    const xs = [room.minX - t, Math.max(room.maxX, entrance.outside.x + 0.2)];
    const ys = [-0.35, room.wallHeight];
    const zs = [room.minZ - t, room.maxZ];
    const inv = this.camera.matrixWorldInverse;
    const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    const v = new THREE.Vector3();
    for (const x of xs)
      for (const y of ys)
        for (const z of zs) {
          v.set(x, y, z).applyMatrix4(inv);
          b.minX = Math.min(b.minX, v.x);
          b.maxX = Math.max(b.maxX, v.x);
          b.minY = Math.min(b.minY, v.y);
          b.maxY = Math.max(b.maxY, v.y);
        }
    this.bounds = b;
  }

  resize(width: number, height: number, insets: ViewInsets): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.insets = insets;
    this.apply();
  }

  zoomBy(factor: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, CAMERA.minZoom, CAMERA.maxZoom);
    this.apply();
  }

  /** Pan by a screen-pixel delta (drag). Only meaningful when zoomed in. */
  panByPixels(dx: number, dy: number): void {
    const s = this.unitsPerPixel();
    this.pan.x -= dx * s;
    this.pan.y += dy * s;
    this.apply();
  }

  get zoomLevel(): number {
    return this.zoom;
  }

  private unitsPerPixel(): number {
    const b = this.bounds;
    const availW = Math.max(50, this.width - 2 * CAMERA.marginPx);
    const availH = Math.max(50, this.height - this.insets.top - this.insets.bottom - 2 * CAMERA.marginPx);
    return Math.max((b.maxX - b.minX) / availW, (b.maxY - b.minY) / availH) / this.zoom;
  }

  private apply(): void {
    const b = this.bounds;
    const s = this.unitsPerPixel();
    // Clamp pan so the room can't be dragged off screen.
    const maxPanX = Math.max(0, ((b.maxX - b.minX) / 2) * (1 - 1 / this.zoom));
    const maxPanY = Math.max(0, ((b.maxY - b.minY) / 2) * (1 - 1 / this.zoom));
    this.pan.x = THREE.MathUtils.clamp(this.pan.x, -maxPanX, maxPanX);
    this.pan.y = THREE.MathUtils.clamp(this.pan.y, -maxPanY, maxPanY);
    const cx = (b.minX + b.maxX) / 2 + this.pan.x;
    const cy = (b.minY + b.maxY) / 2 + this.pan.y;
    // Center the room in the band between the HUD and the toolbar.
    const bandCenterFromTop = this.insets.top + (this.height - this.insets.top - this.insets.bottom) / 2;
    const top = cy + bandCenterFromTop * s;
    this.camera.left = cx - (this.width / 2) * s;
    this.camera.right = cx + (this.width / 2) * s;
    this.camera.top = top;
    this.camera.bottom = top - this.height * s;
    this.camera.updateProjectionMatrix();
  }
}
