import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Mail, MessageCircle, Plus, Send, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  PLATFORM_NOTICE_EVENTS,
  PLATFORM_NOTICE_INFO,
  type PlatformNoticeEvent,
  type PlatformNoticeSettings,
  type PlatformNoticeTestDTO,
  type PlatformSettings,
  type TenantChannelsDTO,
} from '@gc/shared';
import { MailSettingsForm } from '../../components/MailSettingsForm';
import { NotifyProviderForm } from '../../components/NotifyProviderForm';
import { Badge, Button, Card, Field, IconButton, Input, Loading, Table, Toggle, cx, useFeedback } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Plataforma → Comunicaciones: el correo y el WhatsApp/SMS de la plataforma, qué avisos envía y por
 * qué canal, y por dónde sale lo de cada organización.
 */
export function CommsTab() {
  return (
    <div className="space-y-8">
      <NoticesCard />
      <section className="space-y-4">
        <Head icon={<Mail />} title="Correo de la plataforma (SMTP)" text="Invitaciones, códigos de acceso, recuperación de contraseñas, demos y los avisos de la plataforma. Lo usan también las organizaciones que no configuren su propio correo (Configuración → Correo saliente, disponible en todos los planes)." />
        <MailSettingsForm scope="platform" />
      </section>
      <section className="space-y-4">
        <Head
          icon={<MessageCircle />}
          title="WhatsApp y SMS de la plataforma"
          text="Lo usa la plataforma para sus avisos por WhatsApp/SMS y, como canal compartido, las organizaciones con el módulo «Avisos» que no configuren uno propio. Cada organización elige sus mensajes."
        />
        <NotifyProviderForm scope="platform" />
      </section>
      <ChannelsCard />
    </div>
  );
}

function Head({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-ui bg-primary/10 text-primary [&_svg]:size-5">{icon}</span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted">{text}</p>
      </div>
    </div>
  );
}

function NoticesCard() {
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['platform', 'settings'], queryFn: () => api.get<PlatformSettings>('/platform/settings') });
  const [draft, setDraft] = useState<PlatformNoticeSettings | null>(null);
  const [phone, setPhone] = useState('');
  const [testing, setTesting] = useState<PlatformNoticeEvent | null>(null);
  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data.notices);
  }, [settings.data, draft]);

  const save = useMutation({
    mutationFn: (notices: PlatformNoticeSettings) => api.put<PlatformSettings>('/platform/settings', { notices }),
    onSuccess: (data) => {
      qc.setQueryData(['platform', 'settings'], data);
      setDraft(data.notices);
      toast('Avisos de la plataforma guardados');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  async function test(event: PlatformNoticeEvent) {
    setTesting(event);
    try {
      const r = await api.post<PlatformNoticeTestDTO>('/platform/notices/test', { event });
      const parts = [
        r.email.sent ? 'correo enviado a su casilla' : `correo: ${r.email.error ?? 'no enviado'}`,
        r.whatsapp.sent ? `WhatsApp/SMS enviado a ${r.whatsapp.sent} ${r.whatsapp.sent === 1 ? 'celular' : 'celulares'}` : `WhatsApp/SMS: ${r.whatsapp.error ?? 'no enviado'}`,
      ];
      toast(`Prueba: ${parts.join(' · ')}`, r.email.sent || r.whatsapp.sent ? 'success' : 'error');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setTesting(null);
    }
  }

  if (settings.isLoading || !draft) return <Loading />;
  const dirty = !sameJson(draft, settings.data!.notices);
  const setChannel = (event: PlatformNoticeEvent, key: 'email' | 'whatsapp', value: boolean) =>
    setDraft((d) => (d ? { ...d, events: { ...d.events, [event]: { ...d.events[event], [key]: value } } } : d));
  const addPhone = () => {
    const value = phone.trim();
    if (value.length < 6 || draft.adminPhones.includes(value)) return;
    setDraft((d) => (d ? { ...d, adminPhones: [...d.adminPhones, value].slice(0, 5) } : d));
    setPhone('');
  };
  const groups: { audience: 'tenant' | 'platform'; title: string; text: string }[] = [
    { audience: 'tenant', title: 'A los administradores de cada organización', text: 'Por correo a sus administradores; por WhatsApp/SMS al celular que cargan en «Plan y facturación».' },
    { audience: 'platform', title: 'A los superadministradores', text: 'Por correo a todos los superadministradores; por WhatsApp/SMS a los celulares de abajo y al que cada uno cargó en «Mi perfil».' },
  ];

  return (
    <Card
      title="Avisos de la plataforma"
      description="Elija por qué canal avisa la plataforma en cada caso. WhatsApp/SMS usa el canal de la plataforma configurado más abajo."
      actions={
        <>
          <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(settings.data!.notices)}>
            Descartar
          </Button>
          <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(draft)}>
            Guardar avisos
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.audience}>
            <p className="font-semibold">{g.title}</p>
            <p className="mb-2 text-xs text-muted">{g.text}</p>
            <ul className="divide-y divide-border rounded-ui border border-border">
              {PLATFORM_NOTICE_EVENTS.filter((e) => PLATFORM_NOTICE_INFO[e].audience === g.audience).map((event) => {
                const info = PLATFORM_NOTICE_INFO[event];
                const ch = draft.events[event];
                return (
                  <li key={event} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="text-sm font-medium">{info.label}</p>
                      <p className="text-xs text-muted">{info.description}</p>
                      {event === 'invoice_due' && (
                        <label className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                          Días antes:
                          <span className="w-20">
                            <Input type="number" min={1} max={30} className="h-8" value={draft.dueDaysBefore} onChange={(e) => setDraft({ ...draft, dueDaysBefore: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })} />
                          </span>
                        </label>
                      )}
                      {event === 'demo_expiring' && (
                        <label className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                          Días antes:
                          <span className="w-20">
                            <Input type="number" min={1} max={14} className="h-8" value={draft.demoDaysBefore} onChange={(e) => setDraft({ ...draft, demoDaysBefore: Math.min(14, Math.max(1, Number(e.target.value) || 1)) })} />
                          </span>
                        </label>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <ChannelToggle icon={<Mail />} label="Correo" checked={ch.email} onChange={(v) => setChannel(event, 'email', v)} />
                      <ChannelToggle icon={<MessageCircle />} label="WhatsApp / SMS" checked={ch.whatsapp} onChange={(v) => setChannel(event, 'whatsapp', v)} />
                      <Button size="sm" variant="ghost" icon={<Send className="size-4" />} loading={testing === event} onClick={() => void test(event)} title="Le llega a usted por correo y a los celulares de los superadministradores">
                        Probar
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label="Otros celulares para los avisos (WhatsApp/SMS)" hint="Hasta 5, además del celular de «Mi perfil» de cada superadministrador. Reciben los avisos para superadministradores y las pruebas.">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {draft.adminPhones.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 rounded-full bg-subtle py-1 pr-1 pl-3 text-sm">
                    {p}
                    <IconButton label={`Quitar ${p}`} className="size-6" icon={<X className="size-3.5" />} onClick={() => setDraft({ ...draft, adminPhones: draft.adminPhones.filter((x) => x !== p) })} />
                  </span>
                ))}
                {!draft.adminPhones.length && <span className="text-sm text-muted">Ninguno.</span>}
              </div>
              {draft.adminPhones.length < 5 && (
                <div className="flex max-w-sm gap-2">
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addPhone();
                      }
                    }}
                    placeholder="0981 123 456"
                    aria-label="Nuevo celular"
                  />
                  <Button variant="secondary" icon={<Plus className="size-4" />} onClick={addPhone}>
                    Agregar
                  </Button>
                </div>
              )}
            </div>
          </Field>
          <Field label="Código de país" hint="Para números sin +.">
            <Input inputMode="numeric" value={draft.countryCode} onChange={(e) => setDraft({ ...draft, countryCode: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
          </Field>
        </div>
      </div>
    </Card>
  );
}

function ChannelToggle({ icon, label, checked, onChange }: { icon: React.ReactNode; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cx('flex cursor-pointer items-center gap-2 text-sm [&_svg]:size-4', checked ? 'text-fg' : 'text-muted')}>
      <Toggle checked={checked} onChange={onChange} ariaLabel={label} />
      {icon}
      {label}
    </label>
  );
}

const MAIL_LABEL: Record<TenantChannelsDTO['mail'], { text: string; color?: string }> = {
  tenant: { text: 'Propio', color: '#059669' },
  platform: { text: 'De la plataforma', color: '#2563eb' },
  none: { text: 'Sin correo', color: '#dc2626' },
};
const WA_LABEL: Record<TenantChannelsDTO['whatsapp'], { text: string; color?: string }> = {
  tenant: { text: 'Propio', color: '#059669' },
  platform: { text: 'De la plataforma', color: '#2563eb' },
  none: { text: 'Sin canal', color: '#d97706' },
  off: { text: 'No incluido en su plan' },
};

function ChannelsCard() {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['platform', 'notices', 'channels'], queryFn: () => api.get<TenantChannelsDTO[]>('/platform/notices/channels') });
  const rows = (list.data ?? []).filter((r) => !q.trim() || r.tenant.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Card
      title="Canales de cada organización"
      description="El correo está disponible en todos los planes: cada organización puede usar el de la plataforma o el suyo. WhatsApp y SMS dependen del módulo «Avisos» de su plan (se activa por plan o como adicional en Organizaciones → Módulos)."
      actions={
        <span className="w-full sm:w-56">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar organización" aria-label="Buscar organización" />
        </span>
      }
      padded={false}
    >
      {list.isLoading ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className="w-full">Organización</th>
              <th>Correo</th>
              <th>WhatsApp / SMS</th>
              <th>Celular para avisos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tenant.id}>
                <td>
                  <span className="inline-flex items-center gap-2 font-medium">
                    <Building2 className="size-4 text-muted" />
                    {r.tenant.name}
                  </span>
                  {r.tenant.isDemo && <Badge className="ml-2">Demo</Badge>}
                  <span className="block text-xs text-muted">
                    {r.admins} {r.admins === 1 ? 'administrador' : 'administradores'}
                  </span>
                </td>
                <td>
                  <Badge color={MAIL_LABEL[r.mail].color}>{MAIL_LABEL[r.mail].text}</Badge>
                </td>
                <td>
                  <Badge color={WA_LABEL[r.whatsapp].color}>{WA_LABEL[r.whatsapp].text}</Badge>
                </td>
                <td>{r.phone ? <ShieldCheck className="size-4 text-emerald-600" aria-label="Sí" /> : <span className="text-xs text-muted">No cargado</span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
