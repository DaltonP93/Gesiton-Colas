import { eq } from 'drizzle-orm';
import {
  defaultDisplayConfig,
  defaultKioskConfig,
  deepMerge,
  tenantSettingsSchema,
  type Locale,
  type PlanId,
  type TenantSettings,
} from '@gc/shared';
import type { AppContext } from '../context';
import type { DbOrTx } from './client';
import {
  branches,
  branchServices,
  counters,
  departments,
  displays,
  kiosks,
  media,
  playlistItems,
  playlists,
  priorities,
  services,
  tenants,
  users,
} from './schema';
import { hashPassword } from '../lib/auth';
import { randomToken } from '../lib/crypto';
import { isValidTimezone } from '../lib/tz';

export function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org'
  );
}

async function uniqueSlug(db: DbOrTx, base: string) {
  let slug = slugify(base);
  for (let i = 0; i < 5; i++) {
    const [taken] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (!taken) return slug;
    slug = `${slugify(base).slice(0, 33)}-${randomToken(6).toLowerCase()}`;
  }
  return `${slugify(base).slice(0, 30)}-${randomToken(10).toLowerCase()}`;
}

export interface NewTenantInput {
  organizationName: string;
  adminName: string;
  adminEmail: string;
  /** Sin contraseña: la cuenta ingresa por enlace/código de correo hasta definir una. */
  adminPassword?: string | null;
  /** El correo ya fue verificado (p. ej. alta hecha por el superadministrador). */
  emailVerified?: boolean;
  /** Crea una organización de demostración que vence en N días. */
  demoDays?: number;
  timezone?: string;
  locale?: Locale;
  plan?: PlanId;
  settings?: Partial<TenantSettings>;
}

/**
 * Crea una organización lista para usar: sucursal, prioridades, servicios, puestos,
 * una pantalla con contenido de bienvenida y un kiosco.
 */
export async function createTenantWithDefaults(db: DbOrTx, input: NewTenantInput) {
  const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : 'UTC';
  const settings = tenantSettingsSchema.parse(
    deepMerge({ locale: input.locale ?? 'es', timezone, branding: { appName: input.organizationName } }, input.settings ?? {}),
  );

  const slug = await uniqueSlug(db, input.organizationName);
  const [tenant] = await db
    .insert(tenants)
    .values({
      slug,
      name: input.organizationName,
      plan: input.plan ?? 'free',
      settings,
      isDemo: Boolean(input.demoDays),
      demoExpiresAt: input.demoDays ? new Date(Date.now() + input.demoDays * 24 * 3600 * 1000) : null,
    })
    .returning();
  const tenantId = tenant!.id;

  const [admin] = await db
    .insert(users)
    .values({
      tenantId,
      email: input.adminEmail.toLowerCase().trim(),
      passwordHash: await hashPassword(input.adminPassword || randomToken(32)),
      hasPassword: Boolean(input.adminPassword),
      emailVerifiedAt: input.emailVerified ? new Date() : null,
      name: input.adminName,
      role: 'admin',
    })
    .returning();

  const [branch] = await db.insert(branches).values({ tenantId, name: 'Casa central', code: '001' }).returning();
  const branchId = branch!.id;

  await db.insert(priorities).values([
    { tenantId, name: 'Normal', description: 'Atención general', weight: 0, color: '#64748b', sortOrder: 0 },
    {
      tenantId,
      name: 'Preferencial',
      description: 'Adultos mayores, embarazadas y personas con discapacidad',
      weight: 1,
      color: '#f59e0b',
      sortOrder: 1,
    },
  ]);

  const [dept] = await db.insert(departments).values({ tenantId, name: 'General' }).returning();
  const createdServices = await db
    .insert(services)
    .values([
      { tenantId, departmentId: dept!.id, name: 'Atención al cliente', prefix: 'A', color: '#2563eb', icon: 'users', sortOrder: 0 },
      { tenantId, departmentId: dept!.id, name: 'Caja', prefix: 'C', color: '#16a34a', icon: 'wallet', sortOrder: 1 },
    ])
    .returning();
  await db
    .insert(branchServices)
    .values(createdServices.map((s) => ({ tenantId, branchId, serviceId: s.id, enabled: true })));

  await db.insert(counters).values(
    [1, 2, 3].map((n) => ({ tenantId, branchId, name: `${settings.terminology.counter} ${n}`, sortOrder: n })),
  );

  const [welcome] = await db
    .insert(media)
    .values({
      tenantId,
      name: 'Bienvenida',
      kind: 'text',
      provider: 'text',
      url: '',
      duration: 12,
      text: {
        content: `Bienvenidos a ${input.organizationName}`,
        subtitle: 'Por favor, aguarde a ser llamado',
        background: '#1e3a8a',
        color: '#ffffff',
      },
    })
    .returning();
  const [playlist] = await db
    .insert(playlists)
    .values({ tenantId, name: 'Contenido principal', description: 'Publicidad y anuncios de la sala de espera' })
    .returning();
  await db.insert(playlistItems).values({ playlistId: playlist!.id, mediaId: welcome!.id, position: 0 });

  await db.insert(displays).values({
    tenantId,
    branchId,
    name: 'Pantalla principal',
    token: randomToken(24),
    config: defaultDisplayConfig(),
    playlistId: playlist!.id,
  });
  await db.insert(kiosks).values({
    tenantId,
    branchId,
    name: 'Kiosco de entrada',
    token: randomToken(24),
    config: defaultKioskConfig(),
  });

  return { tenant: tenant!, admin: admin!, branch: branch!, services: createdServices, playlistId: playlist!.id };
}

/**
 * Crea el primer superadministrador a partir de SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD.
 * Si ya hay alguno (p. ej. se cambió el correo desde el panel), no crea otro: los demás
 * se administran en Plataforma → Superadministradores, o con `admin-cli` si se perdió el acceso.
 */
export async function ensureSuperadmin(ctx: Pick<AppContext, 'config' | 'db' | 'log'>) {
  const { SUPERADMIN_EMAIL: email, SUPERADMIN_PASSWORD: password } = ctx.config;
  if (!email || !password) return;
  const normalized = email.toLowerCase().trim();
  const [existing] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, normalized)).limit(1);
  if (existing) return;
  const [anySuperadmin] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.role, 'superadmin')).limit(1);
  if (anySuperadmin) return;
  await ctx.db.insert(users).values({
    tenantId: null,
    email: normalized,
    passwordHash: await hashPassword(password),
    name: 'Administrador de plataforma',
    role: 'superadmin',
    emailVerifiedAt: new Date(),
  });
  ctx.log.info({ email: normalized }, 'Superadministrador creado');
}
