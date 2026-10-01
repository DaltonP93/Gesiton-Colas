import { asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  LEGAL_ACCEPTED_KINDS,
  LEGAL_DOCS,
  LEGAL_KINDS,
  LEGAL_TEMPLATES,
  LEGAL_VARIABLES,
  legalMissing,
  legalVars,
  renderLegal,
  type LegalAdminDTO,
  type LegalDocumentDTO,
  type LegalIndexDTO,
  type LegalKind,
  type LegalPendingDTO,
  type LegalStatusDTO,
  type LegalTenantStatusDTO,
  type LegalVersionDTO,
  type PlatformSettings,
} from '@gc/shared';
import type { Database, DbOrTx } from '../db/client';
import { legalAcceptances, legalDocuments, tenants, type LegalDocument } from '../db/schema';
import { badRequest, conflict, notFound } from './errors';
import type { PlatformSettingsStore } from './platformSettings';

type VersionRow = Pick<LegalDocument, 'id' | 'kind' | 'version' | 'createdAt' | 'requiresAcceptance' | 'note' | 'publishedByName'>;

interface Acceptor {
  tenant: { id: string; name: string };
  user: { id: string; name: string; email: string };
  ip?: string | null;
  userAgent?: string | null;
}

/** Términos, privacidad y tratamiento de datos: versiones publicadas y aceptaciones de cada organización. */
export class Legal {
  constructor(
    private readonly db: Database,
    private readonly platform: PlatformSettingsStore,
    private readonly publicUrl: string,
  ) {}

  /** Última versión de cada documento y la última que pidió una nueva aceptación. */
  private async versions(db: DbOrTx = this.db) {
    const rows: VersionRow[] = await db
      .select({
        id: legalDocuments.id,
        kind: legalDocuments.kind,
        version: legalDocuments.version,
        createdAt: legalDocuments.createdAt,
        requiresAcceptance: legalDocuments.requiresAcceptance,
        note: legalDocuments.note,
        publishedByName: legalDocuments.publishedByName,
      })
      .from(legalDocuments)
      .orderBy(desc(legalDocuments.version));
    const latest = new Map<LegalKind, VersionRow>();
    const required = new Map<LegalKind, number>();
    for (const row of rows) {
      if (!latest.has(row.kind)) latest.set(row.kind, row);
      if (row.requiresAcceptance && !required.has(row.kind)) required.set(row.kind, row.version);
    }
    return { latest, required };
  }

  private vars(settings: PlatformSettings, version?: number, date?: Date) {
    return legalVars(settings.legal.holder, { appName: settings.brand.appName, publicUrl: this.publicUrl, version, date });
  }

  /** Mayor versión aceptada de cada documento, por organización. */
  private async acceptedVersions(tenantIds?: string[]) {
    const rows = await this.db
      .select({ tenantId: legalAcceptances.tenantId, kind: legalAcceptances.kind, version: sql<number>`max(${legalAcceptances.version})`.mapWith(Number) })
      .from(legalAcceptances)
      .where(tenantIds ? inArray(legalAcceptances.tenantId, tenantIds) : undefined)
      .groupBy(legalAcceptances.tenantId, legalAcceptances.kind);
    const map = new Map<string, Map<LegalKind, number>>();
    for (const row of rows) {
      if (!row.tenantId) continue;
      if (!map.has(row.tenantId)) map.set(row.tenantId, new Map());
      map.get(row.tenantId)!.set(row.kind, row.version);
    }
    return map;
  }

  private static pendingKinds(required: Map<LegalKind, number>, accepted: Map<LegalKind, number> | undefined): LegalKind[] {
    return LEGAL_ACCEPTED_KINDS.filter((kind) => required.has(kind) && (accepted?.get(kind) ?? 0) < required.get(kind)!);
  }

  /* ------------------------------ Público ------------------------------ */

  /** Documentos publicados y si el registro pide aceptarlos. */
  async index(): Promise<LegalIndexDTO> {
    const [{ latest }, settings] = await Promise.all([this.versions(), this.platform.get()]);
    const documents = LEGAL_KINDS.flatMap((kind) => {
      const row = latest.get(kind);
      return row ? [{ kind, title: LEGAL_DOCS[kind].title, path: LEGAL_DOCS[kind].path, version: row.version, publishedAt: row.createdAt.toISOString() }] : [];
    });
    return { acceptance: settings.legal.requireAcceptance && LEGAL_ACCEPTED_KINDS.some((k) => latest.has(k)), documents };
  }

  /** Texto publicado de un documento (la versión vigente o una anterior). */
  async document(kind: LegalKind, version?: number): Promise<LegalDocumentDTO> {
    const rows = await this.db.select().from(legalDocuments).where(eq(legalDocuments.kind, kind)).orderBy(desc(legalDocuments.version));
    const row = version ? rows.find((r) => r.version === version) : rows[0];
    if (!row) throw notFound('Documento');
    return {
      kind,
      title: LEGAL_DOCS[kind].title,
      path: LEGAL_DOCS[kind].path,
      version: row.version,
      publishedAt: row.createdAt.toISOString(),
      content: row.content,
      current: row.id === rows[0]!.id,
      versions: rows.map((r) => ({ version: r.version, publishedAt: r.createdAt.toISOString(), note: r.note })),
    };
  }

  /* --------------------------- Organización --------------------------- */

  /** Documentos que la organización tiene que aceptar (nuevas versiones importantes). */
  async pendingFor(tenantId: string): Promise<LegalPendingDTO[]> {
    if (!(await this.platform.get()).legal.requireAcceptance) return [];
    const { latest, required } = await this.versions();
    if (!LEGAL_ACCEPTED_KINDS.some((k) => required.has(k))) return [];
    const accepted = (await this.acceptedVersions([tenantId])).get(tenantId);
    return Legal.pendingKinds(required, accepted).map((kind) => {
      const row = latest.get(kind)!;
      return { kind, title: LEGAL_DOCS[kind].title, path: LEGAL_DOCS[kind].path, version: row.version, note: row.note };
    });
  }

  async statusFor(tenantId: string): Promise<LegalStatusDTO> {
    const [{ latest, required }, settings, rows] = await Promise.all([
      this.versions(),
      this.platform.get(),
      this.db.select().from(legalAcceptances).where(eq(legalAcceptances.tenantId, tenantId)).orderBy(desc(legalAcceptances.version)),
    ]);
    const accepted = new Map<LegalKind, number>();
    for (const r of rows) if (!accepted.has(r.kind)) accepted.set(r.kind, r.version);
    const pending = settings.legal.requireAcceptance ? Legal.pendingKinds(required, accepted) : [];
    return {
      documents: LEGAL_KINDS.flatMap((kind) => {
        const row = latest.get(kind);
        if (!row) return [];
        const last = rows.find((r) => r.kind === kind);
        return [
          {
            kind,
            title: LEGAL_DOCS[kind].title,
            path: LEGAL_DOCS[kind].path,
            version: row.version,
            publishedAt: row.createdAt.toISOString(),
            accepted: last ? { version: last.version, acceptedAt: last.acceptedAt.toISOString(), userName: last.userName } : null,
            pending: pending.includes(kind),
          },
        ];
      }),
    };
  }

  /**
   * Registra la aceptación de las versiones vigentes. Sin `documents`, acepta todos los documentos
   * que se aceptan (registro y demo). Con `documents`, exige que sean las versiones vigentes.
   */
  async accept(input: Acceptor & { documents?: { kind: LegalKind; version: number }[] }, db: DbOrTx = this.db): Promise<{ kind: LegalKind; version: number }[]> {
    const { latest } = await this.versions(db);
    const wanted = input.documents ?? LEGAL_ACCEPTED_KINDS.filter((k) => latest.has(k)).map((kind) => ({ kind, version: latest.get(kind)!.version }));
    for (const doc of wanted) {
      const current = latest.get(doc.kind);
      if (!LEGAL_DOCS[doc.kind].accept || !current) throw badRequest(`«${LEGAL_DOCS[doc.kind].title}» no se acepta`);
      if (current.version !== doc.version) {
        throw conflict(`Se publicó una versión nueva de «${LEGAL_DOCS[doc.kind].title}». Revísela antes de aceptarla.`);
      }
    }
    if (!wanted.length) return [];
    await db
      .insert(legalAcceptances)
      .values(
        wanted.map((doc) => ({
          tenantId: input.tenant.id,
          tenantName: input.tenant.name,
          documentId: latest.get(doc.kind)!.id,
          kind: doc.kind,
          version: doc.version,
          userId: input.user.id,
          userName: input.user.name,
          userEmail: input.user.email,
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
        })),
      )
      .onConflictDoNothing();
    return wanted;
  }

  /* ----------------------------- Plataforma ----------------------------- */

  private async counts() {
    const rows = await this.db
      .select({ documentId: legalAcceptances.documentId, count: sql<number>`count(distinct ${legalAcceptances.tenantId})`.mapWith(Number) })
      .from(legalAcceptances)
      .groupBy(legalAcceptances.documentId);
    return new Map(rows.map((r) => [r.documentId, r.count]));
  }

  private static versionDTO(row: VersionRow, accepted: number): LegalVersionDTO {
    return {
      id: row.id,
      kind: row.kind,
      version: row.version,
      publishedAt: row.createdAt.toISOString(),
      publishedBy: row.publishedByName,
      requiresAcceptance: row.requiresAcceptance,
      note: row.note,
      accepted,
    };
  }

  async admin(): Promise<LegalAdminDTO> {
    const [settings, { latest }, counts, tenantStatus] = await Promise.all([this.platform.get(), this.versions(), this.counts(), this.tenants()]);
    const currentIds = [...latest.values()].map((r) => r.id);
    const sources = currentIds.length
      ? await this.db.select({ id: legalDocuments.id, source: legalDocuments.source, content: legalDocuments.content }).from(legalDocuments).where(inArray(legalDocuments.id, currentIds))
      : [];
    return {
      settings: settings.legal,
      missing: legalMissing(settings.legal.holder),
      publicUrl: this.publicUrl,
      appName: settings.brand.appName,
      documents: LEGAL_KINDS.map((kind) => {
        const row = latest.get(kind);
        const stored = row ? sources.find((s) => s.id === row.id) : undefined;
        return {
          kind,
          title: LEGAL_DOCS[kind].title,
          path: LEGAL_DOCS[kind].path,
          source: stored?.source ?? LEGAL_TEMPLATES[kind],
          template: LEGAL_TEMPLATES[kind],
          current: row ? Legal.versionDTO(row, counts.get(row.id) ?? 0) : null,
          outdated: Boolean(row && stored && renderLegal(stored.source, this.vars(settings, row.version, row.createdAt)).text !== stored.content),
        };
      }),
      pendingTenants: tenantStatus.filter((t) => t.pending.length > 0).length,
      tenants: tenantStatus.length,
    };
  }

  /** Publica una versión nueva con los datos actuales del titular. */
  async publish(input: { kind: LegalKind; source: string; requiresAcceptance: boolean; note?: string | null; user: { id: string; name: string } }): Promise<LegalVersionDTO> {
    const settings = await this.platform.get();
    const missing = legalMissing(settings.legal.holder);
    if (missing.length) throw badRequest(`Complete los datos del titular antes de publicar: ${missing.join(', ')}.`);
    const source = input.source.replace(/\r\n/g, '\n').trim() + '\n';
    if (source.trim().length < 20) throw badRequest('El documento está vacío');
    const { unknown } = renderLegal(source, this.vars(settings, 0, new Date()));
    if (unknown.length) {
      throw badRequest(`Variable desconocida: ${unknown.map((u) => `{{${u}}}`).join(', ')}. Puede usar: ${LEGAL_VARIABLES.map((v) => `{{${v.key}}}`).join(', ')}.`);
    }
    const requiresAcceptance = LEGAL_DOCS[input.kind].accept && input.requiresAcceptance;
    const row = await this.db.transaction(async (tx) => {
      // Dos publicaciones a la vez no pueden tomar el mismo número de versión.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('legal_documents'))`);
      const [last] = await tx.select({ version: legalDocuments.version }).from(legalDocuments).where(eq(legalDocuments.kind, input.kind)).orderBy(desc(legalDocuments.version)).limit(1);
      const version = (last?.version ?? 0) + 1;
      const now = new Date();
      const [created] = await tx
        .insert(legalDocuments)
        .values({
          kind: input.kind,
          version,
          source,
          content: renderLegal(source, this.vars(settings, version, now)).text,
          requiresAcceptance,
          note: input.note?.trim() || null,
          publishedBy: input.user.id,
          publishedByName: input.user.name,
          createdAt: now,
        })
        .returning();
      return created!;
    });
    return Legal.versionDTO(row, 0);
  }

  async history(kind: LegalKind): Promise<LegalVersionDTO[]> {
    const [rows, counts] = await Promise.all([
      this.db
        .select({
          id: legalDocuments.id,
          kind: legalDocuments.kind,
          version: legalDocuments.version,
          createdAt: legalDocuments.createdAt,
          requiresAcceptance: legalDocuments.requiresAcceptance,
          note: legalDocuments.note,
          publishedByName: legalDocuments.publishedByName,
        })
        .from(legalDocuments)
        .where(eq(legalDocuments.kind, kind))
        .orderBy(desc(legalDocuments.version)),
      this.counts(),
    ]);
    return rows.map((r) => Legal.versionDTO(r, counts.get(r.id) ?? 0));
  }

  /** Qué aceptó cada organización y qué le falta. */
  async tenants(): Promise<LegalTenantStatusDTO[]> {
    const [settings, { required }, orgs, rows] = await Promise.all([
      this.platform.get(),
      this.versions(),
      this.db.select({ id: tenants.id, name: tenants.name, slug: tenants.slug, isDemo: tenants.isDemo, status: tenants.status }).from(tenants).orderBy(asc(tenants.name)),
      this.db
        .select()
        .from(legalAcceptances)
        .where(isNotNull(legalAcceptances.tenantId))
        .orderBy(desc(legalAcceptances.version), desc(legalAcceptances.acceptedAt)),
    ]);
    const byTenant = new Map<string, LegalTenantStatusDTO['accepted']>();
    const versions = new Map<string, Map<LegalKind, number>>();
    for (const r of rows) {
      const id = r.tenantId!;
      if (!byTenant.has(id)) {
        byTenant.set(id, {});
        versions.set(id, new Map());
      }
      const accepted = byTenant.get(id)!;
      if (accepted[r.kind]) continue;
      accepted[r.kind] = { version: r.version, acceptedAt: r.acceptedAt.toISOString(), userName: r.userName, userEmail: r.userEmail, ip: r.ip };
      versions.get(id)!.set(r.kind, r.version);
    }
    return orgs.map((tenant) => ({
      tenant,
      accepted: byTenant.get(tenant.id) ?? {},
      pending: settings.legal.requireAcceptance ? Legal.pendingKinds(required, versions.get(tenant.id)) : [],
    }));
  }
}
