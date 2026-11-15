// Remembered settings (plan T12, M5). Pure load, validate and migrate; storage is injected so the
// logic is testable and every access is guarded.
import { MOODS, type MoodId } from '../contracts/moods';
import { QUALITY, QUALITY_ORDER, type QualityTier } from '../contracts/quality';
import { DEFAULT_STATION, isStationId, type StationId } from '../audio/index';
import { DEFAULT_SEED, isSeed } from './seed';

export interface Settings {
  /** null: not chosen yet, pick from the device. */
  tier: QualityTier | null;
  mood: MoodId;
  muted: boolean;
  /** 0..1 */
  volume: number;
  crt: boolean;
  /** The city last chosen in the menu (M9). An address `?seed=` wins over it. */
  seed: number;
  /** The radio station last tuned to. */
  station: StationId;
  /** Tier of a boot that has not yet reached its first frame. Used to step down after a crash. */
  pending: QualityTier | null;
}

export const STORAGE_KEY = 'synthwave-city/v1';

export const DEFAULTS: Readonly<Settings> = {
  tier: null, mood: 'sunset', muted: false, volume: 0.7, crt: false, seed: DEFAULT_SEED, station: DEFAULT_STATION, pending: null,
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function tier(value: unknown): QualityTier | null {
  return typeof value === 'string' && value in QUALITY ? (value as QualityTier) : null;
}

/** Turn anything (parsed JSON, garbage, nothing) into valid settings. */
export function validate(raw: unknown): Settings {
  const out: Settings = { ...DEFAULTS };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  out.tier = tier(r['tier']);
  out.pending = tier(r['pending']);
  if (typeof r['mood'] === 'string' && r['mood'] in MOODS) out.mood = r['mood'] as MoodId;
  if (typeof r['muted'] === 'boolean') out.muted = r['muted'];
  if (typeof r['crt'] === 'boolean') out.crt = r['crt'];
  if (isSeed(r['seed'])) out.seed = r['seed'];
  if (isStationId(r['station'])) out.station = r['station'];
  if (typeof r['volume'] === 'number' && Number.isFinite(r['volume'])) out.volume = Math.min(1, Math.max(0, r['volume']));
  return out;
}

export function loadSettings(storage: StorageLike | null): Settings {
  if (!storage) return { ...DEFAULTS };
  try {
    const text = storage.getItem(STORAGE_KEY);
    return validate(text === null ? null : JSON.parse(text));
  } catch {
    return { ...DEFAULTS };
  }
}

/** Returns false when nothing could be stored (private window, quota, no storage). */
export function saveSettings(storage: StorageLike | null, settings: Settings): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function safeStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface DeviceHints {
  coarsePointer: boolean;
  /** navigator.deviceMemory in GB, when the browser reports it. */
  memory?: number;
  cores?: number;
}

/** First-run tier from what the browser will tell us. Deliberately cautious on phones. */
export function pickTier(hints: DeviceHints): QualityTier {
  const memory = hints.memory ?? 8;
  const cores = hints.cores ?? 8;
  if (hints.coarsePointer) return memory >= 8 && cores >= 8 ? 'medium' : 'low';
  if (memory <= 4 || cores <= 4) return 'low';
  return memory >= 8 && cores >= 8 ? 'high' : 'medium';
}

/**
 * The tier to boot with. If the previous boot on this tier never reached its first frame, step
 * down one tier and remember that choice.
 */
export function resolveTier(settings: Settings, hints: DeviceHints, override: string | null): { tier: QualityTier; steppedDown: boolean } {
  const forced = tier(override);
  if (forced) return { tier: forced, steppedDown: false };
  let chosen = settings.tier ?? pickTier(hints);
  let steppedDown = false;
  if (settings.pending === chosen) {
    const i = QUALITY_ORDER.indexOf(chosen);
    if (i > 0) {
      chosen = QUALITY_ORDER[i - 1]!;
      steppedDown = true;
    }
  }
  return { tier: chosen, steppedDown };
}
