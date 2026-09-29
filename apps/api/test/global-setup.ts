import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/db/migrate';

/** Recrea el esquema de la base de pruebas y aplica las migraciones. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://gc:gc@127.0.0.1:5432/gestion_colas_test';
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await runMigrations(drizzle(pool));
  await pool.end();
}
