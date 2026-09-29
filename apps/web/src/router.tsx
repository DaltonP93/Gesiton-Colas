import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import type { Role } from '@gc/shared';
import { AdminLayout } from './features/admin/AdminLayout';
import { LoginPage, RegisterPage } from './features/auth/AuthPages';
import { LandingPage } from './features/landing/LandingPage';

const DashboardPage = lazy(() => import('./features/admin/DashboardPage'));
const MonitorPage = lazy(() => import('./features/admin/MonitorPage'));
const BranchesPage = lazy(() => import('./features/admin/BranchesPage'));
const ServicesPage = lazy(() => import('./features/admin/ServicesPage'));
const UsersPage = lazy(() => import('./features/admin/UsersPage'));
const DisplaysPage = lazy(() => import('./features/admin/DisplaysPage'));
const KiosksPage = lazy(() => import('./features/admin/KiosksPage'));
const MediaPage = lazy(() => import('./features/admin/MediaPage'));
const PlaylistsPage = lazy(() => import('./features/admin/PlaylistsPage'));
const CustomizationPage = lazy(() => import('./features/admin/CustomizationPage'));
const IntegrationsPage = lazy(() => import('./features/admin/IntegrationsPage'));
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
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
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

function AppIndex() {
  const { can } = useAuth();
  return can('manager') ? (
    <Lazy>
      <DashboardPage />
    </Lazy>
  ) : (
    <Navigate to="/app/atencion" replace />
  );
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
  {
    path: '/app',
    element: (
      <RequireAuth>
        <AdminLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <AppIndex /> },
      { path: 'atencion', element: page(<AgentConsole />) },
      { path: 'monitor', element: page(<MonitorPage />, 'manager') },
      { path: 'sucursales', element: page(<BranchesPage />, 'admin') },
      { path: 'servicios', element: page(<ServicesPage />, 'admin') },
      { path: 'usuarios', element: page(<UsersPage />, 'admin') },
      { path: 'pantallas', element: page(<DisplaysPage />, 'manager') },
      { path: 'kioscos', element: page(<KiosksPage />, 'manager') },
      { path: 'contenido', element: page(<MediaPage />, 'manager') },
      { path: 'listas', element: page(<PlaylistsPage />, 'manager') },
      { path: 'personalizacion', element: page(<CustomizationPage />, 'admin') },
      { path: 'integraciones', element: page(<IntegrationsPage />, 'admin') },
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
