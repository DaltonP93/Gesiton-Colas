import { DEFAULT_TICKET_CSS, DEFAULT_TICKET_TEMPLATE } from './config';

/** Diseños prediseñados del ticket impreso. Todos aceptan las mismas variables ({{code}}, {{header}}...). */
export interface TicketPreset {
  id: string;
  name: string;
  description: string;
  template: string;
  css: string;
}

const hide = '.t .head:empty,.t .note:empty,.t .priority:empty,.t .customer:empty{display:none}';

export const TICKET_PRESETS: TicketPreset[] = [
  {
    id: 'classic',
    name: 'Clásico',
    description: 'Logo, organización, número grande y QR de seguimiento.',
    template: DEFAULT_TICKET_TEMPLATE,
    css: DEFAULT_TICKET_CSS,
  },
  {
    id: 'bold',
    name: 'Número destacado',
    description: 'El número en un recuadro negro, ideal para leer de lejos.',
    template: `<div class="t">
  {{logo}}
  <div class="head">{{header}}</div>
  <div class="org">{{organization}}</div>
  <div class="box">
    <div class="label">Su turno</div>
    <div class="code">{{code}}</div>
  </div>
  <div class="service">{{service}}</div>
  <div class="priority">{{priority}}</div>
  <div class="customer">{{customer}}</div>
  <div class="row"><span>{{date}}</span><span>{{time}}</span></div>
  <div class="row"><span>Antes que usted</span><strong>{{waiting}}</strong></div>
  {{qr}}
  <div class="note">{{footer}}</div>
</div>`,
    css: `.t{font-family:system-ui,sans-serif;color:#000;padding:4mm 3mm;text-align:center}
.t img.logo{max-width:44mm;max-height:18mm;margin:0 auto 2mm;display:block}
.t .org{font-weight:700;font-size:12pt;margin-bottom:2mm}
.t .box{background:#000;color:#fff;border-radius:3mm;padding:2mm 0 3mm;margin:1mm 0 2mm}
.t .label{font-size:9pt;letter-spacing:2px;text-transform:uppercase}
.t .code{font-size:46pt;font-weight:900;line-height:1}
.t .service{font-size:13pt;font-weight:700}
.t .priority{font-size:10pt;font-weight:700;border:1px solid #000;border-radius:2mm;display:inline-block;padding:0 2mm;margin-top:1mm}
.t .customer{font-size:10pt;margin-top:1mm}
.t .row{display:flex;justify-content:space-between;font-size:9pt;border-top:1px dashed #000;padding:1.2mm 0;margin-top:1.5mm}
.t img.qr{width:26mm;height:26mm;margin:2mm auto 0;display:block}
.t .head,.t .note{font-size:9pt;margin:1mm 0}
${hide}`,
  },
  {
    id: 'compact',
    name: 'Compacto',
    description: 'Solo lo esencial, gasta menos papel. Sin QR.',
    template: `<div class="t">
  <div class="head">{{header}}</div>
  <div class="org">{{organization}} · {{branch}}</div>
  <div class="code">{{code}}</div>
  <div class="service">{{service}}</div>
  <div class="priority">{{priority}}</div>
  <div class="meta">{{date}} {{time}} · Antes que usted: {{waiting}}</div>
  <div class="note">{{footer}}</div>
</div>`,
    css: `.t{font-family:system-ui,sans-serif;text-align:center;color:#000;padding:2mm}
.t .org{font-size:9pt;font-weight:600}
.t .code{font-size:36pt;font-weight:800;line-height:1.05;margin:1mm 0}
.t .service{font-size:11pt;font-weight:600}
.t .priority{font-size:9pt}
.t .meta{font-size:8pt;margin-top:1mm}
.t .head,.t .note{font-size:8pt}
${hide}`,
  },
  {
    id: 'brand',
    name: 'Con marca',
    description: 'Logo grande arriba, mensaje de bienvenida y pie con sus datos.',
    template: `<div class="t">
  <div class="brand">{{logo}}</div>
  <div class="head">{{header}}</div>
  <div class="hello">Gracias por visitarnos</div>
  <div class="code">{{code}}</div>
  <div class="service">{{service}}</div>
  <div class="priority">{{priority}}</div>
  <div class="meta">{{branch}} · {{date}} {{time}}</div>
  <div class="meta">Personas antes que usted: <strong>{{waiting}}</strong></div>
  {{qr}}
  <div class="foot">Siga su turno desde el celular</div>
  <div class="note">{{footer}}</div>
</div>`,
    css: `.t{font-family:Georgia,'Times New Roman',serif;text-align:center;color:#000;padding:4mm 2mm}
.t .brand img.logo{max-width:56mm;max-height:26mm;margin:0 auto 3mm;display:block}
.t .hello{font-style:italic;font-size:11pt;margin-bottom:1mm}
.t .code{font-family:system-ui,sans-serif;font-size:42pt;font-weight:800;line-height:1.05;border-top:2px solid #000;border-bottom:2px solid #000;padding:1mm 0;margin:1mm 6mm}
.t .service{font-family:system-ui,sans-serif;font-size:13pt;font-weight:700;margin-top:2mm}
.t .priority{font-family:system-ui,sans-serif;font-size:10pt}
.t .meta{font-size:9pt;margin-top:1mm}
.t img.qr{width:26mm;height:26mm;margin:3mm auto 1mm;display:block}
.t .foot{font-size:8pt}
.t .head,.t .note{font-size:9pt;margin:1mm 0}
${hide}`,
  },
  {
    id: 'number',
    name: 'Solo el número',
    description: 'Número gigante y servicio. Para filas rápidas.',
    template: `<div class="t">
  <div class="code">{{code}}</div>
  <div class="service">{{service}}</div>
  <div class="priority">{{priority}}</div>
  <div class="note">{{footer}}</div>
</div>`,
    css: `.t{font-family:system-ui,sans-serif;text-align:center;color:#000;padding:3mm 1mm}
.t .code{font-size:60pt;font-weight:900;line-height:1}
.t .service{font-size:12pt;font-weight:700}
.t .priority{font-size:10pt}
.t .note{font-size:8pt;margin-top:1mm}
${hide}`,
  },
];

/** Diseño que coincide con la plantilla y el CSS guardados (o null si fueron editados a mano). */
export function matchTicketPreset(template: string, css: string): TicketPreset | null {
  const norm = (v: string) => v.replace(/\s+/g, ' ').trim();
  return TICKET_PRESETS.find((p) => norm(p.template) === norm(template) && norm(p.css) === norm(css)) ?? null;
}
