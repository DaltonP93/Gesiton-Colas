import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation, useSearchParams } from 'react-router';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import type { Role } from '@gc/shared';
import { AdminLayout } from './features/admin/AdminLayout';
import {
  AcceptInvitePage,
  DemoPage,
  EmailLoginPage,
  ForgotPasswordPage,
  LoginPage,
  MagicLinkPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './features/auth/AuthPages';
import { LandingPage } from './features/landing/LandingPage';

const PortalPage = lazy(() => import('./features/portal/PortalPage'));
const PairDevicePage = lazy(() => import('./features/portal/PairDevicePage'));
const DeviceLinkPage = lazy(() => import('./features/portal/DeviceLinkPage'));
const SoundsPage = lazy(() => import('./features/admin/SoundsPage'));
const DashboardPage = lazy(() => import('./features/admin/DashboardPage'));
const MonitorPage = lazy(() => import('./features/admin/MonitorPage'));
const DisplaysPage = lazy(() => import('./features/admin/DisplaysPage'));
const KiosksPage = lazy(() => import('./features/admin/KiosksPage'));
const MediaPage = lazy(() => import('./features/admin/MediaPage'));
const PlaylistsPage = lazy(() => import('./features/admin/PlaylistsPage'));
const ConfigurationPage = lazy(() => import('./features/admin/ConfigurationPage'));
const SetupWizard = lazy(() => import('./features/admin/setup/SetupWizard'));
const ReportsPage = lazy(() => import('./features/admin/ReportsPage'));
const ProfilePage = lazy(() => import('./features/admin/ProfilePage'));
const PlatformPage = lazy(() => import('./features/platform/PlatformPage'));
const AgentConsole = lazy(() => import('./features/agent/AgentConsole'));
const DisplayPage = lazy(() => import('./features/display/DisplayPage'));
const KioskPage = lazy(() => import('./features/kiosk/KioskPage'));
const TrackingPage = lazy(() => import('./features/tracking/TrackingPage'));

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function RequireAuth({ children, role }: { children: ReactNode; role?: Role }) {
  const { me, loading, can } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (role && !can(role)) return <Navigate to="/app" replace />;
  if (!me.tenant && me.user.role === 'superadmin' && location.pathname.startsWith('/app')) return <Navigate to="/plataforma" replace />;
  return <>{children}</>;
}

function Home() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (me) return <Navigate to={me.tenant ? '/app' : '/plataforma'} replace />;
  return <LandingPage />;
}

/** Las antiguas páginas de configuración ahora son secciones de /app/configuracion. */
function LegacyConfig({ section }: { section?: string }) {
  const [params] = useSearchParams();
  const tabs: Record<string, string> = { marca: 'marca', terminologia: 'terminologia', turnos: 'turnos', cliente: 'cliente', region: 'region' };
  const target = section ?? tabs[params.get('tab') ?? ''] ?? 'marca';
  return <Navigate to={`/app/configuracion/${target}`} replace />;
}

const page = (el: ReactNode, role?: Role) => (
  <RequireAuth role={role}>
    <Lazy>{el}</Lazy>
  </RequireAuth>
);

export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/registro', element: <RegisterPage /> },
  { path: '/demo', element: <DemoPage /> },
  { path: '/ingresar-con-correo', element: <EmailLoginPage /> },
  { path: '/acceso', element: <MagicLinkPage /> },
  { path: '/olvide-contrasena', element: <ForgotPasswordPage /> },
  { path: '/restablecer', element: <ResetPasswordPage /> },
  { path: '/verificar', element: <VerifyEmailPage /> },
  { path: '/invitacion', element: <AcceptInvitePage /> },
  {
    path: '/vincular',
    element: (
      <Lazy>
        <DeviceLinkPage />
      </Lazy>
    ),
  },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <AdminLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: page(<PortalPage />) },
      { path: 'resumen', element: page(<DashboardPage />, 'manager') },
      { path: 'vincular', element: page(<PairDevicePage />, 'manager') },
      { path: 'sonidos', element: page(<SoundsPage />, 'manager') },
      { path: 'atencion', element: page(<AgentConsole />) },
      { path: 'monitor', element: page(<MonitorPage />, 'manager') },
      { path: 'configuracion', element: page(<ConfigurationPage />, 'admin') },
      { path: 'configuracion/:section', element: page(<ConfigurationPage />, 'admin') },
      { path: 'bienvenida', element: page(<SetupWizard />, 'admin') },
      { path: 'sucursales', element: <LegacyConfig section="sucursales" /> },
      { path: 'servicios', element: <LegacyConfig section="servicios" /> },
      { path: 'usuarios', element: <LegacyConfig section="usuarios" /> },
      { path: 'integraciones', element: <LegacyConfig section="integraciones" /> },
      { path: 'personalizacion', element: <LegacyConfig /> },
      { path: 'pantallas', element: page(<DisplaysPage />, 'manager') },
      { path: 'kioscos', element: page(<KiosksPage />, 'manager') },
      { path: 'contenido', element: page(<MediaPage />, 'manager') },
      { path: 'listas', element: page(<PlaylistsPage />, 'manager') },
      { path: 'reportes', element: page(<ReportsPage />, 'manager') },
      { path: 'perfil', element: page(<ProfilePage />) },
    ],
  },
  { path: '/plataforma', element: page(<PlatformPage />, 'superadmin') },
  {
    path: '/pantalla/:token',
    element: (
      <Lazy>
        <DisplayPage />
      </Lazy>
    ),
  },
  {
    path: '/kiosco/:token',
    element: (
      <Lazy>
        <KioskPage />
      </Lazy>
    ),
  },
  {
    path: '/t/:token',
    element: (
      <Lazy>
        <TrackingPage />
      </Lazy>
    ),
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
