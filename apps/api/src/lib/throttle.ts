import { AppError } from './errors';

interface Entry {
  fails: number;
  first: number;
  lockedUntil: number;
  locks: number;
}

/**
 * Bloqueo progresivo por clave (correo, organización...) ante intentos fallidos repetidos:
 * complementa el límite por IP, que un atacante puede repartir entre muchas direcciones.
 * Vive en memoria del proceso (suficiente para una instancia; con varias, cada una lleva su cuenta).
 */
export function createThrottle(options: { maxFails: number; windowMs: number; lockMs: number; message: string }) {
  const entries = new Map<string, Entry>();

  function sweep(now: number) {
    if (entries.size < 5000) return;
    for (const [key, e] of entries) if (e.lockedUntil < now && now - e.first > options.windowMs) entries.delete(key);
  }

  return {
    /** Falla con 429 si la clave está bloqueada. */
    check(key: string) {
      const e = entries.get(key);
      const now = Date.now();
      if (e && e.lockedUntil > now) {
        const minutes = Math.ceil((e.lockedUntil - now) / 60_000);
        throw new AppError(429, 'too_many_attempts', `${options.message} Intente de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`);
      }
    },
    fail(key: string) {
      const now = Date.now();
      sweep(now);
      let e = entries.get(key);
      if (!e || now - e.first > options.windowMs) e = { fails: 0, first: now, lockedUntil: 0, locks: e?.locks ?? 0 };
      e.fails += 1;
      if (e.fails >= options.maxFails) {
        // Cada bloqueo seguido dura el doble (máximo 24 h).
        e.lockedUntil = now + Math.min(options.lockMs * 2 ** e.locks, 24 * 3600_000);
        e.locks += 1;
        e.fails = 0;
        e.first = now;
      }
      entries.set(key, e);
    },
    success(key: string) {
      entries.delete(key);
    },
  };
}
