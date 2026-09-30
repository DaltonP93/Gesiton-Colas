import { eq } from 'drizzle-orm';
import { deepMerge, normalizeConfig, platformSettingsSchema, type PlatformSettings } from '@gc/shared';
import type { Database } from '../db/client';
import { platformSettings } from '../db/schema';

const KEY = 'general';
const TTL = 30_000;

export interface PlatformSettingsStore {
  get(): Promise<PlatformSettings>;
  /** Mezcla los cambios con lo guardado, valida y guarda. */
  update(patch: unknown): Promise<PlatformSettings>;
}

/** Ajustes globales que define el superadministrador (con caché breve en memoria). */
export function createPlatformSettings(db: Database): PlatformSettingsStore {
  let cache: { value: PlatformSettings; at: number } | null = null;

  async function get() {
    if (cache && Date.now() - cache.at < TTL) return cache.value;
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, KEY)).limit(1);
    const value = normalizeConfig(platformSettingsSchema, row?.value);
    cache = { value, at: Date.now() };
    return value;
  }

  return {
    get,
    async update(patch) {
      cache = null;
      const value = normalizeConfig(platformSettingsSchema, deepMerge(await get(), patch));
      await db
        .insert(platformSettings)
        .values({ key: KEY, value })
        .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
      cache = { value, at: Date.now() };
      return value;
    },
  };
}
