import { BALANCE, clampPrice, type BalanceConfig } from '../config/balance';
import type { Progress } from '../sim/types';

/**
 * Progression persistence. Only plain progression data is stored — never Three.js objects or
 * in-flight customers. The game saves at safe boundaries (entering preparation, results, after
 * purchases and price changes); reloading mid-service restores the last boundary.
 */
export const SAVE_KEY = 'cafe-sim.save';
export const SAVE_VERSION = 1;

export interface SaveFile extends Progress {
  version: number;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Validates untrusted data; returns null if it is not a usable save. */
export function parseSave(raw: string | null, b: BalanceConfig = BALANCE): Progress | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.version !== SAVE_VERSION) return null;
  if (!isInt(d.day) || d.day < 1) return null;
  if (!isInt(d.cashCents) || d.cashCents < 0) return null;
  if (typeof d.upgraded !== 'boolean') return null;
  if (!isInt(d.priceCents)) return null;
  return { day: d.day, cashCents: d.cashCents, upgraded: d.upgraded, priceCents: clampPrice(d.priceCents, b) };
}

export function loadProgress(store: KeyValueStore | null = defaultStore(), b: BalanceConfig = BALANCE): Progress | null {
  try {
    return parseSave(store?.getItem(SAVE_KEY) ?? null, b);
  } catch {
    return null;
  }
}

export function saveProgress(p: Progress, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  const file: SaveFile = { version: SAVE_VERSION, ...p };
  try {
    store.setItem(SAVE_KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable */
  }
}
