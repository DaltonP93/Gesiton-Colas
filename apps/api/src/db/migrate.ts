import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';

/** Busca la carpeta de migraciones tanto en desarrollo (src/db) como en el bundle (dist). */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(here, '../../drizzle'),
    path.resolve(here, '../drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
    path.resolve(process.cwd(), 'apps/api/drizzle'),
  ].filter(Boolean) as string[];
  const found = candidates.find((dir) => existsSync(path.join(dir, 'meta', '_journal.json')));
  if (!found) throw new Error(`No se encontró la carpeta de migraciones (buscado en: ${candidates.join(', ')})`);
  return found;
}

export async function runMigrations(db: Database) {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
