import { KENNEY_BARISTA_MODEL, KenneyCharacter, loadKenneyAssets } from './kenneyCharacters';
import { PlaceholderCharacter } from './placeholderCharacter';
import { createChair, createCounter, createEspressoMachine, createRoom, createTable } from './placeholderFurniture';
import type { VisualFactories } from './types';

export type { CharacterAction, CharacterVisual, VisualFactories } from './types';

/**
 * Assembles the visual factories used by the scene. Codex: swap individual factories here
 * (e.g. GLB furniture) without touching gameplay code.
 */
export async function createVisualFactories(): Promise<VisualFactories> {
  const furniture = { createRoom, createCounter, createEspressoMachine, createTable, createChair };
  try {
    const assets = await loadKenneyAssets();
    const barista = assets.find((a) => a.name === KENNEY_BARISTA_MODEL) ?? assets[0];
    const customers = assets.length > 1 ? assets.filter((a) => a !== barista) : assets;
    return {
      ...furniture,
      createCustomer: (variant) => new KenneyCharacter(customers[variant % customers.length]),
      createBarista: () => new KenneyCharacter(barista, true),
      customerVariantCount: customers.length,
      characterSource: 'kenney',
    };
  } catch (err) {
    console.warn('[visuals] Falling back to placeholder characters:', err);
    return {
      ...furniture,
      createCustomer: (variant) => new PlaceholderCharacter(variant),
      createBarista: () => new PlaceholderCharacter(0, true),
      customerVariantCount: 12,
      characterSource: 'placeholder',
    };
  }
}
