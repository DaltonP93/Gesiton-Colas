import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isScheduleActive, type DisplayConfig, type MediaDTO, type PlaylistItemDTO } from '@gc/shared';
import { cx } from '../../components/ui';
import { TIMED_KINDS, playerFor } from './players';

type PlayableItem = PlaylistItemDTO & { media: MediaDTO };

export interface MediaPlayerProps {
  items: PlaylistItemDTO[];
  settings: DisplayConfig['media'];
  /** Atenúa el volumen mientras se anuncia un turno. */
  ducked?: boolean;
  /** El navegador ya permite reproducir audio (hubo interacción o política de kiosco). */
  audioUnlocked?: boolean;
  /** Contenido a mostrar cuando no hay nada programado. */
  fallback?: ReactNode;
  className?: string;
}

function playable(items: PlaylistItemDTO[], now = new Date()): PlayableItem[] {
  return items.filter((i): i is PlayableItem => Boolean(i.active && i.media && isScheduleActive(i.schedule, now)));
}

/** Evita renders innecesarios si la lista disponible no cambió. */
function sameList(a: PlayableItem[], b: PlayableItem[]) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * Reproduce una lista de contenidos (videos subidos, imágenes, YouTube, Vimeo, HLS,
 * páginas web y anuncios de texto) respetando duraciones, horarios y volumen.
 */
export function MediaPlayer({ items, settings, ducked = false, audioUnlocked = true, fallback, className }: MediaPlayerProps) {
  const [cursor, setCursor] = useState({ id: '', cycle: 0 });
  const [available, setAvailable] = useState<PlayableItem[]>(() => playable(items));
  const errors = useRef(0);

  // Reevalúa la programación cada minuto y cuando cambia la lista.
  useEffect(() => {
    const update = () => setAvailable((prev) => {
      const next = playable(items);
      return sameList(prev, next) ? prev : next;
    });
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [items]);

  const current = useMemo(() => available.find((i) => i.id === cursor.id) ?? available[0] ?? null, [available, cursor.id]);

  const state = useRef({ currentId: current?.id ?? '', cycle: cursor.cycle });
  state.current = { currentId: current?.id ?? '', cycle: cursor.cycle };

  const advance = useCallback(() => {
    const list = playable(items);
    setAvailable((prev) => (sameList(prev, list) ? prev : list));
    const { currentId, cycle } = state.current;
    if (list.length === 0) {
      setCursor({ id: '', cycle: cycle + 1 });
      return;
    }
    const index = list.findIndex((i) => i.id === currentId);
    let next = list[(index + 1) % list.length]!;
    if (settings.shuffle && list.length > 2) {
      const others = list.filter((i) => i.id !== currentId);
      next = others[Math.floor(Math.random() * others.length)]!;
    }
    setCursor({ id: next.id, cycle: cycle + 1 });
  }, [items, settings.shuffle]);

  const handleEnded = useCallback(() => {
    errors.current = 0;
    advance();
  }, [advance]);

  const handleError = useCallback(() => {
    errors.current += 1;
    // Si todo falla, espera más antes de reintentar para no saturar.
    const wait = errors.current >= Math.max(available.length, 1) ? 20_000 : 2_000;
    setTimeout(advance, wait);
  }, [advance, available.length]);

  // Duración fija para imágenes, textos y páginas web (o si el ítem la define).
  useEffect(() => {
    if (!current) return;
    const seconds = current.duration ?? current.media.duration ?? (TIMED_KINDS.has(current.media.kind) ? settings.defaultDuration : null);
    if (!seconds) return;
    const timer = setTimeout(handleEnded, seconds * 1000);
    return () => clearTimeout(timer);
  }, [current, cursor.cycle, settings.defaultDuration, handleEnded]);

  if (!current) return <div className={cx('relative size-full overflow-hidden', className)}>{fallback}</div>;

  const Player = playerFor(current.media);
  const itemVolume = current.volume ?? 1;
  const muted = settings.muted || current.muted || !audioUnlocked;
  const volume = muted ? 0 : itemVolume * settings.volume * (ducked ? settings.duckVolume : 1);
  const transition = settings.transition === 'fade' ? 'gc-fade-in' : settings.transition === 'slide' ? 'gc-slide-in' : '';

  return (
    <div className={cx('relative size-full overflow-hidden bg-black', className)} style={{ containerType: 'size' }}>
      <div key={`${current.id}:${cursor.cycle}`} className={cx('absolute inset-0', transition)}>
        <Player media={current.media} volume={volume} muted={muted} fit={settings.fitMode} onEnded={handleEnded} onError={handleError} />
      </div>
    </div>
  );
}
