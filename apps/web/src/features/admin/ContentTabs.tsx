import { Clapperboard, ListVideo } from 'lucide-react';
import { NavLink } from 'react-router';
import { cx } from '../../components/ui';

/** Pestañas de la sección Publicidad: biblioteca de medios y listas de reproducción. */
export function ContentTabs() {
  const tabs = [
    { to: '/app/contenido', label: 'Biblioteca', icon: <Clapperboard className="size-4" /> },
    { to: '/app/listas', label: 'Listas de reproducción', icon: <ListVideo className="size-4" /> },
  ];
  return (
    <nav aria-label="Publicidad" className="mb-5 inline-flex rounded-full border border-border bg-surface p-1 shadow-sm">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            cx(
              'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition',
              isActive ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted hover:text-fg',
            )
          }
        >
          {t.icon}
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
