/**
 * Tareas de mantenimiento por consola (recuperar el acceso a la plataforma).
 *
 *   Crear un superadministrador o restablecer su contraseña:
 *     node apps/api/dist/db/admin-cli.js superadmin correo@empresa.com [contraseña]
 *   Con Docker:
 *     docker compose exec app node apps/api/dist/db/admin-cli.js superadmin correo@empresa.com
 *
 * Sin contraseña se genera una al azar y se muestra una sola vez.
 */
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config';
import { hashPassword, sessionsResetNow } from '../lib/auth';
import { randomToken } from '../lib/crypto';
import { createDatabase } from './client';
import { runMigrations } from './migrate';
import { users } from './schema';

const [command, rawEmail, rawPassword] = process.argv.slice(2);

function usage(): never {
  console.log('Uso: admin-cli superadmin <correo> [contraseña]');
  process.exit(1);
}

if (command !== 'superadmin' || !rawEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) usage();
if (rawPassword !== undefined && rawPassword.length < 8) {
  console.error('La contraseña debe tener al menos 8 caracteres.');
  process.exit(1);
}

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL, 1);
await runMigrations(db);

const email = rawEmail.toLowerCase().trim();
const password = rawPassword ?? randomToken(14);
const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

if (existing && existing.role !== 'superadmin') {
  console.error(`${email} pertenece a un usuario de una organización; use otro correo para el superadministrador.`);
  await pool.end();
  process.exit(1);
}

const secret = {
  passwordHash: await hashPassword(password),
  hasPassword: true,
  invitePending: false,
  active: true,
  emailVerifiedAt: new Date(),
  sessionsValidAfter: sessionsResetNow(),
};
if (existing) {
  await db.update(users).set(secret).where(eq(users.id, existing.id));
  console.log(`✔ Se restableció la contraseña de ${email}.`);
} else {
  await db.insert(users).values({ tenantId: null, email, name: 'Administrador de plataforma', role: 'superadmin', ...secret });
  console.log(`✔ Superadministrador creado: ${email}`);
}
if (!rawPassword) console.log(`  Contraseña: ${password}  (cámbiela al ingresar)`);
await pool.end();
