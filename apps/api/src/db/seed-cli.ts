/**
 * Crea una organización de demostración:
 *   npm run db:seed
 *   → demo@gestioncolas.local / demo1234
 */
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config';
import { createDatabase } from './client';
import { runMigrations } from './migrate';
import { users } from './schema';
import { createTenantWithDefaults } from './seed';

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL, 1);
await runMigrations(db);

const email = process.env.DEMO_EMAIL ?? 'demo@gestioncolas.local';
const password = process.env.DEMO_PASSWORD ?? 'demo1234';
const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
if (exists) {
  console.log(`La organización demo ya existe (${email}).`);
} else {
  const { tenant } = await createTenantWithDefaults(db, {
    organizationName: process.env.DEMO_ORGANIZATION ?? 'Organización Demo',
    adminName: 'Administrador Demo',
    adminEmail: email,
    adminPassword: password,
    timezone: process.env.DEMO_TIMEZONE ?? 'America/Asuncion',
    plan: 'pro',
  });
  console.log(`✔ Organización demo creada: ${tenant.name} (${tenant.slug})`);
  console.log(`  Usuario: ${email}  Contraseña: ${password}`);
}
await pool.end();
