import { Clock, Globe, Languages, LocateFixed } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Locale } from '@gc/shared';
import { Button, Field, Input, Select } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { useNow } from '../reports/shared';
import { SaveBar, Section, useReportDirty, useSaveTenant, type TabProps } from './common';
import { COMMON_TIMEZONES, LOCALE_OPTIONS } from './presets';

function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('es', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function allTimezones(): string[] {
  try {
    const list = Intl.supportedValuesOf('timeZone');
    return [...COMMON_TIMEZONES, ...list.filter((z) => !COMMON_TIMEZONES.includes(z))];
  } catch {
    return COMMON_TIMEZONES;
  }
}

export function RegionTab({ onDirtyChange }: TabProps) {
  const { settings, terms } = useAuth();
  const { save, saving } = useSaveTenant();
  const source = { locale: settings.locale, timezone: settings.timezone };
  const [locale, setLocale] = useState<Locale>(source.locale);
  const [timezone, setTimezone] = useState(source.timezone);
  const detected = useMemo(detectedTimezone, []);
  const zones = useMemo(allTimezones, []);

  const sourceKey = `${source.locale}|${source.timezone}`;
  const [base, setBase] = useState(sourceKey);
  if (base !== sourceKey) {
    setBase(sourceKey);
    setLocale(source.locale);
    setTimezone(source.timezone);
  }

  const tz = timezone.trim();
  const dirty = locale !== source.locale || tz !== source.timezone;
  useReportDirty(dirty, onDirtyChange);
  const validTz = isValidTimezone(tz);

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section
          title={
            <span className="flex items-center gap-2">
              <Languages className="size-4 text-primary" /> Idioma
            </span>
          }
          description="Idioma de las pantallas que ve el público: kiosco, pantalla de llamados y seguimiento en el celular."
        >
          <Field label="Idioma de las pantallas públicas" hint="El panel de administración se mantiene en español.">
            <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              {LOCALE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {locale !== 'es' && (
            <p className="mt-3 text-xs text-muted">
              Consejo: ajuste también la terminología ({terms.ticket}, {terms.counter}…) y la voz de cada pantalla al nuevo idioma.
            </p>
          )}
        </Section>

        <Section
          title={
            <span className="flex items-center gap-2">
              <Globe className="size-4 text-primary" /> Zona horaria
            </span>
          }
          description={`Define cuándo empieza cada jornada (reinicio diario de la numeración) y las horas de los reportes. Cada ${terms.branch.toLowerCase()} puede tener su propia zona.`}
        >
          <Field label="Zona horaria" error={!validTz ? 'Zona horaria inválida. Elija una de la lista (ej.: America/Lima).' : undefined}>
            <Input list="gc-timezones" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Mexico_City" spellCheck={false} />
          </Field>
          <datalist id="gc-timezones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {validTz && <ZoneClock timezone={tz} />}
            {detected !== tz && (
              <Button variant="ghost" size="sm" icon={<LocateFixed className="size-4" />} onClick={() => setTimezone(detected)}>
                Usar la de este equipo ({detected})
              </Button>
            )}
          </div>
        </Section>
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        invalid={!validTz}
        onSave={() => void save({ settings: { locale, timezone: tz } }, 'Región actualizada')}
        onDiscard={() => {
          setLocale(source.locale);
          setTimezone(source.timezone);
        }}
      />
    </div>
  );
}

/** Reloj de la zona elegida (se actualiza solo, sin volver a dibujar el formulario). */
function ZoneClock({ timezone }: { timezone: string }) {
  const now = useNow(1000);
  const text = new Date(now).toLocaleString('es', { timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <span className="inline-flex items-center gap-2 rounded-ui bg-subtle px-3 py-2 text-sm">
      <Clock className="size-4 text-muted" aria-hidden />
      <span className="tabular-nums">
        Hora actual: <span className="font-medium">{text}</span>
      </span>
    </span>
  );
}
