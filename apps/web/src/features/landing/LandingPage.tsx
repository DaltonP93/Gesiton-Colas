import {
  BarChart3,
  Building2,
  Code2,
  Headset,
  MonitorPlay,
  Palette,
  Smartphone,
  Tablet,
  Video,
  Webhook,
} from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../../components/ui';
import { useAuth } from '../../lib/auth';

const features = [
  { icon: <MonitorPlay />, title: 'Pantallas inteligentes', text: 'Llamados con voz y sonido, historial, reloj y diseños intercambiables para cualquier TV, Smart TV o Android TV.' },
  { icon: <Video />, title: 'Publicidad multiplataforma', text: 'Suba videos e imágenes o agregue YouTube, Vimeo, TikTok, Instagram, Facebook, Twitch, Canva, Google Slides, HLS y páginas web.' },
  { icon: <Tablet />, title: 'Kioscos táctiles', text: 'Emisión de turnos con impresión térmica, código QR, prioridades y datos del cliente configurables.' },
  { icon: <Smartphone />, title: 'Fila virtual', text: 'El cliente saca su turno desde el celular y sigue su posición en vivo. Aviso cuando es llamado.' },
  { icon: <Headset />, title: 'Consola de atención', text: 'Llamar, rellamar, derivar y finalizar con atajos de teclado. Varios operadores sin duplicados.' },
  { icon: <BarChart3 />, title: 'Reportes', text: 'Tiempos de espera y atención por servicio, operador, hora y día. Exportación a Excel.' },
  { icon: <Palette />, title: 'Totalmente personalizable', text: 'Logo, colores, tipografía, terminología (turno, ficha, ventanilla, box), campos y plantillas de impresión.' },
  { icon: <Webhook />, title: 'Integración con todo', text: 'API REST documentada, API keys, webhooks firmados y eventos en tiempo real para ERP, CRM o WhatsApp.' },
  { icon: <Building2 />, title: 'Multi-sucursal y SaaS', text: 'Organizaciones aisladas, planes, usuarios con roles y sucursales ilimitadas según el plan.' },
];

export function LandingPage() {
  const { settings } = useAuth();
  const name = settings.branding.appName;
  return (
    <div className="min-h-screen bg-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-lg font-bold">
          <span className="grid size-9 place-items-center rounded-ui bg-primary text-primary-fg">{name.charAt(0)}</span>
          {name}
        </div>
        <nav className="flex items-center gap-2">
          <a href="/api/docs" className="hidden text-sm text-muted hover:text-fg sm:inline">
            API
          </a>
          <Link to="/login">
            <Button variant="ghost">Ingresar</Button>
          </Link>
          <Link to="/registro">
            <Button>Probar gratis</Button>
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-10 pb-20 lg:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
            <Code2 className="size-4" /> Plataforma SaaS de gestión de colas
          </span>
          <h1 className="mt-5 text-4xl leading-[1.1] font-extrabold tracking-tight sm:text-5xl">
            Atienda mejor, <span className="text-primary">sin filas</span> y con su marca en cada pantalla.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            {name} organiza los turnos de todas sus sucursales, muestra publicidad en las salas de espera y se integra con cualquier sistema.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/registro">
              <Button size="lg">Crear mi organización</Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="secondary">
                Ya tengo cuenta
              </Button>
            </Link>
          </div>
        </div>
        <div className="relative">
          <div className="overflow-hidden rounded-2xl border border-border bg-slate-900 shadow-2xl">
            <div className="grid grid-cols-[1fr_38%]">
              <div className="relative aspect-video bg-gradient-to-br from-indigo-600 via-sky-500 to-emerald-400">
                <div className="absolute inset-0 grid place-items-center">
                  <div className="text-center text-white">
                    <Video className="mx-auto size-10 opacity-80" />
                    <p className="mt-2 text-sm font-semibold opacity-90">Su publicidad aquí</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col bg-slate-800 p-3 text-white">
                <p className="text-[10px] tracking-widest text-sky-300 uppercase">Llamando</p>
                <p className="gc-flash text-3xl font-black">A015</p>
                <p className="text-xs text-slate-300">Ventanilla 2</p>
                <div className="mt-auto space-y-1 text-xs text-slate-400">
                  <p className="flex justify-between"><span>C008</span><span>Caja 1</span></p>
                  <p className="flex justify-between"><span>A014</span><span>Ventanilla 3</span></p>
                  <p className="flex justify-between"><span>P002</span><span>Box 1</span></p>
                </div>
              </div>
            </div>
            <div className="overflow-hidden bg-amber-400 py-1 text-xs font-semibold text-slate-900">
              <div className="animate-[gc-marquee_18s_linear_infinite] whitespace-nowrap">
                Bienvenidos · Recuerde tener su documento a mano · Horario de atención de 8 a 18 h · Bienvenidos · Recuerde tener su documento a mano ·
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-surface py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">Todo lo que necesita para gestionar la atención</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-ui border border-border p-6">
                <div className="grid size-11 place-items-center rounded-ui bg-primary/10 text-primary [&_svg]:size-5">{f.icon}</div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="py-10 text-center text-sm text-muted">
        © {new Date().getFullYear()} {name} · <a href="/api/docs" className="hover:text-fg">Documentación de la API</a>
      </footer>
    </div>
  );
}
