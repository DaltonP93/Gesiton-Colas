import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, FilePen, FileSignature, History, RotateCcw, Scale } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  LEGAL_DOCS,
  LEGAL_VARIABLES,
  formatLegalDate,
  legalVars,
  renderLegal,
  type LegalAdminDTO,
  type LegalHolder,
  type LegalTenantStatusDTO,
  type LegalVersionDTO,
} from '@gc/shared';
import { Markdown } from '../../components/Markdown';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Loading, Modal, Table, Tabs, Textarea, Toggle, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';

type Doc = LegalAdminDTO['documents'][number];
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Plataforma → Legal: titular del software, términos, privacidad, tratamiento de datos y aceptaciones. */
export function LegalTab() {
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const admin = useQuery({ queryKey: ['platform', 'legal'], queryFn: () => api.get<LegalAdminDTO>('/platform/legal') });
  const [holder, setHolder] = useState<LegalHolder | null>(null);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [history, setHistory] = useState<Doc | null>(null);
  useEffect(() => {
    if (admin.data && !holder) setHolder(admin.data.settings.holder);
  }, [admin.data, holder]);

  const save = useMutation({
    mutationFn: (body: { holder?: LegalHolder; requireAcceptance?: boolean }) => api.put<LegalAdminDTO>('/platform/legal/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(['platform', 'legal'], data);
      setHolder(data.settings.holder);
      void qc.invalidateQueries({ queryKey: ['public-config'] });
      toast('Datos legales guardados');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (admin.isLoading || !holder) return <Loading />;
  if (admin.isError || !admin.data) return <p className="text-sm text-red-600">{errorMessage(admin.error)}</p>;
  const data = admin.data;
  const dirty = !sameJson(holder, data.settings.holder);
  const set = <K extends keyof LegalHolder>(k: K, v: LegalHolder[K]) => setHolder((h) => (h ? { ...h, [k]: v } : h));
  const outdated = data.documents.filter((d) => d.outdated);

  return (
    <div className="space-y-6">
      <div className="flex gap-3 rounded-ui border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <p>
          Las plantillas son una base redactada para Paraguay (servicio en la nube e instalación propia). <strong>Revíselas con un abogado</strong> antes de publicarlas
          o de firmar contratos: cada negocio tiene condiciones propias de precio, soporte, responsabilidad y datos personales.
        </p>
      </div>

      <Card title="Titular del software" description="Quién presta el servicio y otorga la licencia. Estos datos completan los documentos al publicarlos.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Razón social o nombre">
            <Input value={holder.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej.: Soluciones de Turnos S.A." />
          </Field>
          <Field label="RUC">
            <Input value={holder.taxId} onChange={(e) => set('taxId', e.target.value)} placeholder="80012345-6" />
          </Field>
          <Field label="Domicilio" className="md:col-span-2">
            <Input value={holder.address} onChange={(e) => set('address', e.target.value)} placeholder="Calle, número, ciudad" />
          </Field>
          <Field label="Correo de contacto" hint="Soporte, avisos legales y pedidos sobre datos personales.">
            <Input type="email" value={holder.email} onChange={(e) => set('email', e.target.value)} placeholder="legal@empresa.com.py" />
          </Field>
          <Field label="Ciudad de la jurisdicción" hint="Tribunales competentes ante un conflicto.">
            <Input value={holder.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="Dirección del sitio" hint={`Vacío = ${data.publicUrl}`}>
            <Input value={holder.website} onChange={(e) => set('website', e.target.value)} placeholder={data.publicUrl} />
          </Field>
          <Field label="Disponibilidad comprometida" hint="Porcentaje mensual (ej.: 99,5 %).">
            <Input value={holder.availability} onChange={(e) => set('availability', e.target.value)} />
          </Field>
          <Field label="Horario de soporte" className="md:col-span-2">
            <Input value={holder.supportHours} onChange={(e) => set('supportHours', e.target.value)} />
          </Field>
          <Field label="Días para exportar los datos al terminar" hint="Después se borran los datos de la organización.">
            <Input type="number" min={7} max={365} value={holder.exportDays} onChange={(e) => set('exportDays', Number(e.target.value) || 30)} />
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          <Toggle
            checked={data.settings.requireAcceptance}
            onChange={(v) => save.mutate({ requireAcceptance: v })}
            label="Pedir que cada organización acepte los términos"
            hint="Casilla obligatoria al registrarse o pedir la demo, y aviso al administrador en cada versión importante."
          />
          <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate({ holder })}>
            Guardar datos del titular
          </Button>
        </div>
      </Card>

      <Card
        title="Documentos publicados"
        description="Cada publicación crea una versión nueva que no se modifica: queda como constancia de lo que aceptó cada organización."
        actions={
          data.tenants > 0 && data.documents.some((d) => d.current) ? (
            <Badge color={data.pendingTenants ? '#d97706' : '#059669'}>
              {data.pendingTenants ? `${data.pendingTenants} de ${data.tenants} organizaciones con aceptación pendiente` : 'Todas las organizaciones aceptaron'}
            </Badge>
          ) : undefined
        }
      >
        {data.missing.length > 0 && (
          <p className="mb-4 rounded-ui bg-subtle px-3 py-2 text-sm text-muted">Para publicar, complete y guarde: {data.missing.join(', ')}.</p>
        )}
        {outdated.length > 0 && (
          <p className="mb-4 rounded-ui bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Cambiaron los datos del titular después de publicar {outdated.map((d) => `«${LEGAL_DOCS[d.kind].short}»`).join(', ')}. Publique una versión nueva para que
            el texto los incluya (sin pedir nueva aceptación, si el contenido no cambió).
          </p>
        )}
        <div className="divide-y divide-border">
          {data.documents.map((d) => (
            <div key={d.kind} className="flex flex-wrap items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {d.title}
                  {d.outdated && <Badge className="ml-2" color="#d97706">Datos desactualizados</Badge>}
                </p>
                <p className="text-xs text-muted">
                  {d.current ? (
                    <>
                      Versión {d.current.version} del {formatLegalDate(d.current.publishedAt)}
                      {d.current.publishedBy && ` por ${d.current.publishedBy}`}
                      {LEGAL_DOCS[d.kind].accept && ` · aceptada por ${d.current.accepted} ${d.current.accepted === 1 ? 'organización' : 'organizaciones'}`}
                      {' · '}
                      <a href={d.path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        {d.path} <ExternalLink className="size-3" />
                      </a>
                    </>
                  ) : (
                    'Sin publicar'
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                {d.current && (
                  <Button variant="ghost" size="sm" icon={<History className="size-4" />} onClick={() => setHistory(d)}>
                    Versiones
                  </Button>
                )}
                <Button variant={d.current ? 'secondary' : 'primary'} size="sm" icon={<FilePen className="size-4" />} onClick={() => setEditing(d)}>
                  {d.current ? 'Editar y publicar' : 'Revisar y publicar'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <AcceptancesCard />

      <Card title="Contrato de licencia (instalación propia)" description="Para clientes que instalan el sistema en sus servidores: se completa con los datos del licenciatario, se imprime y se firma.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted">
            Incluye el alcance de la licencia, restricciones, mantenimiento, datos personales, garantía y el Anexo I con módulos, precio y plazo.
          </p>
          <Link to="/plataforma/contrato-de-licencia">
            <Button variant="secondary" icon={<FileSignature className="size-4" />}>
              Preparar contrato
            </Button>
          </Link>
        </div>
      </Card>

      {editing && <EditorModal doc={editing} data={data} holder={data.settings.holder} onClose={() => setEditing(null)} />}
      {history && <HistoryModal doc={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function EditorModal({ doc, data, holder, onClose }: { doc: Doc; data: LegalAdminDTO; holder: LegalHolder; onClose: () => void }) {
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const [source, setSource] = useState(doc.source);
  const [view, setView] = useState<'text' | 'preview'>('preview');
  const [note, setNote] = useState('');
  const accept = LEGAL_DOCS[doc.kind].accept;
  const [requiresAcceptance, setRequiresAcceptance] = useState(true);
  const area = useRef<HTMLTextAreaElement>(null);
  const next = (doc.current?.version ?? 0) + 1;
  const vars = useMemo(() => legalVars(holder, { appName: data.appName, publicUrl: data.publicUrl, version: next, date: new Date() }), [holder, data.appName, data.publicUrl, next]);
  const preview = useMemo(() => renderLegal(source, vars), [source, vars]);
  const changed = source !== doc.source;

  const publish = useMutation({
    mutationFn: () => api.post<LegalVersionDTO>(`/platform/legal/${doc.kind}/publish`, { source, requiresAcceptance: accept && requiresAcceptance, note: note.trim() || null }),
    onSuccess: (v) => {
      toast(`Publicada la versión ${v.version} de «${doc.title}»`);
      void qc.invalidateQueries({ queryKey: ['platform', 'legal'] });
      void qc.invalidateQueries({ queryKey: ['public-config'] });
      void qc.invalidateQueries({ queryKey: ['legal'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  function insert(key: string) {
    const el = area.current;
    const token = `{{${key}}}`;
    if (!el || view !== 'text') return void navigator.clipboard?.writeText(token).then(() => toast(`${token} copiado`));
    const start = el.selectionStart ?? source.length;
    const end = el.selectionEnd ?? start;
    setSource(source.slice(0, start) + token + source.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function close() {
    if (changed && !(await confirm({ title: '¿Descartar los cambios?', message: 'El texto editado no se guardó.', confirmLabel: 'Descartar', danger: true }))) return;
    onClose();
  }

  async function onPublish() {
    const message = accept
      ? requiresAcceptance
        ? 'Los administradores de cada organización tendrán que aceptarla para seguir usando el panel.'
        : 'No se pide una nueva aceptación: las organizaciones siguen con la versión que aceptaron.'
      : 'Se publica en la página pública y reemplaza a la anterior.';
    if (await confirm({ title: `¿Publicar la versión ${next} de «${doc.title}»?`, message, confirmLabel: 'Publicar' })) publish.mutate();
  }

  return (
    <Modal
      open
      size="xl"
      onClose={() => void close()}
      title={`${doc.title} · versión ${next}`}
      description="Use las variables para los datos del titular: se completan al publicar."
      footer={
        <>
          <Button variant="ghost" icon={<RotateCcw className="size-4" />} className="mr-auto" disabled={source === doc.template} onClick={() => setSource(doc.template)}>
            Restaurar plantilla
          </Button>
          <Button variant="secondary" onClick={() => void close()}>
            Cancelar
          </Button>
          <Button loading={publish.isPending} disabled={data.missing.length > 0 || preview.unknown.length > 0} onClick={() => void onPublish()}>
            Publicar versión {next}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-3">
          <Tabs<'text' | 'preview'>
            value={view}
            onChange={setView}
            tabs={[
              { value: 'preview', label: 'Vista previa' },
              { value: 'text', label: 'Texto' },
            ]}
          />
          {preview.unknown.length > 0 && <p className="text-sm text-red-600">Variables desconocidas: {preview.unknown.map((u) => `{{${u}}}`).join(', ')}</p>}
          {view === 'text' ? (
            <Textarea ref={area} value={source} onChange={(e) => setSource(e.target.value)} rows={24} spellCheck className="font-mono text-[13px] leading-relaxed" aria-label="Texto del documento" />
          ) : (
            <div className="max-h-[60vh] overflow-y-auto rounded-ui border border-border px-5 py-4">
              <Markdown source={preview.text} />
            </div>
          )}
        </div>
        <aside className="space-y-4 text-sm">
          <Field label="Qué cambió" hint="Lo ven los administradores al aceptar.">
            <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={doc.current ? 'Ej.: nuevos precios de los módulos' : 'Primera versión'} />
          </Field>
          {accept && (
            <Checkbox
              checked={requiresAcceptance}
              onChange={setRequiresAcceptance}
              label={<span>Cambio importante: pedir que las organizaciones vuelvan a aceptar</span>}
            />
          )}
          <div>
            <p className="mb-2 font-medium">Variables</p>
            <ul className="space-y-1">
              {LEGAL_VARIABLES.map((v) => (
                <li key={v.key}>
                  <button type="button" onClick={() => insert(v.key)} className="w-full rounded-ui px-2 py-1 text-left hover:bg-subtle" title={view === 'text' ? 'Insertar' : 'Copiar'}>
                    <code className="text-xs text-primary">{`{{${v.key}}}`}</code>
                    <span className="block truncate text-xs text-muted">{vars[v.key] || v.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted">El texto se escribe en Markdown: # títulos, **negrita**, listas con «-» y enlaces [texto](/terminos).</p>
        </aside>
      </div>
    </Modal>
  );
}

function HistoryModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const versions = useQuery({ queryKey: ['platform', 'legal', doc.kind, 'versions'], queryFn: () => api.get<LegalVersionDTO[]>(`/platform/legal/${doc.kind}/versions`) });
  return (
    <Modal open size="lg" onClose={onClose} title={`Versiones de «${doc.title}»`}>
      {versions.isLoading ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Versión</th>
              <th>Publicada</th>
              <th className="w-full">Cambios</th>
              {LEGAL_DOCS[doc.kind].accept && <th>Aceptaciones</th>}
            </tr>
          </thead>
          <tbody>
            {versions.data?.map((v) => (
              <tr key={v.id}>
                <td>
                  <a href={`${doc.path}?version=${v.version}`} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                    {v.version}
                  </a>
                </td>
                <td className="whitespace-nowrap text-muted">
                  {formatLegalDate(v.publishedAt)}
                  {v.publishedBy && <span className="block text-xs">{v.publishedBy}</span>}
                </td>
                <td>
                  {v.note ?? <span className="text-muted">—</span>}
                  {LEGAL_DOCS[doc.kind].accept && !v.requiresAcceptance && <Badge className="ml-2">Sin nueva aceptación</Badge>}
                </td>
                {LEGAL_DOCS[doc.kind].accept && <td className="text-right tabular-nums">{v.accepted}</td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Modal>
  );
}

function AcceptancesCard() {
  const [onlyPending, setOnlyPending] = useState(false);
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['platform', 'legal', 'tenants'], queryFn: () => api.get<LegalTenantStatusDTO[]>('/platform/legal/tenants') });
  const rows = (list.data ?? []).filter((r) => (!onlyPending || r.pending.length > 0) && (!q.trim() || r.tenant.name.toLowerCase().includes(q.trim().toLowerCase())));
  const cell = (r: LegalTenantStatusDTO, kind: 'terms' | 'dpa') => {
    const a = r.accepted[kind];
    if (r.pending.includes(kind)) return <Badge color="#d97706">{a ? `Aceptó la ${a.version}: falta la nueva` : 'Pendiente'}</Badge>;
    if (!a) return <span className="text-xs text-muted">—</span>;
    return (
      <span className="text-xs" title={`${a.userEmail}${a.ip ? ` · IP ${a.ip}` : ''}`}>
        Versión {a.version} · {formatLegalDate(a.acceptedAt)}
        <span className="block text-muted">{a.userName}</span>
      </span>
    );
  };
  return (
    <Card title="Aceptaciones por organización" description="Quién aceptó cada versión en nombre de su organización, cuándo y desde qué IP (pase el cursor sobre la fecha).">
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <Input className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar organización" aria-label="Buscar organización" />
        <Toggle checked={onlyPending} onChange={setOnlyPending} label="Solo pendientes" />
      </div>
      {list.isLoading ? (
        <Loading />
      ) : !rows.length ? (
        <EmptyState icon={<Scale />} title={onlyPending ? 'Ninguna organización tiene aceptaciones pendientes' : 'Sin organizaciones'} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <th className="w-full">Organización</th>
                <th>Términos del servicio</th>
                <th>Tratamiento de datos</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <tr key={r.tenant.id}>
                  <td>
                    <span className="font-medium">{r.tenant.name}</span>
                    {r.tenant.isDemo && <Badge className="ml-2">Demo</Badge>}
                  </td>
                  <td className="whitespace-nowrap">{cell(r, 'terms')}</td>
                  <td className="whitespace-nowrap">{cell(r, 'dpa')}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {rows.length > 200 && <p className="mt-2 text-xs text-muted">Se muestran 200 de {rows.length}. Use la búsqueda para encontrar una organización.</p>}
        </div>
      )}
    </Card>
  );
}
