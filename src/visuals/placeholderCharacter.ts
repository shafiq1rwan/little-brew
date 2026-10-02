import * as THREE from 'three';
import { PALETTE } from './palette';
import { box, createCup } from './placeholderFurniture';
import type { ActionOptions, CharacterAction, CharacterVisual } from './types';

const SHIRTS = [0xf3e9d8, 0xb76d49, 0x6f8fa8, 0x8c9b74, 0xd9b26f, 0x9a6f8f];
const HAIR = [0x3b2a20, 0x5a3b26, 0x1f1b18, 0x8a5a33];

/**
 * PLACEHOLDER chunky character (Codex replaces) with procedural poses, used when the Kenney
 * GLBs are unavailable. Proportions mimic Kenney Mini Characters: ~1.2 m tall, large head.
 */
export class PlaceholderCharacter implements CharacterVisual {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legL: THREE.Object3D;
  private readonly legR: THREE.Object3D;
  private readonly armL: THREE.Object3D;
  private readonly armR: THREE.Object3D;
  private readonly cup = createCup();
  private action: CharacterAction = 'idle';
  private seatHeight = 0.24;
  private t = Math.random() * 10;

  constructor(variant: number, barista = false) {
    this.root.name = barista ? 'barista' : `customer-v${variant}`;
    const shirt = barista ? PALETTE.cream : SHIRTS[variant % SHIRTS.length];
    const pants = barista ? PALETTE.coffee : variant % 2 ? PALETTE.coffee : 0x4b5d73;
    const hair = HAIR[variant % HAIR.length];

    const limb = (w: number, h: number, color: number, x: number, y: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(box(w, h, w, color, 0, -h / 2, 0));
      return pivot;
    };
    this.legL = limb(0.13, 0.26, pants, 0.08, 0.26);
    this.legR = limb(0.13, 0.26, pants, -0.08, 0.26);
    this.body.add(this.legL, this.legR);
    this.body.add(box(0.34, 0.3, 0.22, shirt, 0, 0.41, 0));
    if (barista) this.body.add(box(0.3, 0.32, 0.03, PALETTE.sage, 0, 0.39, 0.12)); // apron
    this.armL = limb(0.09, 0.24, shirt, 0.22, 0.54);
    this.armR = limb(0.09, 0.24, shirt, -0.22, 0.54);
    this.body.add(this.armL, this.armR);
    this.body.add(box(0.44, 0.42, 0.4, 0xe8b996, 0, 0.78, 0)); // head
    this.body.add(box(0.47, 0.18, 0.43, hair, 0, 0.94, -0.02)); // hair
    this.body.add(box(0.05, 0.05, 0.02, PALETTE.coffee, 0.09, 0.8, 0.205), box(0.05, 0.05, 0.02, PALETTE.coffee, -0.09, 0.8, 0.205));
    this.cup.position.set(0, -0.24, 0.06);
    this.cup.visible = false;
    this.armR.add(this.cup);
    this.root.add(this.body);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
  }

  setAction(action: CharacterAction, opts?: ActionOptions): void {
    this.action = action;
    if (opts?.seatHeight !== undefined) this.seatHeight = opts.seatHeight;
  }

  setHolding(holding: boolean): void {
    this.cup.visible = holding;
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    let legSwing = 0;
    let armSwing = 0;
    let bob = 0;
    let armRLift = this.cup.visible ? -0.9 : 0;
    this.body.position.set(0, 0, 0);
    this.legL.rotation.x = this.legR.rotation.x = 0;
    switch (this.action) {
      case 'walk':
        legSwing = Math.sin(t * 10) * 0.6;
        armSwing = -legSwing * 0.7;
        bob = Math.abs(Math.sin(t * 10)) * 0.03;
        break;
      case 'sit':
        this.body.position.set(0, this.seatHeight - 0.26 + 0.02, -0.06);
        this.legL.rotation.x = this.legR.rotation.x = -Math.PI / 2;
        break;
      case 'work':
        armRLift = -1.2 + Math.sin(t * 6) * 0.25;
        armSwing = 0;
        break;
      case 'serve':
        armRLift = -1.4;
        break;
      default:
        bob = Math.sin(t * 2) * 0.008;
    }
    if (this.action !== 'sit') {
      this.legL.rotation.x = legSwing;
      this.legR.rotation.x = -legSwing;
    }
    this.armL.rotation.x = armSwing;
    this.armR.rotation.x = armRLift || -armSwing;
    this.body.position.y += bob;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose(); // materials are shared and cached
    });
    this.root.removeFromParent();
  }
}
