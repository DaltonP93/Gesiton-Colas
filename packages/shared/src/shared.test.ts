import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TICKET_CSS,
  DEFAULT_TICKET_TEMPLATE,
  TICKET_PRESETS,
  codeForSpeech,
  defaultDisplayConfig,
  kioskConfigSchema,
  matchTicketPreset,
  deepMerge,
  detectMedia,
  displayConfigSchema,
  formatTicketCode,
  isScheduleActive,
  normalizeConfig,
  renderTemplate,
  tenantSettingsSchema,
} from './index';

describe('detectMedia', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=10', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/abcDEF12345', 'youtube', 'abcDEF12345'],
    ['https://www.youtube.com/playlist?list=PL123', 'youtube', 'PL123'],
    ['https://vimeo.com/76979871', 'vimeo', '76979871'],
    ['https://player.vimeo.com/video/76979871?h=abc', 'vimeo', '76979871'],
  ])('%s → %s', (url, kind, id) => {
    const media = detectMedia(url)!;
    expect(media.kind).toBe(kind);
    expect(media.externalId).toBe(id);
    expect(media.embedUrl).toBeTruthy();
  });

  it('detecta plataformas embebibles', () => {
    expect(detectMedia('https://www.dailymotion.com/video/x7tgad0')!.provider).toBe('dailymotion');
    expect(detectMedia('https://www.twitch.tv/somechannel')!.embedUrl).toContain('channel=somechannel');
    expect(detectMedia('https://www.tiktok.com/@user/video/7234567890123')!.provider).toBe('tiktok');
    expect(detectMedia('https://www.instagram.com/reel/Cabc123/')!.embedUrl).toBe('https://www.instagram.com/reel/Cabc123/embed');
    expect(detectMedia('https://drive.google.com/file/d/FILEID/view?usp=sharing')!.embedUrl).toBe(
      'https://drive.google.com/file/d/FILEID/preview',
    );
    expect(detectMedia('https://docs.google.com/presentation/d/PRES/edit')!.provider).toBe('google-slides');
    expect(detectMedia('https://www.canva.com/design/DAF123/xyz/view')!.provider).toBe('canva');
    expect(detectMedia('https://www.loom.com/share/abc123')!.provider).toBe('loom');
    expect(detectMedia('https://www.facebook.com/page/videos/123456/')!.provider).toBe('facebook');
  });

  it('detecta archivos directos y streams', () => {
    expect(detectMedia('https://cdn.example.com/promo.mp4')!.kind).toBe('video');
    expect(detectMedia('https://cdn.example.com/live/index.m3u8')!.kind).toBe('hls');
    expect(detectMedia('https://cdn.example.com/banner.webp?v=2')!.kind).toBe('image');
    expect(detectMedia('example.com/menu')!).toMatchObject({ kind: 'embed', provider: 'web' });
    expect(detectMedia('https://cdn.example.com/musica/tema.mp3')!.kind).toBe('audio');
    expect(detectMedia('https://cdn.example.com/aviso.ogg')!.kind).toBe('audio');
    expect(detectMedia('https://cdn.example.com/clip.ogv')!.kind).toBe('video');
  });

  it('rechaza URLs inválidas', () => {
    expect(detectMedia('javascript:alert(1)')).toBeNull();
    expect(detectMedia('')).toBeNull();
  });
});

describe('renderTemplate', () => {
  it('reemplaza variables y etiquetas antiguas', () => {
    expect(renderTemplate('Turno {{ code }} a {{counter}}', { code: 'A001', counter: 'Caja 2' })).toBe('Turno A001 a Caja 2');
    expect(renderTemplate('Tiquete: [ticket] [priority], vaya a [local]: [service]', {
      code: 'B7',
      priority: 'Normal',
      counter: 'Box 1',
      service: 'Cajas',
    })).toBe('Tiquete: B7 Normal, vaya a Box 1: Cajas');
  });

  it('escapa HTML salvo variables crudas', () => {
    expect(renderTemplate('{{a}}{{qr}}', { a: '<b>', qr: '<img>' }, { html: true, raw: ['qr'] })).toBe('&lt;b&gt;<img>');
  });
});

describe('códigos de turno', () => {
  it('formatea y prepara para voz', () => {
    expect(formatTicketCode('A', 7, 3)).toBe('A007');
    expect(codeForSpeech('A007', 'spell')).toBe('A 0 0 7');
    expect(codeForSpeech('A007', 'number')).toBe('A 7');
    expect(codeForSpeech('PR-015', 'number')).toBe('P R 15');
    expect(codeForSpeech('42')).toBe('42');
  });
});

describe('isScheduleActive', () => {
  const monday10 = new Date(2026, 8, 28, 10, 30); // lunes 28/09/2026 10:30

  it('sin programación siempre está activo', () => {
    expect(isScheduleActive(null, monday10)).toBe(true);
  });

  it('respeta fechas, días y horarios', () => {
    expect(isScheduleActive({ startDate: '2026-09-29' }, monday10)).toBe(false);
    expect(isScheduleActive({ endDate: '2026-09-28' }, monday10)).toBe(true);
    expect(isScheduleActive({ days: [1, 2] }, monday10)).toBe(true);
    expect(isScheduleActive({ days: [0, 6] }, monday10)).toBe(false);
    expect(isScheduleActive({ startTime: '09:00', endTime: '11:00' }, monday10)).toBe(true);
    expect(isScheduleActive({ startTime: '11:00', endTime: '12:00' }, monday10)).toBe(false);
  });

  it('soporta ventanas que cruzan la medianoche', () => {
    expect(isScheduleActive({ startTime: '22:00', endTime: '06:00' }, new Date(2026, 8, 28, 23, 0))).toBe(true);
    expect(isScheduleActive({ startTime: '22:00', endTime: '06:00' }, new Date(2026, 8, 28, 5, 0))).toBe(true);
    expect(isScheduleActive({ startTime: '22:00', endTime: '06:00' }, monday10)).toBe(false);
  });
});

describe('configuración', () => {
  it('completa valores por defecto anidados', () => {
    const settings = tenantSettingsSchema.parse({ branding: { appName: 'Mi Banco' } });
    expect(settings.branding.appName).toBe('Mi Banco');
    expect(settings.branding.primaryColor).toBe('#2563eb');
    expect(settings.terminology.ticket).toBe('Turno');
    expect(defaultDisplayConfig().voice.enabled).toBe(true);
  });

  it('descarta valores inválidos sin perder el resto', () => {
    const cfg = normalizeConfig(displayConfigSchema, {
      layout: 'no-existe',
      title: 'Hall',
      theme: { background: 'rojo', text: '#000000' },
    });
    expect(cfg.layout).toBe('split');
    expect(cfg.title).toBe('Hall');
    expect(cfg.theme.background).toBe('#0f172a');
    expect(cfg.theme.text).toBe('#000000');
  });

  it('deepMerge reemplaza arrays y mezcla objetos', () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] })).toEqual({ a: { b: 1, c: 3 }, l: [9] });
  });
});

describe('personalización ampliada', () => {
  it('las configuraciones guardadas antes de la actualización reciben las opciones nuevas', () => {
    const tenant = tenantSettingsSchema.parse({ branding: { primaryColor: '#059669', borderRadius: 8 } });
    expect(tenant.branding.primaryColor).toBe('#059669');
    expect(tenant.branding).toMatchObject({ cardStyle: 'elevated', sidebarStyle: 'light', density: 'comfortable', backgroundStyle: 'gradient', headingFontFamily: '' });
    expect(tenant.onboarding).toEqual({ completed: false, dismissed: false, industry: '' });

    const display = normalizeConfig(displayConfigSchema, { layout: 'tickets', theme: { background: '#000000' }, voice: { template: 'Número {{code}}' } });
    expect(display.layout).toBe('tickets');
    expect(display.theme).toMatchObject({ background: '#000000', panelStyle: 'solid', callScale: 1, backgroundImageUrl: null });
    expect(display.voice).toMatchObject({ template: 'Número {{code}}', repeatDelay: 0.6, serviceTemplates: {} });
    expect(display.voice.secondary.enabled).toBe(false);
    expect(display.qr).toMatchObject({ enabled: false, position: 'bottom-left' });

    const kiosk = normalizeConfig(kioskConfigSchema, { theme: { buttonBackground: '#dc2626' }, print: { paperWidthMm: 58 } });
    expect(kiosk.theme).toMatchObject({ buttonBackground: '#dc2626', buttonStyle: 'rounded', backgroundStyle: 'solid', serviceColors: false });
    expect(kiosk.print).toMatchObject({ paperWidthMm: 58, headerText: '', footerText: '' });
    expect(kiosk.idle.enabled).toBe(false);
  });

  it('descarta opciones de diseño desconocidas sin perder el resto', () => {
    const kiosk = normalizeConfig(kioskConfigSchema, { title: 'Hola', theme: { buttonStyle: 'estrella', columns: 3 } });
    expect(kiosk.title).toBe('Hola');
    expect(kiosk.theme.buttonStyle).toBe('rounded');
    expect(kiosk.theme.columns).toBe(3);
  });

  it('reconoce los diseños de ticket prediseñados', () => {
    expect(matchTicketPreset(DEFAULT_TICKET_TEMPLATE, DEFAULT_TICKET_CSS)?.id).toBe('classic');
    for (const preset of TICKET_PRESETS) expect(matchTicketPreset(preset.template, preset.css)?.id).toBe(preset.id);
    expect(matchTicketPreset('<div>{{code}}</div>', '')).toBeNull();
    // Todos los diseños muestran el número y aceptan encabezado o pie.
    for (const preset of TICKET_PRESETS) {
      expect(preset.template).toContain('{{code}}');
      expect(preset.template).toMatch(/\{\{(header|footer)\}\}/);
    }
  });

  it('el encabezado y el pie vacíos no dejan texto en el ticket', () => {
    const html = renderTemplate(DEFAULT_TICKET_TEMPLATE, { code: 'A001', header: '', footer: 'Gracias' }, { html: true });
    expect(html).toContain('<div class="head"></div>');
    expect(html).toContain('<div class="note">Gracias</div>');
  });
});

