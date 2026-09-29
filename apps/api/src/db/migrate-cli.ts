import { loadConfig } from '../config';
import { createDatabase } from './client';
import { runMigrations } from './migrate';

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL, 1);
await runMigrations(db);
console.log('✔ Migraciones aplicadas');
await pool.end();
