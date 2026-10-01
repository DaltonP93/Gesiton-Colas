import { useEffect, useRef } from 'react';
import { parseYouTube, type MediaDTO } from '@gc/shared';
import { cx } from '../../components/ui';
import { assetUrl } from '../../lib/api';

export interface PlayerProps {
  media: MediaDTO;
  /** Volumen efectivo 0-1 (ya incluye silencio, volumen del ítem y atenuación). */
  volume: number;
  muted: boolean;
  fit: 'contain' | 'cover';
  onEnded: () => void;
  onError: () => void;
}

/** Mantiene una referencia a la última versión de un callback (evita re-suscripciones). */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/* ------------------------------------------------------------------ */
/* Video HTML5 (archivo subido, URL directa o HLS)                     */
/* ------------------------------------------------------------------ */

export function VideoPlayer({ media, volume, muted, fit, onEnded, onError }: PlayerProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const ended = useLatest(onEnded);
  const failed = useLatest(onError);
  const src = assetUrl(media.url);
  const isHls = media.kind === 'hls';

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let hls: { destroy(): void } | null = null;
    let cancelled = false;
    video.muted = muted || volume === 0;
    video.volume = clamp(volume);

    const start = () => {
      video.play()?.catch((error: DOMException) => {
        if (cancelled) return;
        // Si el navegador bloquea el audio, reproduce en silencio.
        if (error.name === 'NotAllowedError') {
          video.muted = true;
          video.play().catch(() => failed.current());
        }
      });
    };

    if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
      import('hls.js')
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) return failed.current();
          const instance = new Hls({ lowLatencyMode: true });
          hls = instance;
          instance.on(Hls.Events.ERROR, (_e, data) => data.fatal && failed.current());
          instance.loadSource(src);
          instance.attachMedia(video);
          instance.on(Hls.Events.MANIFEST_PARSED, start);
        })
        .catch(() => failed.current());
    } else {
      video.src = src;
      start();
    }
    return () => {
      cancelled = true;
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [src, isHls]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.volume = clamp(volume);
    video.muted = muted || volume === 0;
  }, [volume, muted]);

  return (
    <video
      ref={ref}
      playsInline
      autoPlay
      preload="auto"
      onEnded={() => ended.current()}
      onError={() => failed.current()}
      className={cx('absolute inset-0 size-full bg-black', fit === 'cover' ? 'object-cover' : 'object-contain')}
    />
  );
}

/* ------------------------------------------------------------------ */
/* YouTube (IFrame API)                                                */
/* ------------------------------------------------------------------ */

interface YTPlayer {
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  playVideo(): void;
  destroy(): void;
  getPlaylist(): string[] | null;
  getPlaylistIndex(): number;
}
interface YTNamespace {
  Player: new (el: HTMLElement, options: Record<string, unknown>) => YTPlayer;
  PlayerState: { ENDED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youTubeApi: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youTubeApi) {
    youTubeApi = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (window.YT) resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        youTubeApi = null;
        reject(new Error('No se pudo cargar YouTube'));
      };
      document.head.appendChild(script);
    });
  }
  return youTubeApi;
}

export function YouTubePlayer({ media, volume, muted, onEnded, onError }: PlayerProps) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ended = useLatest(onEnded);
  const failed = useLatest(onError);
  const audio = useLatest({ volume, muted });

  useEffect(() => {
    let destroyed = false;
    let parsed: ReturnType<typeof parseYouTube> = null;
    try {
      parsed = parseYouTube(new URL(media.url));
    } catch {
      parsed = null;
    }
    if (!parsed || (!parsed.id && !parsed.playlistId)) {
      failed.current();
      return;
    }
    const { id, playlistId } = parsed;
    loadYouTubeApi()
      .then((YT) => {
        if (destroyed || !host.current) return;
        const el = document.createElement('div');
        host.current.appendChild(el);
        player.current = new YT.Player(el, {
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          ...(id ? { videoId: id } : {}),
          playerVars: {
            autoplay: 1,
            controls: 0,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            mute: audio.current.muted ? 1 : 0,
            origin: window.location.origin,
            ...(playlistId ? { listType: 'playlist', list: playlistId } : {}),
          },
          events: {
            onReady: (e: { target: YTPlayer }) => {
              e.target.setVolume(Math.round(clamp(audio.current.volume) * 100));
              if (audio.current.muted) e.target.mute();
              else e.target.unMute();
              e.target.playVideo();
            },
            onStateChange: (e: { data: number; target: YTPlayer }) => {
              if (e.data !== YT.PlayerState.ENDED) return;
              const list = e.target.getPlaylist();
              // En listas de YouTube, avanza solo al terminar el último video.
              if (!list || e.target.getPlaylistIndex() >= list.length - 1) ended.current();
            },
            onError: () => failed.current(),
          },
        });
      })
      .catch(() => failed.current());
    return () => {
      destroyed = true;
      try {
        player.current?.destroy();
      } catch {
        /* ignorar */
      }
      player.current = null;
      if (host.current) host.current.innerHTML = '';
    };
  }, [media.id, media.url]);

  useEffect(() => {
    const p = player.current;
    if (!p?.setVolume) return;
    p.setVolume(Math.round(clamp(volume) * 100));
    if (muted) p.mute();
    else p.unMute();
  }, [volume, muted]);

  return <div ref={host} className="pointer-events-none absolute inset-0 bg-black [&_iframe]:size-full" />;
}

/* ------------------------------------------------------------------ */
/* Vimeo (API por postMessage)                                         */
/* ------------------------------------------------------------------ */

export function VimeoPlayer({ media, volume, muted, onEnded, onError }: PlayerProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const ended = useLatest(onEnded);
  const audio = useLatest({ volume, muted });
  const base = media.embedUrl ?? `https://player.vimeo.com/video/${media.externalId}`;
  const src = `${base}${base.includes('?') ? '&' : '?'}autoplay=1&muted=${muted ? 1 : 0}&controls=0&dnt=1&title=0&byline=0&portrait=0&autopause=0`;

  const post = (method: string, value?: unknown) =>
    ref.current?.contentWindow?.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), 'https://player.vimeo.com');

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://player.vimeo.com' || event.source !== ref.current?.contentWindow) return;
      let data: { event?: string };
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data.event === 'ready') {
        post('addEventListener', 'ended');
        post('addEventListener', 'error');
        post('setVolume', audio.current.muted ? 0 : clamp(audio.current.volume));
        if (!audio.current.muted) post('setMuted', false);
        post('play');
      } else if (data.event === 'ended') {
        ended.current();
      } else if (data.event === 'error') {
        onError();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    post('setVolume', muted ? 0 : clamp(volume));
    post('setMuted', muted || volume === 0);
  }, [volume, muted]);

  return (
    <iframe
      ref={ref}
      src={src}
      title={media.name}
      allow="autoplay; fullscreen; picture-in-picture"
      className="pointer-events-none absolute inset-0 size-full border-0 bg-black"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Contenido embebido: TikTok, Instagram, Canva, Slides, web...        */
/* ------------------------------------------------------------------ */

/** Contenido del mismo origen que la aplicación: se aísla por completo (sin acceso a la sesión). */
function sameOrigin(src: string) {
  try {
    return new URL(src, window.location.href).origin === window.location.origin;
  } catch {
    return true;
  }
}

export function EmbedPlayer({ media }: PlayerProps) {
  const src = (media.embedUrl ?? media.url).replace(/\{\{host\}\}/g, window.location.hostname);
  return (
    <iframe
      src={src}
      title={media.name}
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      // Sin allow-top-navigation: el contenido no puede sacar a la pantalla de la página.
      sandbox={sameOrigin(src) ? 'allow-scripts allow-presentation' : 'allow-scripts allow-same-origin allow-presentation allow-popups'}
      referrerPolicy="strict-origin-when-cross-origin"
      className="absolute inset-0 size-full border-0 bg-white"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Imagen y texto                                                      */
/* ------------------------------------------------------------------ */

export function ImageSlide({ media, fit, onError }: PlayerProps) {
  const src = assetUrl(media.url);
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {fit === 'contain' && <img src={src} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-2xl" />}
      <img src={src} alt={media.name} onError={onError} className={cx('absolute inset-0 size-full', fit === 'cover' ? 'object-cover' : 'object-contain')} />
    </div>
  );
}

export function TextSlide({ media }: PlayerProps) {
  const text = media.text ?? { content: media.name, background: '#1e3a8a', color: '#ffffff' };
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-[6%] text-center" style={{ background: text.background, color: text.color }}>
      <p className="font-extrabold leading-tight tracking-tight" style={{ fontSize: 'clamp(1.5rem, 6.5cqmin, 7rem)' }}>
        {text.content}
      </p>
      {text.subtitle && (
        <p className="mt-[3%] font-medium opacity-85" style={{ fontSize: 'clamp(1rem, 3.2cqmin, 3.5rem)' }}>
          {text.subtitle}
        </p>
      )}
    </div>
  );
}

/** Audio dentro de una lista: suena con una visualización de la marca. */
export function AudioSlide({ media, volume, muted, onEnded, onError }: PlayerProps) {
  const ref = useRef<HTMLAudioElement>(null);
  const ended = useLatest(onEnded);
  const failed = useLatest(onError);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.volume = clamp(volume);
    audio.muted = muted;
    audio.play().catch((error: DOMException) => {
      if (error.name === 'NotAllowedError') {
        audio.muted = true;
        void audio.play().catch(() => failed.current());
      } else failed.current();
    });
  }, [media.url]);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.volume = clamp(volume);
    ref.current.muted = muted;
  }, [volume, muted]);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[4%] bg-gradient-to-br from-indigo-900 via-slate-900 to-black text-white">
      <div className="flex h-[22%] items-end gap-[1.2%]" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <span
            key={i}
            className="w-[1.2vw] rounded-full bg-white/80"
            style={{ height: '100%', animation: `gc-eq ${0.7 + (i % 4) * 0.18}s ease-in-out ${i * 0.07}s infinite alternate` }}
          />
        ))}
      </div>
      <p className="px-[6%] text-center font-bold" style={{ fontSize: 'clamp(1rem, 4.5cqmin, 4rem)' }}>
        ♪ {media.name}
      </p>
      <audio ref={ref} src={assetUrl(media.url)} autoPlay onEnded={() => ended.current()} onError={() => failed.current()} />
    </div>
  );
}

export function playerFor(media: MediaDTO) {
  switch (media.kind) {
    case 'video':
    case 'hls':
      return VideoPlayer;
    case 'youtube':
      return YouTubePlayer;
    case 'vimeo':
      return VimeoPlayer;
    case 'image':
      return ImageSlide;
    case 'audio':
      return AudioSlide;
    case 'text':
      return TextSlide;
    default:
      return EmbedPlayer;
  }
}

/** Tipos cuyo fin no se detecta: se muestran durante un tiempo fijo. */
export const TIMED_KINDS = new Set(['image', 'text', 'embed']);
