/* ------------------------------------------------------------------ */
/* Guía de cada plataforma de la biblioteca de medios                   */
/* ------------------------------------------------------------------ */

export interface MediaGuide {
  id: string;
  label: string;
  /** Cómo se agrega: pegando un enlace o subiendo el archivo. */
  via: 'url' | 'upload' | 'both';
  summary: string;
  /** Pasos para conseguir el enlace (o el archivo). */
  steps: string[];
  examples: string[];
  /** Qué tener en cuenta para que se vea en la pantalla. */
  notes: string[];
}

export const MEDIA_GUIDES: MediaGuide[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    via: 'url',
    summary: 'Videos, Shorts y listas de reproducción de YouTube.',
    steps: ['Abra el video (o la lista de reproducción) en YouTube.', 'Toque «Compartir» → «Copiar enlace», o copie la dirección del navegador.', 'Péguelo en «Desde URL».'],
    examples: ['https://www.youtube.com/watch?v=VIDEO', 'https://youtu.be/VIDEO', 'https://www.youtube.com/shorts/VIDEO', 'https://www.youtube.com/playlist?list=LISTA'],
    notes: [
      'El video tiene que ser público o «no listado»; los privados no se ven.',
      'Si el dueño desactivó la inserción en otros sitios, YouTube no lo deja reproducir.',
      'Con una lista de reproducción se pasan todos sus videos, y lo que se agregue a la lista aparece solo.',
      'Use el enlace de un video o de una lista, no el de un canal.',
    ],
  },
  {
    id: 'vimeo',
    label: 'Vimeo',
    via: 'url',
    summary: 'Videos de Vimeo, también los no listados.',
    steps: ['Abra el video en Vimeo.', 'Toque «Compartir» y copie el enlace.', 'Péguelo en «Desde URL».'],
    examples: ['https://vimeo.com/123456789', 'https://vimeo.com/123456789/abcdef1234 (no listado)'],
    notes: [
      'En la configuración del video, «Privacidad → Dónde se puede insertar» tiene que permitir cualquier sitio (o la dirección de este sistema).',
      'Para videos no listados copie el enlace completo, que incluye el código después del número.',
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    via: 'url',
    summary: 'Videos públicos de TikTok.',
    steps: ['Abra el video en TikTok.', '«Compartir» → «Copiar enlace».', 'Si el enlace es corto (vm.tiktok.com), ábralo en el navegador y copie la dirección completa, que tiene «/video/» y un número.'],
    examples: ['https://www.tiktok.com/@cuenta/video/7300000000000000000'],
    notes: ['La cuenta y el video tienen que ser públicos.', 'Se repite mientras dure en la lista (indique la duración en segundos).'],
  },
  {
    id: 'instagram',
    label: 'Instagram',
    via: 'url',
    summary: 'Publicaciones y reels de cuentas públicas.',
    steps: ['Abra la publicación o el reel.', 'Toque «…» → «Copiar enlace».', 'Péguelo en «Desde URL».'],
    examples: ['https://www.instagram.com/p/CODIGO/', 'https://www.instagram.com/reel/CODIGO/'],
    notes: [
      'Solo cuentas públicas. Use el enlace de una publicación o un reel, no el del perfil.',
      'Instagram lo muestra con su marco (nombre de la cuenta y botón «Ver en Instagram»). Para que se vea a pantalla completa, descargue el video y súbalo.',
    ],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    via: 'url',
    summary: 'Videos públicos de páginas de Facebook.',
    steps: ['Abra el video en Facebook.', '«Compartir» → «Copiar enlace».', 'Péguelo en «Desde URL».'],
    examples: ['https://www.facebook.com/pagina/videos/1234567890/', 'https://fb.watch/CODIGO/'],
    notes: ['El video tiene que ser público y de una página. Los de perfiles personales o grupos privados no se muestran.'],
  },
  {
    id: 'twitch',
    label: 'Twitch',
    via: 'url',
    summary: 'Un canal en vivo o un video guardado de Twitch.',
    steps: ['Copie la dirección del canal (para el vivo) o del video.', 'Péguela en «Desde URL».'],
    examples: ['https://www.twitch.tv/canal', 'https://www.twitch.tv/videos/1234567890'],
    notes: ['Twitch solo se muestra si el sistema se abre con un dominio propio y HTTPS (no por dirección IP).', 'Un canal sin transmisión en vivo se ve en negro.'],
  },
  {
    id: 'dailymotion',
    label: 'Dailymotion',
    via: 'url',
    summary: 'Videos de Dailymotion.',
    steps: ['Abra el video → «Compartir» → copie el enlace.', 'Péguelo en «Desde URL».'],
    examples: ['https://www.dailymotion.com/video/x8abcd1', 'https://dai.ly/x8abcd1'],
    notes: ['El video tiene que ser público y permitir insertarse.'],
  },
  {
    id: 'google-drive',
    label: 'Google Drive',
    via: 'url',
    summary: 'Videos, imágenes y PDF guardados en Google Drive.',
    steps: ['Haga clic derecho en el archivo → «Compartir».', 'En «Acceso general» elija «Cualquier persona con el enlace» (Lector).', '«Copiar enlace» y péguelo en «Desde URL».'],
    examples: ['https://drive.google.com/file/d/ID/view'],
    notes: [
      'Comparta un archivo, no una carpeta.',
      'Drive muestra el archivo con su propio reproductor y limita las reproducciones de videos muy vistos: para un video que se pasa todo el día conviene subirlo aquí con «Subir archivos».',
    ],
  },
  {
    id: 'google-slides',
    label: 'Google Slides',
    via: 'url',
    summary: 'Presentaciones que avanzan solas y vuelven a empezar.',
    steps: ['En la presentación: «Archivo» → «Compartir» → «Publicar en la Web».', 'Elija «Vínculo» y toque «Publicar».', 'Copie el enlace y péguelo en «Desde URL».'],
    examples: ['https://docs.google.com/presentation/d/e/2PACX-CODIGO/pub'],
    notes: [
      'Cada diapositiva se muestra 8 segundos; al terminar vuelve a empezar.',
      'Los cambios que haga en la presentación aparecen solos en las pantallas.',
      'También sirve el enlace para compartir si la presentación es visible para «Cualquier persona con el enlace».',
    ],
  },
  {
    id: 'canva',
    label: 'Canva',
    via: 'url',
    summary: 'Diseños y presentaciones de Canva.',
    steps: ['Abra el diseño → «Compartir» → «Ver más» → «Insertar».', 'Toque «Insertar» y copie el enlace (o use un enlace público de «Solo ver»).', 'Péguelo en «Desde URL».'],
    examples: ['https://www.canva.com/design/DAF.../view?embed'],
    notes: ['Para videos o animaciones de Canva es mejor «Compartir» → «Descargar» como MP4 y subirlo: se ve a pantalla completa y no depende de internet.'],
  },
  {
    id: 'loom',
    label: 'Loom',
    via: 'url',
    summary: 'Grabaciones de Loom.',
    steps: ['Abra la grabación → «Share» → «Copy link».', 'Péguelo en «Desde URL».'],
    examples: ['https://www.loom.com/share/CODIGO'],
    notes: ['La grabación tiene que ser visible para cualquier persona con el enlace.'],
  },
  {
    id: 'hls',
    label: 'HLS / m3u8',
    via: 'url',
    summary: 'Transmisiones en vivo: cámaras, canales de TV o su propio servidor de streaming.',
    steps: ['Consiga la dirección .m3u8 de la transmisión (en el panel del servidor de streaming o de la cámara).', 'Péguela en «Desde URL» e indique cuánto tiempo mostrarla.'],
    examples: ['https://servidor.com/en-vivo/index.m3u8'],
    notes: ['El servidor tiene que permitir la reproducción desde otros sitios (encabezados CORS).', 'Use https:// si el sistema se abre con https.'],
  },
  {
    id: 'video',
    label: 'MP4 / WebM',
    via: 'both',
    summary: 'Sus propios videos: la mejor calidad y sin depender de otras plataformas.',
    steps: ['Con «Subir archivos» elija o arrastre los videos desde su computadora.', 'O pegue en «Desde URL» la dirección de un video que termine en .mp4 o .webm.'],
    examples: ['https://suempresa.com/videos/promo.mp4'],
    notes: ['Recomendado: MP4 (H.264) en 1920 × 1080. Los videos subidos se guardan en el sistema y se reproducen aunque internet ande lento.', 'El tamaño máximo por archivo depende del plan.'],
  },
  {
    id: 'image',
    label: 'Imágenes',
    via: 'both',
    summary: 'Afiches, promociones y avisos en JPG, PNG, WebP o GIF.',
    steps: ['Con «Subir archivos» elija las imágenes.', 'O pegue en «Desde URL» la dirección de una imagen (.jpg, .png, .webp, .gif).'],
    examples: ['https://suempresa.com/afiches/promo.jpg'],
    notes: ['Para que ocupen toda la pantalla use 1920 × 1080 (horizontal) o 1080 × 1920 si la TV está vertical.', 'Indique cuántos segundos se muestra cada una.'],
  },
  {
    id: 'audio',
    label: 'MP3 / radios',
    via: 'both',
    summary: 'Música ambiental, sonidos de llamado y radios online.',
    steps: ['Con «Subir archivos» suba sus MP3 (o M4A, OGG, WAV).', 'Para una radio online pegue su dirección en «Desde URL» y active «Es una radio o audio por streaming».'],
    examples: ['https://radio.suempresa.com:8000/stream'],
    notes: ['La música se elige en cada pantalla (música ambiental) y baja sola durante los llamados.', 'Verifique que tiene permiso para pasar la música en un lugar público (derechos de autor).'],
  },
  {
    id: 'web',
    label: 'Páginas web',
    via: 'url',
    summary: 'Cualquier página que permita mostrarse dentro de otra: tableros, clima, noticias propias.',
    steps: ['Copie la dirección completa de la página (con https://).', 'Péguela en «Desde URL» y mire la vista previa.'],
    examples: ['https://suempresa.com/tablero'],
    notes: [
      'Muchos sitios (Google, bancos, redes sociales, diarios) no se dejan mostrar dentro de otra página: la pantalla queda en blanco. La vista previa le muestra si funciona.',
      'Use https://: las páginas http:// no se muestran dentro de un sistema que se abre con https.',
    ],
  },
];

export const mediaGuide = (id: string) => MEDIA_GUIDES.find((g) => g.id === id);

/** Guía que corresponde al contenido detectado. */
export function guideForProvider(provider: string, kind?: string): MediaGuide | undefined {
  if (provider === 'direct') return mediaGuide(kind === 'image' ? 'image' : kind === 'audio' ? 'audio' : 'video');
  return mediaGuide(provider);
}

/**
 * Aviso para enlaces que se reconocen pero no sirven tal como están (perfil en vez de publicación,
 * carpeta de Drive, enlace corto, http dentro de https).
 */
export function mediaUrlHint(raw: string, pageProtocol?: string): { guide?: string; warning: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const h = url.hostname.replace(/^(www\.|m\.|mobile\.)/, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (/(^|\.)tiktok\.com$/.test(h) && (h !== 'tiktok.com' || !parts.includes('video'))) {
    return { guide: 'tiktok', warning: 'Este enlace de TikTok no es el de un video. Si es corto (vm.tiktok.com), ábralo en el navegador y copie la dirección completa con «/video/».' };
  }
  if (h === 'instagram.com' && !['p', 'reel', 'tv'].includes(parts[0] ?? '')) {
    return { guide: 'instagram', warning: 'Use el enlace de una publicación o un reel (instagram.com/p/… o /reel/…), no el del perfil.' };
  }
  if ((h === 'youtube.com' || h === 'youtu.be') && (parts[0]?.startsWith('@') || ['channel', 'c', 'user'].includes(parts[0] ?? ''))) {
    return { guide: 'youtube', warning: 'Es el enlace de un canal: use el de un video o el de una lista de reproducción.' };
  }
  if (h === 'drive.google.com' && parts.includes('folders')) {
    return { guide: 'google-drive', warning: 'Es una carpeta: comparta y pegue el enlace de un archivo.' };
  }
  if (h === 'docs.google.com' && parts[0] !== 'presentation') {
    return { guide: 'google-slides', warning: 'Solo las presentaciones se pasan solas. Los documentos y hojas se muestran como página web si están publicados en la Web.' };
  }
  if (h === 'canva.com' && parts[0] !== 'design') {
    return { guide: 'canva', warning: 'Use el enlace de un diseño (canva.com/design/…).' };
  }
  if (pageProtocol === 'https:' && url.protocol === 'http:') {
    return { warning: 'El enlace empieza con http://: dentro de un sistema con https el navegador lo bloquea. Use la dirección con https:// si existe.' };
  }
  return null;
}
