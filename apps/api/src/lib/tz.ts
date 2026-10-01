/** Fecha (YYYY-MM-DD) en una zona horaria. */
export function dayInTimezone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Diferencia (ms) entre la hora local de una zona y UTC para un instante dado. */
export function tzOffsetMs(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant.getTime();
}

/** Convierte una fecha (YYYY-MM-DD) y minutos desde la medianoche locales de una zona a un instante UTC. */
export function localToUtc(day: string, minutes: number, timezone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  // Dos pasadas para acertar también cerca de los cambios de horario.
  const first = guess - tzOffsetMs(new Date(guess), timezone);
  return new Date(guess - tzOffsetMs(new Date(first), timezone));
}

/** Fecha, hora (HH:MM), minutos y día de la semana (0 = domingo) de un instante en una zona. */
export function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour');
  const minute = get('minute');
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${minute}`,
    minutes: Number(hour) * 60 + Number(minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
  };
}

/** Suma días a una fecha YYYY-MM-DD. */
export function addDays(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
