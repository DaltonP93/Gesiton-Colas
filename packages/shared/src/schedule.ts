import { z } from 'zod';

export const scheduleSchema = z.object({
  /** Fecha de inicio (YYYY-MM-DD), inclusive. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  /** Fecha de fin (YYYY-MM-DD), inclusive. */
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  /** Días de la semana (0 = domingo ... 6 = sábado). Vacío = todos. */
  days: z.array(z.number().int().min(0).max(6)).nullish(),
  /** Hora de inicio (HH:MM). */
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  /** Hora de fin (HH:MM). Si es menor que la de inicio, cruza la medianoche. */
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
});
export type Schedule = z.infer<typeof scheduleSchema>;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Indica si una programación está activa en el instante indicado (hora local). */
export function isScheduleActive(schedule: Schedule | null | undefined, now: Date = new Date()): boolean {
  if (!schedule) return true;
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (schedule.startDate && date < schedule.startDate) return false;
  if (schedule.endDate && date > schedule.endDate) return false;
  if (schedule.days && schedule.days.length > 0 && !schedule.days.includes(now.getDay())) return false;
  if (schedule.startTime || schedule.endTime) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const start = schedule.startTime ? toMinutes(schedule.startTime) : 0;
    const end = schedule.endTime ? toMinutes(schedule.endTime) : 24 * 60;
    if (start <= end) {
      if (minutes < start || minutes >= end) return false;
    } else if (minutes < start && minutes >= end) {
      // ventana que cruza la medianoche (p. ej. 22:00 → 06:00)
      return false;
    }
  }
  return true;
}
