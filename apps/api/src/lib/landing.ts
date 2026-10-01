import { landingPlansOf, type PlatformSettings } from '@gc/shared';

/** Planes de la sección de precios (configuración pública). */
export const landingPlans = (settings: PlatformSettings) => landingPlansOf(settings);

/** Qué abre la dirección principal: la presentación despublicada pasa al ingreso. */
export function effectiveHomePage(settings: PlatformSettings): PlatformSettings['homePage'] {
  return settings.homePage === 'landing' && !settings.landing.enabled ? 'login' : settings.homePage;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const absolute = (base: string, url: string | null) => (!url ? null : /^https?:\/\//i.test(url) ? url : `${base.replace(/\/$/, '')}${url}`);

/**
 * Título, descripción e imagen de la presentación en el HTML que se sirve (para buscadores y para la vista previa
 * al compartir el enlace por WhatsApp, Facebook o LinkedIn, que no ejecutan JavaScript).
 */
export function landingHead(html: string, settings: PlatformSettings, publicUrl: string): string {
  const { landing, brand } = settings;
  const title = landing.seo.title || brand.appName;
  const description = landing.seo.description || landing.hero.subtitle.replaceAll('{{nombre}}', brand.appName);
  const imageUrl = absolute(publicUrl, landing.seo.imageUrl ?? landing.hero.imageUrl ?? brand.logoUrl);
  const tags = [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(brand.appName)}" />`,
    ...(imageUrl ? [`<meta property="og:image" content="${escapeHtml(imageUrl)}" />`] : []),
    `<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}" />`,
  ].join('\n    ');
  const clean = html.replace(/\s*<meta name="description"[^>]*>/i, '');
  const withTitle = /<title>[\s\S]*?<\/title>/i.test(clean)
    ? clean.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    : clean.replace(/<head>/i, `<head>\n    <title>${escapeHtml(title)}</title>`);
  return withTitle.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}
