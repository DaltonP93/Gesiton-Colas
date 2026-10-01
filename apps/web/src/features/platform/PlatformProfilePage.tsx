import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { Button, PageHeader } from '../../components/ui';
import { ProfileContent } from '../admin/ProfilePage';
import { PlatformShell } from './PlatformShell';

/** Mi perfil del superadministrador (/plataforma/perfil). */
export default function PlatformProfilePage() {
  return (
    <PlatformShell>
      <PageHeader
        title="Mi perfil"
        description="Su foto, nombre, correo de ingreso, celular para los avisos y contraseña."
        actions={
          <Link to="/plataforma">
            <Button variant="secondary" icon={<ArrowLeft className="size-4" />}>
              Volver a la plataforma
            </Button>
          </Link>
        }
      />
      <ProfileContent platform />
    </PlatformShell>
  );
}
