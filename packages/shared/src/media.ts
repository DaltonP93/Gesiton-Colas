import type { MediaKind, MediaProvider } from './enums';

export interface DetectedMedia {
  kind: MediaKind;
  provider: MediaProvider;
  /** URL original normalizada. */
  url: string;
  /** Identificador en la plataforma de origen (id de YouTube, Vimeo, etc.). */
  externalId?: string;
  /** URL lista para usar en un <iframe>. Puede contener `{{host}}` (Twitch). */
  embedUrl?: string;
  thumbnailUrl?: string;
  /** Duración sugerida en segundos para contenido que no informa su fin. */
  suggestedDuration?: number;
  /** Nombre sugerido para la biblioteca de medios. */
  suggestedName: string;
}

const VIDEO_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v)(\?|#|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp)(\?|#|$)/i;
const HLS_EXT = /\.m3u8(\?|#|$)/i;

function safeUrl(raw: string): URL | null {
  try {
    const trimmed = raw.trim();
    const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function host(url: URL): string {
  return url.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase();
}

function lastSegment(url: URL): string {
  return url.pathname.split('/').filter(Boolean).pop() ?? url.hostname;
}

export function parseYouTube(url: URL): { id?: string; playlistId?: string } | null {
  const h = host(url);
  if (h === 'youtu.be') {
    return { id: url.pathname.slice(1).split('/')[0] || undefined, playlistId: url.searchParams.get('list') ?? undefined };
  }
  if (!['youtube.com', 'youtube-nocookie.com', 'music.youtube.com'].includes(h)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const playlistId = url.searchParams.get('list') ?? undefined;
  if (parts[0] === 'watch') return { id: url.searchParams.get('v') ?? undefined, playlistId };
  if (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) {
    const id = parts[1] === 'videoseries' ? undefined : parts[1];
    return { id, playlistId };
  }
  if (parts[0] === 'playlist') return { playlistId };
  return null;
}

/**
 * Detecta el tipo de contenido a partir de una URL: YouTube, Vimeo, Dailymotion, Twitch,
 * Facebook, TikTok, Instagram, Google Drive/Slides, Canva, Loom, HLS, video/imagen directa
 * o cualquier página web (iframe).
 */
export function detectMedia(raw: string): DetectedMedia | null {
  const url = safeUrl(raw);
  if (!url) return null;
  const h = host(url);
  const href = url.toString();
  const parts = url.pathname.split('/').filter(Boolean);

  const yt = parseYouTube(url);
  if (yt && (yt.id || yt.playlistId)) {
    return {
      kind: 'youtube',
      provider: 'youtube',
      url: href,
      externalId: yt.id ?? yt.playlistId,
      embedUrl: yt.id
        ? `https://www.youtube-nocookie.com/embed/${yt.id}${yt.playlistId ? `?list=${yt.playlistId}` : ''}`
        : `https://www.youtube-nocookie.com/embed/videoseries?list=${yt.playlistId}`,
      thumbnailUrl: yt.id ? `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg` : undefined,
      suggestedName: yt.id ? `YouTube ${yt.id}` : `Lista YouTube ${yt.playlistId}`,
    };
  }

  if (h === 'vimeo.com' || h === 'player.vimeo.com') {
    const idx = parts.findIndex((p) => /^\d+$/.test(p));
    if (idx >= 0) {
      const id = parts[idx]!;
      const hash = url.searchParams.get('h') ?? (parts[idx + 1] && /^[a-f0-9]+$/i.test(parts[idx + 1]!) ? parts[idx + 1] : undefined);
      return {
        kind: 'vimeo',
        provider: 'vimeo',
        url: href,
        externalId: id,
        embedUrl: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ''}`,
        suggestedName: `Vimeo ${id}`,
      };
    }
  }

  if (h === 'dailymotion.com' || h === 'dai.ly') {
    const id = h === 'dai.ly' ? parts[0] : parts[0] === 'video' ? parts[1] : undefined;
    if (id) {
      return {
        kind: 'embed',
        provider: 'dailymotion',
        url: href,
        externalId: id,
        embedUrl: `https://www.dailymotion.com/embed/video/${id}?autoplay=1&mute=1&queue-enable=false`,
        thumbnailUrl: `https://www.dailymotion.com/thumbnail/video/${id}`,
        suggestedDuration: 60,
        suggestedName: `Dailymotion ${id}`,
      };
    }
  }

  if (h === 'twitch.tv' || h === 'player.twitch.tv') {
    const isVideo = parts[0] === 'videos' && parts[1];
    const channel = h === 'player.twitch.tv' ? url.searchParams.get('channel') : parts[0];
    const target = isVideo ? `video=v${parts[1]}` : channel ? `channel=${channel}` : null;
    if (target) {
      return {
        kind: 'embed',
        provider: 'twitch',
        url: href,
        externalId: isVideo ? parts[1] : channel ?? undefined,
        embedUrl: `https://player.twitch.tv/?${target}&parent={{host}}&autoplay=true&muted=true`,
        suggestedDuration: 300,
        suggestedName: `Twitch ${isVideo ? parts[1] : channel}`,
      };
    }
  }

  if (h === 'facebook.com' || h === 'fb.watch' || h === 'fb.com') {
    return {
      kind: 'embed',
      provider: 'facebook',
      url: href,
      embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false&autoplay=true&mute=1`,
      suggestedDuration: 60,
      suggestedName: 'Video de Facebook',
    };
  }

  if (h === 'tiktok.com') {
    const idx = parts.indexOf('video');
    const id = idx >= 0 ? parts[idx + 1] : undefined;
    if (id) {
      return {
        kind: 'embed',
        provider: 'tiktok',
        url: href,
        externalId: id,
        embedUrl: `https://www.tiktok.com/player/v1/${id}?autoplay=1&loop=1&controls=0&music_info=0&description=0`,
        suggestedDuration: 30,
        suggestedName: `TikTok ${id}`,
      };
    }
  }

  if (h === 'instagram.com') {
    const type = parts[0];
    const id = parts[1];
    if ((type === 'p' || type === 'reel' || type === 'tv') && id) {
      return {
        kind: 'embed',
        provider: 'instagram',
        url: href,
        externalId: id,
        embedUrl: `https://www.instagram.com/${type}/${id}/embed`,
        suggestedDuration: 20,
        suggestedName: `Instagram ${id}`,
      };
    }
  }

  if (h === 'drive.google.com') {
    const idx = parts.indexOf('d');
    const id = idx >= 0 ? parts[idx + 1] : url.searchParams.get('id');
    if (id) {
      return {
        kind: 'embed',
        provider: 'google-drive',
        url: href,
        externalId: id,
        embedUrl: `https://drive.google.com/file/d/${id}/preview`,
        suggestedDuration: 60,
        suggestedName: 'Archivo de Google Drive',
      };
    }
  }

  if (h === 'docs.google.com' && parts[0] === 'presentation') {
    const idx = parts.indexOf('d');
    const id = idx >= 0 ? parts[idx + 1] : undefined;
    if (id) {
      const published = parts[idx + 1] === 'e' ? parts[idx + 2] : undefined;
      const base = published
        ? `https://docs.google.com/presentation/d/e/${published}/embed`
        : `https://docs.google.com/presentation/d/${id}/embed`;
      return {
        kind: 'embed',
        provider: 'google-slides',
        url: href,
        externalId: published ?? id,
        embedUrl: `${base}?start=true&loop=true&delayms=8000&rm=minimal`,
        suggestedDuration: 120,
        suggestedName: 'Presentación de Google',
      };
    }
  }

  if (h === 'canva.com' && parts[0] === 'design' && parts[1]) {
    const viewPath = parts.slice(0, 3).join('/');
    return {
      kind: 'embed',
      provider: 'canva',
      url: href,
      externalId: parts[1],
      embedUrl: `https://www.canva.com/${viewPath}/view?embed`,
      suggestedDuration: 30,
      suggestedName: 'Diseño de Canva',
    };
  }

  if (h === 'loom.com' && (parts[0] === 'share' || parts[0] === 'embed') && parts[1]) {
    return {
      kind: 'embed',
      provider: 'loom',
      url: href,
      externalId: parts[1],
      embedUrl: `https://www.loom.com/embed/${parts[1]}?autoplay=1&hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true`,
      suggestedDuration: 60,
      suggestedName: 'Video de Loom',
    };
  }

  if (HLS_EXT.test(url.pathname)) {
    return { kind: 'hls', provider: 'hls', url: href, suggestedDuration: 300, suggestedName: `Transmisión ${lastSegment(url)}` };
  }
  if (VIDEO_EXT.test(url.pathname)) {
    return { kind: 'video', provider: 'direct', url: href, suggestedName: decodeURIComponent(lastSegment(url)) };
  }
  if (IMAGE_EXT.test(url.pathname)) {
    return { kind: 'image', provider: 'direct', url: href, suggestedDuration: 10, suggestedName: decodeURIComponent(lastSegment(url)) };
  }

  return { kind: 'embed', provider: 'web', url: href, embedUrl: href, suggestedDuration: 30, suggestedName: h };
}

/** Tipos MIME aceptados para subir a la biblioteca de medios. */
export const UPLOAD_MIME_TYPES: Record<string, 'video' | 'image'> = {
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/ogg': 'video',
  'video/quicktime': 'video',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/avif': 'image',
  'image/svg+xml': 'image',
};

export const PROVIDER_LABELS: Record<MediaProvider, string> = {
  upload: 'Archivo subido',
  direct: 'URL directa',
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion',
  twitch: 'Twitch',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  'google-drive': 'Google Drive',
  'google-slides': 'Google Slides',
  canva: 'Canva',
  loom: 'Loom',
  hls: 'Transmisión HLS',
  web: 'Página web',
  text: 'Texto / anuncio',
};
