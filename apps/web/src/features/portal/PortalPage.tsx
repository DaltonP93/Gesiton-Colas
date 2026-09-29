import {
  Activity,
  BarChart3,
  Building2,
  Check,
  Copy,
  ExternalLink,
  Headset,
  LayoutDashboard,
  Link2,
  MonitorPlay,
  Music,
  Palette,
  Plug,
  QrCode as QrIcon,
  Smartphone,
  Tablet,
  Tv,
  Video,
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { DisplayDTO, KioskDTO, Role } from '@gc/shared';
import { QrCode } from '../../components/QrCode';
import { Button, Card, EmptyState, IconButton, Input, Modal, cx } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { copyToClipboard } from '../../lib/format';
import { useBranches, useDisplays, useKiosks } from '../../lib/queries';

const origin = () => window.location.origin;
export const displayLink = (token: string) => `${origin()}/pantalla/${token}`;
export const kioskLink = (token: string, mobile = false) => `${origin()}/kiosco/${token}${mobile ? '?modo=movil' : ''}`;

const isOnline = (lastSeenAt: string | null) => Boolean(lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 3 * 60_000);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

interface Tool {
  to: string;
  title: string;
  description: string;
  icon: ReactNode;
  role: Role;
  tone: string;
}

/** Portal de inicio: acceso directo a todas las herramientas del sistema. */
export default function PortalPage() {
  const { me, terms, can } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const isManager = can('manager');

  const allTools: Tool[] = [
    { to: '/app/atencion', title: 'Consola de atención', description: `Llame, atienda y derive ${terms.tickets.toLowerCase()}`, icon: <Headset />, role: 'agent', tone: '#2563eb' },
    { to: '/app/monitor', title: 'Monitor en vivo', description: 'Cola y puestos en tiempo real', icon: <Activity />, role: 'manager', tone: '#0891b2' },
    { to: '/app/resumen', title: 'Resumen del día', description: 'Indicadores y actividad de hoy', icon: <LayoutDashboard />, role: 'manager', tone: '#7c3aed' },
    { to: '/app/reportes', title: 'Reportes', description: 'Tiempos, servicios y operadores', icon: <BarChart3 />, role: 'manager', tone: '#16a34a' },
    { to: '/app/contenido', title: 'Publicidad', description: 'Videos, imágenes y plataformas', icon: <Video />, role: 'manager', tone: '#ea580c' },
    { to: '/app/sonidos', title: 'Sonidos de llamado', description: 'Tonos, audios propios y música', icon: <Music />, role: 'manager', tone: '#db2777' },
    { to: '/app/personalizacion', title: 'Personalización', description: 'Marca, colores y terminología', icon: <Palette />, role: 'admin', tone: '#9333ea' },
    { to: '/app/sucursales', title: 'Configuración', description: `${terms.branches}, ${terms.services.toLowerCase()} y usuarios`, icon: <Building2 />, role: 'admin', tone: '#475569' },
    { to: '/app/integraciones', title: 'Integraciones y API', description: 'API keys, webhooks y documentación', icon: <Plug />, role: 'admin', tone: '#0f766e' },
  ];
  const tools = allTools.filter((t) => can(t.role));

  function pair(e: FormEvent) {
    e.preventDefault();
    navigate(`/app/vincular?code=${code}`);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting()}, {me?.user.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-muted">{me?.tenant?.name} · ¿Qué desea abrir?</p>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => (
          <Link
            key={tool.to}
            to={tool.to}
            className="group flex items-center gap-4 rounded-ui border border-border bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-ui [&_svg]:size-6" style={{ background: `color-mix(in srgb, ${tool.tone} 12%, transparent)`, color: tool.tone }}>
              {tool.icon}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold group-hover:text-primary">{tool.title}</span>
              <span className="block truncate text-sm text-muted">{tool.description}</span>
            </span>
          </Link>
        ))}
      </section>

      {isManager && (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <DisplaysLauncher />
            <KiosksLauncher />
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-6">
              <div className="grid size-14 shrink-0 place-items-center rounded-ui bg-primary/10 text-primary">
                <Link2 className="size-7" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Vincular una TV, tablet o tótem con un código</p>
                <p className="mt-0.5 text-sm text-muted">
                  En el navegador del dispositivo abra <strong className="text-fg">{origin().replace(/^https?:\/\//, '')}/vincular</strong> y escriba aquí el código que aparece. No hace falta
                  escribir enlaces largos ni iniciar sesión en el equipo.
                </p>
              </div>
              <form onSubmit={pair} className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder="000000"
                  className="w-32 text-center font-mono text-lg tracking-widest"
                  aria-label="Código del dispositivo"
                />
                <Button type="submit" disabled={code.length !== 6}>
                  Vincular
                </Button>
              </form>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function CopyButton({ text, label = 'Copiar enlace' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={label}
      icon={copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      onClick={async () => {
        if (await copyToClipboard(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    />
  );
}

function QrButton({ text, title }: { text: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Ver código QR" icon={<QrIcon className="size-4" />} onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title={title} size="sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <QrCode text={text} size={240} className="rounded-ui border border-border bg-white p-3" />
          <p className="text-xs break-all text-muted">{text}</p>
        </div>
      </Modal>
    </>
  );
}

function LauncherRow({
  icon,
  title,
  subtitle,
  online,
  actions,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  online?: boolean;
  actions: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-ui bg-subtle text-muted [&_svg]:size-5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 font-medium">
          <span className="truncate">{title}</span>
          {online !== undefined && (
            <span className={cx('inline-flex items-center gap-1 text-xs font-normal', online ? 'text-emerald-600' : 'text-muted')}>
              <span className={cx('size-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-fg/30')} />
              {online ? 'En línea' : 'Sin conexión'}
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1">{actions}</div>
    </li>
  );
}

function DisplaysLauncher() {
  const displays = useDisplays();
  const branches = useBranches();
  const branchName = (d: DisplayDTO) => branches.data?.find((b) => b.id === d.branchId)?.name ?? '';
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <MonitorPlay className="size-5 text-primary" /> Panel TV
        </span>
      }
      description="Abra la pantalla de llamados en esta computadora o en la TV."
      actions={
        <Link to="/app/pantallas">
          <Button size="sm" variant="ghost">
            Configurar
          </Button>
        </Link>
      }
      padded={false}
    >
      {!displays.data?.length ? (
        <div className="p-5">
          <EmptyState icon={<Tv />} title="No hay pantallas" action={<Link to="/app/pantallas"><Button size="sm">Crear pantalla</Button></Link>} />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {displays.data.map((d) => (
            <LauncherRow
              key={d.id}
              icon={<Tv />}
              title={d.name}
              subtitle={`${branchName(d)} · ${d.config.layout === 'split' ? 'Publicidad + turnos' : d.config.layout === 'fullscreen' ? 'Pantalla completa' : 'Solo turnos'}`}
              online={isOnline(d.lastSeenAt)}
              actions={
                <>
                  <CopyButton text={displayLink(d.token)} />
                  <QrButton text={displayLink(d.token)} title={d.name} />
                  <a href={`/pantalla/${d.token}`} target="_blank" rel="noreferrer">
                    <Button size="sm" icon={<ExternalLink className="size-4" />}>
                      Abrir
                    </Button>
                  </a>
                </>
              }
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function KiosksLauncher() {
  const kiosks = useKiosks();
  const branches = useBranches();
  const branchName = (k: KioskDTO) => branches.data?.find((b) => b.id === k.branchId)?.name ?? '';
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Tablet className="size-5 text-primary" /> Kiosco / triage
        </span>
      }
      description="Dispensador de turnos táctil o fila virtual desde el celular."
      actions={
        <Link to="/app/kioscos">
          <Button size="sm" variant="ghost">
            Configurar
          </Button>
        </Link>
      }
      padded={false}
    >
      {!kiosks.data?.length ? (
        <div className="p-5">
          <EmptyState icon={<Tablet />} title="No hay kioscos" action={<Link to="/app/kioscos"><Button size="sm">Crear kiosco</Button></Link>} />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {kiosks.data.map((k) => (
            <LauncherRow
              key={k.id}
              icon={<Tablet />}
              title={k.name}
              subtitle={branchName(k)}
              online={isOnline(k.lastSeenAt)}
              actions={
                <>
                  <CopyButton text={kioskLink(k.token)} />
                  <QrButton text={kioskLink(k.token, true)} title={`${k.name} · fila virtual`} />
                  <a href={kioskLink(k.token, true)} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="secondary" icon={<Smartphone className="size-4" />}>
                      Móvil
                    </Button>
                  </a>
                  <a href={`/kiosco/${k.token}`} target="_blank" rel="noreferrer">
                    <Button size="sm" icon={<ExternalLink className="size-4" />}>
                      Abrir
                    </Button>
                  </a>
                </>
              }
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
