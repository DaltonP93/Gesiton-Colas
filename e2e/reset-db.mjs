// Vacía la base de datos descartable de la prueba E2E antes de iniciar la API
// (la API aplica las migraciones al arrancar).
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url || !/e2e|test/.test(url)) {
  console.error('reset-db: DATABASE_URL debe apuntar a una base de pruebas (su nombre debe contener "e2e" o "test")');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
await client.end();
