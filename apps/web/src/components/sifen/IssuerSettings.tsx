import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileKey2, KeyRound, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SifenIssuerDTO, SifenIssuerSettings } from '@gc/shared';
import { Badge, Button, Card, Field, Input, Loading, Select, Toggle, cx, useFeedback } from '../ui';
import { api, errorMessage } from '../../lib/api';

type Geo = {
  departamentos: { codigo: number; descripcion: string }[];
  distritos: { codigo: number; descripcion: string; departamento: number }[];
  ciudades: { codigo: number; descripcion: string; distrito: number }[];
};

type Form = SifenIssuerSettings & { nextNumber: number };
const strip = ({ certificate: _c, hasCsc: _h, missing: _m, ...rest }: SifenIssuerDTO): Form => rest;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Emisor de factura electrónica: datos fiscales, timbrado, dirección, certificado y CSC. */
export function IssuerSettings({ base, scope }: { base: '/invoicing' | '/platform/invoicing'; scope: 'tenant' | 'platform' }) {
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const issuer = useQuery({ queryKey: ['sifen', base, 'issuer'], queryFn: () => api.get<SifenIssuerDTO>(`${base}/issuer`) });
  const geo = useQuery({ queryKey: ['sifen', 'geo'], queryFn: () => api.get<Geo>(`${base}/geo`), staleTime: Infinity });
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => {
    if (issuer.data && !form) setForm(strip(issuer.data));
  }, [issuer.data, form]);
  const update = (data: SifenIssuerDTO) => {
    qc.setQueryData(['sifen', base, 'issuer'], data);
    setForm(strip(data));
  };
  const save = useMutation({
    mutationFn: (body: Partial<Form>) => api.put<SifenIssuerDTO>(`${base}/issuer`, body),
    onSuccess: (data) => {
      update(data);
      toast('Datos de factura electrónica guardados');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const distritos = useMemo(() => geo.data?.distritos.filter((d) => d.departamento === form?.departamento) ?? [], [geo.data, form?.departamento]);
  const ciudades = useMemo(() => geo.data?.ciudades.filter((c) => c.distrito === form?.distrito) ?? [], [geo.data, form?.distrito]);

  if (issuer.isLoading || !form) return <Loading />;
  if (!issuer.data) return <p className="text-sm text-red-600">{errorMessage(issuer.error)}</p>;
  const data = issuer.data;
  const dirty = !sameJson(form, strip(data));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const changed = () => {
    const original = strip(data);
    return Object.fromEntries(Object.entries(form).filter(([k, v]) => !sameJson(v, original[k as keyof Form]))) as Partial<Form>;
  };

  return (
    <div className="space-y-5">
      {data.missing.length ? (
        <div className="flex gap-3 rounded-ui border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="size-5 shrink-0" />
          <p>Para emitir falta: {data.missing.join(', ')}.</p>
        </div>
      ) : (
        <div className="flex gap-3 rounded-ui border border-green-300 bg-green-50 p-4 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
          <CheckCircle2 className="size-5 shrink-0" />
          <p>
            Todo listo para emitir{data.enabled ? '' : ' (active la factura electrónica)'}. Próximo número: {form.establecimiento}-{form.punto}-{String(data.nextNumber).padStart(7, '0')} ·{' '}
            {data.environment === 'test' ? 'ambiente de PRUEBAS de la SET' : 'PRODUCCIÓN'}.
          </p>
        </div>
      )}

      <Card title="Estado">
        <div className="space-y-4">
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Emitir facturas electrónicas" />
          <Field label="Ambiente de la SET" hint="Empiece en pruebas (sifen-test): las facturas no tienen valor fiscal. Pase a producción cuando la SET lo habilite.">
            <Select value={form.environment} onChange={(e) => set('environment', e.target.value as Form['environment'])} className="max-w-sm">
              <option value="test">Pruebas (sin valor fiscal)</option>
              <option value="prod">Producción</option>
            </Select>
          </Field>
          {scope === 'tenant' && (
            <Toggle
              checked={form.autoIssue}
              onChange={(v) => set('autoIssue', v)}
              label="Facturar sola cada cobro registrado"
              hint="Al cobrar un turno (en línea o en el puesto) se emite la factura al documento del cliente, o como consumidor final si no lo dio."
            />
          )}
        </div>
      </Card>

      <Card title="Contribuyente" description="Tal como figuran en el RUC y en la constancia de timbrado de la SET.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="RUC" hint="Con dígito verificador: 80012345-6">
            <Input value={form.ruc} onChange={(e) => set('ruc', e.target.value.trim())} maxLength={12} />
          </Field>
          <Field label="Tipo de contribuyente">
            <Select value={form.tipoContribuyente} onChange={(e) => set('tipoContribuyente', Number(e.target.value) as 1 | 2)}>
              <option value={2}>Persona jurídica</option>
              <option value={1}>Persona física</option>
            </Select>
          </Field>
          <Field label="Razón social">
            <Input value={form.razonSocial} onChange={(e) => set('razonSocial', e.target.value)} maxLength={255} />
          </Field>
          <Field label="Nombre de fantasía (opcional)">
            <Input value={form.nombreFantasia} onChange={(e) => set('nombreFantasia', e.target.value)} maxLength={255} />
          </Field>
          <Field label="Actividad económica: código" hint="Código de la actividad principal del RUC.">
            <Input value={form.actividadCodigo} onChange={(e) => set('actividadCodigo', e.target.value.trim())} maxLength={8} />
          </Field>
          <Field label="Actividad económica: descripción">
            <Input value={form.actividadDescripcion} onChange={(e) => set('actividadDescripcion', e.target.value)} maxLength={300} />
          </Field>
        </div>
      </Card>

      <Card title="Timbrado y numeración">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Timbrado">
            <Input value={form.timbrado} inputMode="numeric" onChange={(e) => set('timbrado', e.target.value.trim())} maxLength={8} />
          </Field>
          <Field label="Inicio de vigencia">
            <Input type="date" value={form.timbradoFecha} onChange={(e) => set('timbradoFecha', e.target.value)} />
          </Field>
          <Field label="Establecimiento">
            <Input value={form.establecimiento} inputMode="numeric" onChange={(e) => set('establecimiento', e.target.value.trim())} maxLength={3} />
          </Field>
          <Field label="Punto de expedición">
            <Input value={form.punto} inputMode="numeric" onChange={(e) => set('punto', e.target.value.trim())} maxLength={3} />
          </Field>
          <Field label="Próximo número">
            <Input type="number" min={1} max={9999999} value={form.nextNumber} onChange={(e) => set('nextNumber', Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        </div>
      </Card>

      <Card title="Domicilio fiscal">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem]">
          <Field label="Dirección">
            <Input value={form.direccion} onChange={(e) => set('direccion', e.target.value)} maxLength={255} />
          </Field>
          <Field label="Número de casa">
            <Input value={form.numeroCasa} onChange={(e) => set('numeroCasa', e.target.value)} maxLength={6} />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="Departamento">
            <Select
              value={form.departamento}
              onChange={(e) => {
                const departamento = Number(e.target.value);
                const firstDistrict = geo.data?.distritos.find((d) => d.departamento === departamento);
                const firstCity = geo.data?.ciudades.find((c) => c.distrito === firstDistrict?.codigo);
                setForm((f) => (f ? { ...f, departamento, distrito: firstDistrict?.codigo ?? 1, ciudad: firstCity?.codigo ?? 1 } : f));
              }}
            >
              {geo.data?.departamentos
                .slice()
                .sort((a, b) => a.descripcion.localeCompare(b.descripcion))
                .map((d) => (
                  <option key={d.codigo} value={d.codigo}>
                    {d.descripcion}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Distrito">
            <Select
              value={form.distrito}
              onChange={(e) => {
                const distrito = Number(e.target.value);
                const firstCity = geo.data?.ciudades.find((c) => c.distrito === distrito);
                setForm((f) => (f ? { ...f, distrito, ciudad: firstCity?.codigo ?? 1 } : f));
              }}
            >
              {distritos.map((d) => (
                <option key={d.codigo} value={d.codigo}>
                  {d.descripcion}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ciudad">
            <Select value={form.ciudad} onChange={(e) => set('ciudad', Number(e.target.value))}>
              {ciudades.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.descripcion}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Teléfono">
            <Input value={form.telefono} onChange={(e) => set('telefono', e.target.value)} maxLength={15} />
          </Field>
          <Field label="Correo">
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value.trim())} maxLength={80} />
          </Field>
          <Field label="IVA de los servicios">
            <Select value={form.defaultIva} onChange={(e) => set('defaultIva', Number(e.target.value) as 10 | 5 | 0)}>
              <option value={10}>10 %</option>
              <option value={5}>5 %</option>
              <option value={0}>Exento</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={!dirty} onClick={() => setForm(strip(data))}>
          Descartar
        </Button>
        <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(changed())}>
          Guardar
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <CertificateCard base={base} data={data} onChange={update} />
        <CscCard base={base} data={data} onChange={update} cscId={form.cscId} onCscId={(v) => set('cscId', v)} />
      </div>
    </div>
  );
}

function CertificateCard({ base, data, onChange }: { base: string; data: SifenIssuerDTO; onChange: (d: SifenIssuerDTO) => void }) {
  const { toast, confirm } = useFeedback();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const upload = useMutation({
    mutationFn: async () => {
      const buffer = new Uint8Array(await file!.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      return api.post<SifenIssuerDTO>(`${base}/issuer/certificate`, { p12: btoa(binary), password });
    },
    onSuccess: (d) => {
      onChange(d);
      setFile(null);
      setPassword('');
      toast('Certificado cargado');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const cert = data.certificate;
  const expired = cert && new Date(cert.validTo) < new Date();
  const soon = cert && !expired && new Date(cert.validTo).getTime() - Date.now() < 30 * 86_400_000;
  return (
    <Card title="Certificado digital" description="El .p12 o .pfx de firma que emitió su certificadora. Se guarda cifrado y nunca se vuelve a mostrar.">
      {cert ? (
        <div className="mb-4 flex items-start gap-3 rounded-ui bg-subtle p-3 text-sm">
          <ShieldCheck className={cx('size-5 shrink-0', expired ? 'text-red-600' : 'text-green-600')} />
          <div className="min-w-0 flex-1">
            <p className="font-medium break-words">{cert.subject}</p>
            <p className="text-muted">
              Vigente hasta {new Date(cert.validTo).toLocaleDateString('es')}
              {expired && <Badge color="#dc2626" className="ml-2">Vencido</Badge>}
              {soon && <Badge color="#d97706" className="ml-2">Vence pronto</Badge>}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-4" />}
            aria-label="Quitar el certificado"
            onClick={async () => {
              if (!(await confirm({ title: '¿Quitar el certificado?', message: 'No se podrá emitir hasta cargar otro.', confirmLabel: 'Quitar', danger: true }))) return;
              onChange(await api.del<SifenIssuerDTO>(`${base}/issuer/certificate`));
            }}
          />
        </div>
      ) : null}
      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-3 rounded-ui border border-dashed border-border p-3 text-sm hover:bg-subtle">
          <FileKey2 className="size-5 text-muted" />
          <span className="min-w-0 flex-1 truncate">{file ? file.name : cert ? 'Reemplazar por otro certificado…' : 'Elegir el archivo .p12 / .pfx'}</span>
          <input type="file" accept=".p12,.pfx,application/x-pkcs12" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Field label="Contraseña del certificado">
          <Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button icon={<Upload className="size-4" />} disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}>
          Cargar certificado
        </Button>
      </div>
    </Card>
  );
}

function CscCard({ base, data, onChange, cscId, onCscId }: { base: string; data: SifenIssuerDTO; onChange: (d: SifenIssuerDTO) => void; cscId: string; onCscId: (v: string) => void }) {
  const { toast } = useFeedback();
  const [csc, setCsc] = useState('');
  const save = useMutation({
    mutationFn: () => api.put<SifenIssuerDTO>(`${base}/issuer/csc`, { csc }),
    onSuccess: (d) => {
      onChange(d);
      setCsc('');
      toast('Código de seguridad guardado');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Card title="Código de seguridad (CSC)" description="Lo da la SET en Marangatú junto con su identificador; se usa para el QR de cada factura.">
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm">
          <KeyRound className="size-4 text-muted" />
          {data.hasCsc ? 'CSC cargado (oculto).' : 'Todavía no se cargó.'}
        </p>
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Field label="Identificador" hint="Se guarda con «Guardar».">
            <Input value={cscId} inputMode="numeric" onChange={(e) => onCscId(e.target.value.trim())} maxLength={4} />
          </Field>
          <Field label={data.hasCsc ? 'Nuevo CSC' : 'CSC'}>
            <Input type="password" autoComplete="off" value={csc} onChange={(e) => setCsc(e.target.value.trim())} maxLength={64} />
          </Field>
        </div>
        <Button variant="secondary" disabled={csc.length < 8} loading={save.isPending} onClick={() => save.mutate()}>
          Guardar CSC
        </Button>
      </div>
    </Card>
  );
}
