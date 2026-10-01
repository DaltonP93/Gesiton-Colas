import { PackageX } from 'lucide-react';
import { Link } from 'react-router';
import { Button, EmptyState } from './ui';

/** Página de una función que la organización no tiene activa. */
export function ModuleOff({ name }: { name: string }) {
  return (
    <div className="py-10">
      <EmptyState
        icon={<PackageX />}
        title={`«${name}» no está activo`}
        description="Esta función no forma parte del plan de su organización o fue desactivada. Pida al administrador de la plataforma que la active."
        action={
          <Link to="/app">
            <Button variant="secondary">Volver al inicio</Button>
          </Link>
        }
      />
    </div>
  );
}
