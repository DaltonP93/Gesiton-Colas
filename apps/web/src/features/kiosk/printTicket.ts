import DOMPurify from 'dompurify';
import { escapeHtml, renderTemplate, type KioskConfig, type TemplateVars } from '@gc/shared';

export interface TicketPrintData {
  vars: TemplateVars;
  qrDataUrl?: string | null;
  logoUrl?: string | null;
}

/** Arma el HTML del ticket a partir de la plantilla configurable del kiosco (sanitizado). */
export function buildTicketHtml(print: KioskConfig['print'], data: TicketPrintData): string {
  const body = renderTemplate(
    print.template,
    {
      ...data.vars,
      qr: data.qrDataUrl ? `<img class="qr" src="${data.qrDataUrl}" alt="QR">` : '',
      logo: data.logoUrl ? `<img class="logo" src="${escapeHtml(data.logoUrl)}" alt="">` : '',
    },
    { html: true, raw: ['qr', 'logo'] },
  );
  const clean = DOMPurify.sanitize(body, { ALLOWED_URI_REGEXP: /^(?:https?:|data:image\/|\/)/i });
  const css = print.css.replace(/<\/style/gi, '');
  const width = print.paperWidthMm;
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${width}mm auto;margin:0}html,body{margin:0;padding:0;width:${width}mm;background:#fff}${css}</style></head><body>${clean}</body></html>`;
}

/** Imprime el ticket en un iframe oculto (compatible con impresoras térmicas de 58/80 mm). */
export async function printTicket(print: KioskConfig['print'], data: TicketPrintData): Promise<void> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  const loaded = new Promise<void>((resolve) => (iframe.onload = () => resolve()));
  iframe.srcdoc = buildTicketHtml(print, data);
  document.body.appendChild(iframe);
  await loaded;
  const doc = iframe.contentDocument;
  if (doc) {
    await Promise.all(
      Array.from(doc.images).map((img) =>
        img.complete ? null : new Promise((resolve) => ((img.onload = resolve), (img.onerror = resolve))),
      ),
    );
  }
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  setTimeout(() => iframe.remove(), 2000);
}
