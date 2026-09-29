import { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaDTO } from '@gc/shared';
import { assetUrl } from '../../lib/api';

/**
 * Música ambiental de la sala de espera: reproduce los audios elegidos uno tras otro
 * (o en orden aleatorio) y baja el volumen mientras se anuncia un turno.
 */
export function BackgroundMusic({
  tracks,
  volume,
  shuffle,
  ducked,
  duckVolume,
  enabled,
}: {
  tracks: MediaDTO[];
  volume: number;
  shuffle: boolean;
  ducked: boolean;
  duckVolume: number;
  enabled: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const order = useMemo(() => {
    const list = [...tracks];
    if (shuffle) list.sort(() => Math.random() - 0.5);
    return list;
  }, [tracks, shuffle]);
  const current = order.length ? order[index % order.length] : null;

  const next = () => setIndex((i) => (order.length ? (i + 1) % order.length : 0));

  useEffect(() => {
    const audio = ref.current;
    if (!audio || !current || !enabled) return;
    audio.play().catch(() => undefined);
  }, [current, enabled]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    // Transición suave del volumen al empezar y terminar cada anuncio.
    const target = Math.min(1, Math.max(0, volume * (ducked ? duckVolume : 1)));
    const step = (target - audio.volume) / 10;
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      audio.volume = n >= 10 ? target : Math.min(1, Math.max(0, audio.volume + step));
      if (n >= 10) clearInterval(timer);
    }, 40);
    return () => clearInterval(timer);
  }, [volume, ducked, duckVolume]);

  if (!current || !enabled) return null;
  return (
    <audio
      ref={ref}
      key={`${current.id}-${index}`}
      src={assetUrl(current.url)}
      autoPlay
      onEnded={next}
      onError={() => setTimeout(next, 3000)}
      className="hidden"
    />
  );
}
