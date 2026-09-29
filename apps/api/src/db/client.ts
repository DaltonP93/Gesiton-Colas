import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** Transacción o base de datos: las funciones de dominio aceptan ambos. */
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export function createDatabase(url: string, max = 10) {
  const pool = new pg.Pool({ connectionString: url, max });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };
