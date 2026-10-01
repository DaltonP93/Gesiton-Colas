import { Link } from 'react-router';
import { LEGAL_DOCS } from '@gc/shared';
import { useAuth } from '../../lib/auth';
import { usePublicConfig } from '../../lib/queries';
import { cx } from '../ui';

/** Enlaces a los documentos publicados (pie de las páginas públicas y del ingreso). */
export function LegalFooter({ className, copyright = true }: { className?: string; copyright?: boolean }) {
  const { platformBrand: brand } = useAuth();
  const { data: config } = usePublicConfig();
  return (
    <p className={cx('flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[11px] text-muted/80', className)}>
      {copyright && (
        <span>
          © {new Date().getFullYear()} {brand.appName}
        </span>
      )}
      {config?.legal.documents.map((d) => (
        <Link key={d.kind} to={d.path} className="hover:text-fg">
          {LEGAL_DOCS[d.kind].short}
        </Link>
      ))}
      <a href="/licencias-de-terceros.txt" className="hover:text-fg">
        Licencias de terceros
      </a>
    </p>
  );
}
