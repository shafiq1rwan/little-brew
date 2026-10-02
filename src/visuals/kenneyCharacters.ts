import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { PALETTE } from './palette';
import { box, createCup } from './placeholderFurniture';
import type { ActionOptions, CharacterAction, CharacterVisual } from './types';

/**
 * Kenney Mini Characters integration (CC0, public/assets/kenney-mini-characters/LICENSE.md).
 *
 * Verified from the GLBs: every character-*.glb has the same rig (nodes root, torso, head,
 * arm-left/right, leg-left/right) and the same 32 clips, including static, idle, walk, sprint,
 * sit, pick-up, interact-left/right, holding-left/right/both, emote-yes/no, crouch, die, ...
 * Models are ~0.79 units tall with the origin at the feet and face +Z.
 * The texture is external: Textures/colormap.png next to the GLBs.
 */
export const KENNEY_BASE_URL = `${import.meta.env.BASE_URL}assets/kenney-mini-characters/`;
export const KENNEY_MODELS = [
  'character-female-a',
  'character-female-b',
  'character-female-c',
  'character-female-d',
  'character-female-e',
  'character-female-f',
  'character-male-a',
  'character-male-b',
  'character-male-c',
  'character-male-d',
  'character-male-e',
  'character-male-f',
] as const;
export const KENNEY_BARISTA_MODEL = 'character-female-d';

/** Uniform scale applied to the models (~0.79 m → ~1.2 m). Furniture heights in layout.ts assume this. */
export const KENNEY_SCALE = 1.5;
/** Vertical offset of the model while seated, added to the seat height. The `sit` clip already
 * lowers the rig root by 0.15 model units (0.225 m), leaving the hips ~0.04 m above the model origin. */
export const KENNEY_SIT_OFFSET = 0.02;
/** Facing correction if a model does not face +Z (Kenney models already do). */
export const KENNEY_YAW_CORRECTION = 0;

/** Semantic action → clip names, first available wins; unknown/missing falls back to idle then static. */
export const KENNEY_ACTION_CLIPS: Record<CharacterAction, string[]> = {
  idle: ['idle'],
  walk: ['walk'],
  sit: ['sit'],
  work: ['interact-right'],
  serve: ['interact-left', 'pick-up'],
};
/** Arm pose layered over idle/walk while carrying a cup. */
export const KENNEY_HOLD_CLIP = 'holding-right';
const HOLD_ARM_NODE = 'arm-right';

export interface KenneyAsset {
  name: string;
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  /** Lazily built "<clip>+holding" composites. */
  composites: Map<string, THREE.AnimationClip>;
}

export async function loadKenneyAssets(): Promise<KenneyAsset[]> {
  THREE.Cache.enabled = true; // all models share one texture
  const loader = new GLTFLoader();
  const results = await Promise.allSettled(
    KENNEY_MODELS.map(async (name) => {
      const gltf = await loader.loadAsync(`${KENNEY_BASE_URL}${name}.glb`);
      return {
        name,
        scene: gltf.scene,
        clips: new Map(gltf.animations.map((c) => [c.name, c])),
        composites: new Map(),
      } satisfies KenneyAsset;
    }),
  );
  const assets = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) console.warn(`[visuals] ${failed.length} Kenney model(s) failed to load`, failed);
  if (!assets.length) throw new Error('No Kenney character models could be loaded');
  return assets;
}

/** Replace the hold clip's bones in `base` (e.g. walking legs + cup-carrying arm). */
function composite(asset: KenneyAsset, baseName: string): THREE.AnimationClip | undefined {
  const key = `${baseName}+holding`;
  if (asset.composites.has(key)) return asset.composites.get(key);
  const base = asset.clips.get(baseName);
  const hold = asset.clips.get(KENNEY_HOLD_CLIP);
  if (!base || !hold) return base;
  const holdNodes = new Set(hold.tracks.map((t) => t.name.split('.')[0]));
  const tracks = [...base.tracks.filter((t) => !holdNodes.has(t.name.split('.')[0])), ...hold.tracks];
  const clip = new THREE.AnimationClip(key, base.duration, tracks);
  asset.composites.set(key, clip);
  return clip;
}

export class KenneyCharacter implements CharacterVisual {
  readonly root = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly cup = createCup();
  private current: THREE.AnimationAction | null = null;
  private currentKey = '';
  private action: CharacterAction = 'idle';
  private holding = false;
  private seatHeight = 0;

  constructor(
    private readonly asset: KenneyAsset,
    barista = false,
  ) {
    this.root.name = barista ? 'barista' : `customer-${asset.name}`;
    // Correction wrapper: root (driven by gameplay) → model (scaled/rotated asset).
    this.model = cloneSkinned(asset.scene);
    this.model.scale.setScalar(KENNEY_SCALE);
    this.model.rotation.y = KENNEY_YAW_CORRECTION;
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false; // skinned bounds don't follow animation
      }
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);

    const arm = this.model.getObjectByName(HOLD_ARM_NODE);
    this.cup.scale.setScalar(1 / KENNEY_SCALE);
    this.cup.position.set(-0.02, -0.12, 0.06);
    this.cup.visible = false;
    (arm ?? this.model).add(this.cup);

    if (barista) {
      const torso = this.model.getObjectByName('torso');
      const apron = box(0.2, 0.17, 0.02, PALETTE.sage, 0, 0.07, 0.115);
      (torso ?? this.model).add(apron);
    }
    this.applyAction();
  }

  setAction(action: CharacterAction, opts?: ActionOptions): void {
    if (opts?.seatHeight !== undefined) this.seatHeight = opts.seatHeight;
    if (action === this.action) return;
    this.action = action;
    this.applyAction();
  }

  setHolding(holding: boolean): void {
    if (holding === this.holding) return;
    this.holding = holding;
    this.cup.visible = holding;
    this.applyAction();
  }

  private resolveClip(): THREE.AnimationClip | undefined {
    const names = [...KENNEY_ACTION_CLIPS[this.action], 'idle', 'static'];
    const name = names.find((n) => this.asset.clips.has(n));
    if (!name) return undefined;
    if (this.holding && (this.action === 'idle' || this.action === 'walk' || this.action === 'sit')) {
      return composite(this.asset, name);
    }
    return this.asset.clips.get(name);
  }

  private applyAction(): void {
    this.model.position.y = this.action === 'sit' ? this.seatHeight + KENNEY_SIT_OFFSET : 0;
    const clip = this.resolveClip();
    const key = clip?.name ?? '';
    if (key === this.currentKey) return;
    this.currentKey = key;
    const prev = this.current;
    this.current = clip ? this.mixer.clipAction(clip) : null;
    if (this.current) {
      this.current.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(prev ? 0.15 : 0).play();
    }
    if (prev && prev !== this.current) prev.fadeOut(0.15);
  }

  update(dt: number): void {
    if (dt > 0) this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    // Geometry/materials/textures are shared with the source asset; only detach.
    this.root.removeFromParent();
  }
}
