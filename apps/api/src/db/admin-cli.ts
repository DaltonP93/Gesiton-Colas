/**
 * Tareas de mantenimiento por consola.
 *
 *   Crear un superadministrador o restablecer su contraseña:
 *     node apps/api/dist/db/admin-cli.js superadmin correo@empresa.com [contraseña]
 *   Con Docker:
 *     docker compose exec app node apps/api/dist/db/admin-cli.js superadmin correo@empresa.com
 *   Sin contraseña se genera una al azar y se muestra una sola vez.
 *
 *   Copia de seguridad ahora / restaurar una copia (con la aplicación detenida):
 *     node apps/api/dist/db/admin-cli.js backup
 *     node apps/api/dist/db/admin-cli.js restore /data/backups/<archivo>.tar.gz --confirm
 *   Antes de restaurar se guarda una copia de lo actual (…-previa.tar.gz), salvo con --sin-copia-previa.
 */
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config';
import { hashPassword, sessionsResetNow } from '../lib/auth';
import { backupDir, createBackupArchive, restoreBackupArchive } from '../lib/backups';
import { randomToken } from '../lib/crypto';
import { createDatabase } from './client';
import { runMigrations } from './migrate';
import { users } from './schema';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [command, rawEmail, rawPassword] = args.filter((a) => !a.startsWith('--'));

function usage(): never {
  console.log('Uso:\n  admin-cli superadmin <correo> [contraseña]\n  admin-cli backup\n  admin-cli restore <archivo.tar.gz> --confirm [--sin-copia-previa]');
  process.exit(1);
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

if (command === 'backup') {
  const config = loadConfig();
  const dir = backupDir(config);
  const { file, size } = await createBackupArchive(config, { includeUploads: true, dir });
  console.log(`✔ Copia creada: ${dir}/${file} (${mb(size)})`);
  process.exit(0);
}

if (command === 'restore') {
  const archive = rawEmail;
  if (!archive) usage();
  if (!existsSync(archive)) {
    console.error(`No existe el archivo ${archive}`);
    process.exit(1);
  }
  if (!flags.has('--confirm')) {
    console.error('Restaurar REEMPLAZA todos los datos actuales por los de la copia.');
    console.error('Detenga la aplicación y repita el comando agregando --confirm.');
    process.exit(1);
  }
  const config = loadConfig();
  try {
    if (!flags.has('--sin-copia-previa')) {
      const { file } = await createBackupArchive(config, { includeUploads: true, dir: backupDir(config), suffix: 'previa' });
      console.log(`✔ Copia de lo actual guardada por las dudas: ${backupDir(config)}/${file}`);
    }
    await restoreBackupArchive(config, archive);
    const { db, pool } = createDatabase(config.DATABASE_URL, 1);
    await runMigrations(db);
    await pool.end();
    console.log('✔ Copia restaurada. Inicie la aplicación.');
    process.exit(0);
  } catch (error) {
    console.error(`✘ No se pudo restaurar: ${error instanceof Error ? error.message : String(error)}`);
    console.error('  La base quedó como estaba (la restauración se hace en una sola transacción).');
    process.exit(1);
  }
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
