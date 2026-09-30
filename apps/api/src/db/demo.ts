import { eq } from 'drizzle-orm';
import { SURVEY_TEMPLATES, formatTicketCode, scoreAnswers, type SurveyAnswers } from '@gc/shared';
import type { DbOrTx } from './client';
import { createTenantWithDefaults, slugify } from './seed';
import {
  branchServices,
  counters,
  departments,
  displays,
  kiosks,
  media,
  playlistItems,
  priorities,
  services,
  surveyResponses,
  surveys,
  tickets,
  users,
} from './schema';
import { hashPassword } from '../lib/auth';
import { randomToken } from '../lib/crypto';
import { dayInTimezone } from '../lib/tz';
import { issueTicket } from '../modules/tickets/queue';

const CUSTOMERS = [
  'María López', 'Juan Pérez', 'Carlos Gómez', 'Lucía Fernández', 'Pedro Ruiz', 'Ana Torres', 'Sofía Díaz', 'Diego Castro',
  'Laura Méndez', 'Jorge Silva', 'Valentina Rojas', 'Mateo Benítez', 'Camila Duarte', 'Martín Acosta', 'Florencia Vera', 'Gabriel Ortiz',
];

/** Diferencia (ms) entre la hora local de una zona y UTC para un instante dado. */
function tzOffsetMs(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant.getTime();
}

/** Convierte una fecha y hora locales de una zona horaria a un instante UTC. */
export function localToUtc(day: string, minutes: number, timezone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  return new Date(guess - tzOffsetMs(new Date(guess), timezone));
}

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;
const between = (min: number, max: number) => min + Math.random() * (max - min);

export interface DemoInput {
  email: string;
  name: string;
  organizationName?: string;
  timezone?: string;
  days: number;
}

/**
 * Organización de demostración con datos de ejemplo: servicios, operadores, publicidad,
 * turnos en espera y una semana de historial para que los reportes tengan contenido.
 */
export async function createDemoOrganization(db: DbOrTx, input: DemoInput) {
  const organizationName = input.organizationName?.trim() || `Demo de ${input.name.split(' ')[0] || 'su organización'}`;
  const { tenant, admin, branch, services: baseServices, playlistId } = await createTenantWithDefaults(db, {
    organizationName,
    adminName: input.name,
    adminEmail: input.email,
    adminPassword: null,
    timezone: input.timezone,
    plan: 'pro',
    demoDays: input.days,
    // La demo ya viene configurada: no se ofrece el asistente inicial.
    settings: { onboarding: { completed: true, dismissed: false, industry: 'demo' } },
  });
  const tenantId = tenant.id;
  const timezone = tenant.settings.timezone;

  // Un servicio y departamento extra para mostrar la agrupación.
  const [dept] = await db.insert(departments).values({ tenantId, name: 'Trámites', sortOrder: 1 }).returning();
  const [extra] = await db
    .insert(services)
    .values({ tenantId, departmentId: dept!.id, name: 'Informes y trámites', prefix: 'T', color: '#7c3aed', icon: 'file', sortOrder: 2, estimatedMinutes: 8 })
    .returning();
  await db.insert(branchServices).values({ tenantId, branchId: branch.id, serviceId: extra!.id, enabled: true });
  const allServices = [...baseServices, extra!];

  // Operadores de ejemplo (sin contraseña: solo para el historial).
  const slug = slugify(tenant.slug);
  const agentNames = ['Laura Operadora', 'Martín Operador'];
  const agentHashes = await Promise.all(agentNames.map(() => hashPassword(randomToken(32))));
  const agents = await db
    .insert(users)
    .values(
      agentNames.map((name, i) => ({
        tenantId,
        email: `operador${i + 1}+${slug}-${randomToken(4).toLowerCase()}@demo.gestioncolas.local`,
        passwordHash: agentHashes[i]!,
        hasPassword: false,
        emailVerifiedAt: new Date(),
        name,
        role: 'agent' as const,
      })),
    )
    .returning();

  const branchCounters = await db.select().from(counters).where(eq(counters.branchId, branch.id));
  const prios = await db.select().from(priorities).where(eq(priorities.tenantId, tenantId));
  const normal = prios.find((p) => p.weight === 0)!;
  const preferential = prios.find((p) => p.weight > 0) ?? normal;

  // Historial de los últimos 7 días.
  const history: (typeof tickets.$inferInsert)[] = [];
  for (let back = 7; back >= 1; back--) {
    const day = dayInTimezone(new Date(Date.now() - back * 24 * 3600 * 1000), timezone);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday === 0) continue; // domingo cerrado
    const count = weekday === 6 ? 12 : Math.round(between(22, 38));
    const perService = new Map<string, number>();
    const times = Array.from({ length: count }, () => Math.round(between(8 * 60, 17 * 60))).sort((a, b) => a - b);
    for (const minute of times) {
      const service = Math.random() < 0.5 ? allServices[0]! : pick(allServices);
      const number = (perService.get(service.id) ?? 0) + 1;
      perService.set(service.id, number);
      const createdAt = localToUtc(day, minute, timezone);
      const calledAt = new Date(createdAt.getTime() + between(2, 22) * 60_000);
      const roll = Math.random();
      const status = roll < 0.06 ? 'no_show' : roll < 0.1 ? 'cancelled' : 'finished';
      const startedAt = status === 'finished' ? new Date(calledAt.getTime() + between(0.3, 1.5) * 60_000) : null;
      const finishedAt =
        status === 'finished' ? new Date(startedAt!.getTime() + between(3, service.estimatedMinutes * 2) * 60_000) : new Date(calledAt.getTime() + 90_000);
      history.push({
        tenantId,
        branchId: branch.id,
        serviceId: service.id,
        priorityId: Math.random() < 0.15 ? preferential.id : normal.id,
        number,
        code: formatTicketCode(service.prefix, number, tenant.settings.tickets.digits),
        status,
        channel: pick(['kiosk', 'kiosk', 'mobile', 'agent', 'api'] as const),
        customer: { name: pick(CUSTOMERS) },
        counterId: status === 'cancelled' ? null : pick(branchCounters).id,
        agentId: status === 'cancelled' ? null : pick(agents).id,
        callCount: status === 'no_show' ? 3 : 1,
        publicToken: randomToken(20),
        serviceDay: day,
        createdAt,
        calledAt: status === 'cancelled' ? null : calledAt,
        startedAt,
        finishedAt,
      });
    }
  }
  const inserted: (typeof tickets.$inferSelect)[] = [];
  for (let i = 0; i < history.length; i += 100) inserted.push(...(await db.insert(tickets).values(history.slice(i, i + 100)).returning()));

  // Encuesta de satisfacción con respuestas de ejemplo (casi la mitad de los atendidos responde).
  const template = SURVEY_TEMPLATES[0]!.body;
  const [survey] = await db.insert(surveys).values({ tenantId, ...template, thanks: '¡Gracias por su opinión! Nos ayuda a mejorar.', publicToken: randomToken(20) }).returning();
  const POSITIVE = ['Muy amables, gracias', 'Rápido y ordenado', 'Excelente atención de la señorita', 'Todo muy claro', 'Me atendieron enseguida'];
  const NEGATIVE = ['La espera fue larga', 'Faltan asientos en la sala', 'No se escuchaba el llamado', 'Deberían abrir más ventanillas'];
  const responses = inserted
    .filter((t) => t.status === 'finished' && Math.random() < 0.45)
    .map((t) => {
      const roll = Math.random();
      const rating = roll < 0.45 ? 5 : roll < 0.75 ? 4 : roll < 0.88 ? 3 : roll < 0.95 ? 2 : 1;
      const nps = Math.max(0, Math.min(10, Math.round(rating >= 5 ? between(8.6, 10.4) : rating === 4 ? between(6.5, 9.4) : rating === 3 ? between(4.5, 8) : between(0, 5))));
      const answers: SurveyAnswers = { atencion: rating, recomienda: nps };
      if (Math.random() < 0.35) answers.mejorar = rating >= 4 ? pick(POSITIVE) : pick(NEGATIVE);
      return {
        tenantId,
        surveyId: survey!.id,
        ticketId: t.id,
        branchId: t.branchId,
        serviceId: t.serviceId,
        agentId: t.agentId,
        counterId: t.counterId,
        channel: 'ticket' as const,
        answers,
        ...scoreAnswers(template.questions, answers),
        createdAt: new Date((t.finishedAt ?? t.createdAt).getTime() + between(2, 90) * 60_000),
      };
    });
  for (let i = 0; i < responses.length; i += 100) await db.insert(surveyResponses).values(responses.slice(i, i + 100));

  const noop = { db, publishTicket: () => undefined };

  // Atendidos hoy: el panel TV, el monitor y el resumen muestran actividad desde el primer momento.
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const { ticket } = await issueTicket(noop, {
      tenantId,
      branchId: branch.id,
      serviceId: allServices[i % allServices.length]!.id,
      priorityId: null,
      customer: { name: pick(CUSTOMERS) },
      channel: i % 2 ? 'mobile' : 'kiosk',
    });
    const calledAt = new Date(now - (55 - i * 11) * 60_000);
    const startedAt = new Date(calledAt.getTime() + 40_000);
    await db
      .update(tickets)
      .set({
        status: 'finished',
        createdAt: new Date(calledAt.getTime() - between(3, 12) * 60_000),
        calledAt,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + between(3, 8) * 60_000),
        counterId: branchCounters[i % branchCounters.length]!.id,
        agentId: agents[i % agents.length]!.id,
        callCount: 1,
      })
      .where(eq(tickets.id, ticket.id));
  }

  // Turnos en espera hoy (la cola que se ve al entrar).
  for (let i = 0; i < 6; i++) {
    await issueTicket(noop, {
      tenantId,
      branchId: branch.id,
      serviceId: allServices[i % allServices.length]!.id,
      priorityId: i === 2 ? preferential.id : null,
      customer: { name: CUSTOMERS[i]! },
      channel: i % 2 ? 'mobile' : 'kiosk',
    });
  }

  // Publicidad de ejemplo y cintillo.
  const promos = await db
    .insert(media)
    .values([
      { tenantId, name: 'Promoción del mes', kind: 'text' as const, provider: 'text' as const, url: '', duration: 10, text: { content: 'Pague sus servicios sin filas', subtitle: 'Saque su turno desde el celular escaneando el QR de la entrada', background: '#7c3aed', color: '#ffffff' } },
      { tenantId, name: 'Horarios', kind: 'text' as const, provider: 'text' as const, url: '', duration: 8, text: { content: 'Lunes a viernes de 8 a 18 h', subtitle: 'Sábados de 8 a 12 h', background: '#0f766e', color: '#ffffff' } },
      { tenantId, name: 'Encuesta', kind: 'text' as const, provider: 'text' as const, url: '', duration: 8, text: { content: '¿Cómo fue su atención?', subtitle: 'Cuéntenos su experiencia en recepción', background: '#b45309', color: '#ffffff' } },
    ])
    .returning();
  await db.insert(playlistItems).values(promos.map((m, i) => ({ playlistId, mediaId: m.id, position: i + 1 })));

  const [display] = await db.select().from(displays).where(eq(displays.tenantId, tenantId));
  if (display) {
    await db
      .update(displays)
      .set({
        config: {
          ...display.config,
          ticker: { ...display.config.ticker, enabled: true, messages: [`Bienvenidos a ${organizationName}`, 'Tenga su documento a mano', 'Puede seguir su turno desde el celular'] },
        },
      })
      .where(eq(displays.id, display.id));
  }
  const [kiosk] = await db.select().from(kiosks).where(eq(kiosks.tenantId, tenantId));
  if (kiosk) {
    await db
      .update(kiosks)
      .set({ config: { ...kiosk.config, askFields: ['name'], groupByDepartment: true } })
      .where(eq(kiosks.id, kiosk.id));
  }

  return { tenant, admin };
}
