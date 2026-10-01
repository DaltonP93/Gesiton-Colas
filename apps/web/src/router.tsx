import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation, useSearchParams } from 'react-router';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { usePublicConfig } from './lib/queries';
import { MODULES, type ModuleId, type Role } from '@gc/shared';
import { ModuleOff } from './components/ModuleOff';
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
const SurveyPage = lazy(() => import('./features/survey/SurveyPage'));
const SurveysPage = lazy(() => import('./features/admin/SurveysPage'));
const SurveyEditorPage = lazy(() => import('./features/admin/SurveyEditorPage'));
const BillingPage = lazy(() => import('./features/admin/BillingPage'));
const PaymentsPage = lazy(() => import('./features/admin/PaymentsPage'));
const PaymentPage = lazy(() => import('./features/payment/PaymentPage'));
const AppointmentsPage = lazy(() => import('./features/admin/AppointmentsPage'));
const BookingPage = lazy(() => import('./features/booking/BookingPage'));
const AppointmentPage = lazy(() => import('./features/booking/AppointmentPage'));
const InvoicesPage = lazy(() => import('./features/admin/InvoicesPage'));
const KudePage = lazy(() => import('./features/invoice/KudePage'));
const LegalPage = lazy(() => import('./features/legal/LegalPage'));
const LicenseContractPage = lazy(() => import('./features/platform/LicenseContractPage'));

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

/** Redirige a otro sitio (página principal configurada como redirección). */
function ExternalRedirect({ url }: { url: string }) {
  useEffect(() => window.location.replace(url), [url]);
  return <Loading label="Redirigiendo…" />;
}

/** Dirección principal: lo que elija el superadministrador (presentación, ingreso o redirección). */
function Home() {
  const { me, loading } = useAuth();
  const config = usePublicConfig();
  if (loading || config.isLoading) return <Loading />;
  if (me) return <Navigate to={me.tenant ? '/app' : '/plataforma'} replace />;
  if (config.data?.homePage === 'login') return <Navigate to="/login" replace />;
  if (config.data?.homePage === 'redirect' && config.data.homeRedirectUrl) return <ExternalRedirect url={config.data.homeRedirectUrl} />;
  return <LandingPage />;
}

/** Las antiguas páginas de configuración ahora son secciones de /app/configuracion. */
function LegacyConfig({ section }: { section?: string }) {
  const [params] = useSearchParams();
  const tabs: Record<string, string> = { marca: 'marca', terminologia: 'terminologia', turnos: 'turnos', cliente: 'cliente', region: 'region' };
  const target = section ?? tabs[params.get('tab') ?? ''] ?? 'marca';
  return <Navigate to={`/app/configuracion/${target}`} replace />;
}

/** Muestra la página solo si la organización tiene alguno de los módulos activos. */
function RequireModule({ modules, children }: { modules: ModuleId[]; children: ReactNode }) {
  const { hasModule } = useAuth();
  if (modules.some(hasModule)) return <>{children}</>;
  return <ModuleOff name={modules.map((m) => MODULES[m].name).join(' / ')} />;
}

const page = (el: ReactNode, role?: Role, modules?: ModuleId[]) => (
  <RequireAuth role={role}>
    <Lazy>{modules ? <RequireModule modules={modules}>{el}</RequireModule> : el}</Lazy>
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
      { path: 'resumen', element: page(<DashboardPage />, 'manager', ['reports']) },
      { path: 'vincular', element: page(<PairDevicePage />, 'manager', ['displays', 'kiosks']) },
      { path: 'sonidos', element: page(<SoundsPage />, 'manager', ['displays']) },
      { path: 'atencion', element: page(<AgentConsole />) },
      { path: 'citas', element: page(<AppointmentsPage />, 'agent', ['appointments']) },
      { path: 'facturas', element: page(<InvoicesPage />, 'agent', ['invoicing']) },
      { path: 'monitor', element: page(<MonitorPage />, 'manager') },
      { path: 'configuracion', element: page(<ConfigurationPage />, 'admin') },
      { path: 'configuracion/:section', element: page(<ConfigurationPage />, 'admin') },
      { path: 'bienvenida', element: page(<SetupWizard />, 'admin') },
      { path: 'sucursales', element: <LegacyConfig section="sucursales" /> },
      { path: 'servicios', element: <LegacyConfig section="servicios" /> },
      { path: 'usuarios', element: <LegacyConfig section="usuarios" /> },
      { path: 'integraciones', element: <LegacyConfig section="integraciones" /> },
      { path: 'personalizacion', element: <LegacyConfig /> },
      { path: 'pantallas', element: page(<DisplaysPage />, 'manager', ['displays']) },
      { path: 'kioscos', element: page(<KiosksPage />, 'manager', ['kiosks']) },
      { path: 'contenido', element: page(<MediaPage />, 'manager', ['advertising']) },
      { path: 'listas', element: page(<PlaylistsPage />, 'manager', ['advertising']) },
      { path: 'reportes', element: page(<ReportsPage />, 'manager', ['reports']) },
      { path: 'encuestas', element: page(<SurveysPage />, 'manager', ['surveys']) },
      { path: 'encuestas/:id', element: page(<SurveyEditorPage />, 'admin', ['surveys']) },
      { path: 'cobros', element: page(<PaymentsPage />, 'manager', ['payments']) },
      { path: 'facturacion', element: page(<BillingPage />, 'admin') },
      { path: 'perfil', element: page(<ProfilePage />) },
    ],
  },
  { path: '/plataforma', element: page(<PlatformPage />, 'superadmin') },
  { path: '/plataforma/contrato-de-licencia', element: page(<LicenseContractPage />, 'superadmin') },
  { path: '/terminos', element: <Lazy><LegalPage kind="terms" /></Lazy> },
  { path: '/privacidad', element: <Lazy><LegalPage kind="privacy" /></Lazy> },
  { path: '/tratamiento-de-datos', element: <Lazy><LegalPage kind="dpa" /></Lazy> },
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
  {
    path: '/pago/:token',
    element: (
      <Lazy>
        <PaymentPage />
      </Lazy>
    ),
  },
  {
    path: '/reservar/:slug',
    element: (
      <Lazy>
        <BookingPage />
      </Lazy>
    ),
  },
  {
    path: '/factura/:token',
    element: (
      <Lazy>
        <KudePage />
      </Lazy>
    ),
  },
  {
    path: '/cita/:token',
    element: (
      <Lazy>
        <AppointmentPage />
      </Lazy>
    ),
  },
  {
    path: '/encuesta/:token',
    element: (
      <Lazy>
        <SurveyPage />
      </Lazy>
    ),
  },
  {
    path: '/encuesta/s/:token',
    element: (
      <Lazy>
        <SurveyPage general />
      </Lazy>
    ),
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
