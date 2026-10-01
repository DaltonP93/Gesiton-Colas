import { escapeHtml, type Branding } from '@gc/shared';
import type { MailMessage } from './mailer';

export interface EmailBrand {
  appName: string;
  primaryColor: string;
  logoUrl: string | null;
  publicUrl: string;
}

export function brandFrom(
  branding: Pick<Branding, 'appName' | 'logoUrl' | 'primaryColor'> | null | undefined,
  publicUrl: string,
): EmailBrand {
  const base = publicUrl.replace(/\/$/, '');
  const logo = branding?.logoUrl ? (/^https?:/.test(branding.logoUrl) ? branding.logoUrl : `${base}${branding.logoUrl}`) : null;
  return {
    appName: branding?.appName ?? 'Gestión de Colas',
    primaryColor: branding?.primaryColor ?? '#2563eb',
    logoUrl: logo,
    publicUrl: base,
  };
}

interface LayoutInput {
  brand: EmailBrand;
  title: string;
  intro: string[];
  cta?: { label: string; url: string };
  code?: string;
  codeLabel?: string;
  outro?: string[];
}

/** Maqueta HTML compatible con la mayoría de los clientes de correo (tablas y estilos en línea). */
function layout({ brand, title, intro, cta, code, codeLabel = 'O ingrese este código:', outro = [] }: LayoutInput): { html: string; text: string } {
  const p = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">${escapeHtml(t)}</p>`;
  const header = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.appName)}" style="max-height:44px;max-width:220px">`
    : `<span style="font-size:20px;font-weight:800;color:${brand.primaryColor}">${escapeHtml(brand.appName)}</span>`;
  const button = cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="border-radius:10px;background:${brand.primaryColor}">
        <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(cta.label)}</a>
      </td></tr></table>`
    : '';
  const codeBlock = code
    ? `<p style="margin:8px 0 6px;font-size:13px;color:#64748b">${escapeHtml(codeLabel)}</p>
       <p style="margin:0 0 20px;font-size:32px;font-weight:800;letter-spacing:8px;color:#0f172a;font-family:Menlo,Consolas,monospace">${escapeHtml(code)}</p>`
    : '';
  const link = cta
    ? `<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#94a3b8">Si el botón no funciona, copie este enlace en su navegador:<br><a href="${escapeHtml(cta.url)}" style="color:${brand.primaryColor};word-break:break-all">${escapeHtml(cta.url)}</a></p>`
    : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="padding:28px 32px 8px">${header}</td></tr>
<tr><td style="padding:12px 32px 28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a">${escapeHtml(title)}</h1>
${intro.map(p).join('')}${button}${codeBlock}${outro.map(p).join('')}${link}
</td></tr>
<tr><td style="padding:16px 32px;background:#f8fafc;font-size:12px;color:#94a3b8">${escapeHtml(brand.appName)} · <a href="${escapeHtml(brand.publicUrl)}" style="color:#94a3b8">${escapeHtml(brand.publicUrl.replace(/^https?:\/\//, ''))}</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = [title, '', ...intro, ...(cta ? ['', `${cta.label}: ${cta.url}`] : []), ...(code ? ['', `Código: ${code}`] : []), ...(outro.length ? ['', ...outro] : []), '', `— ${brand.appName}`].join('\n');
  return { html, text };
}

const greet = (name: string) => `Hola ${name.split(' ')[0] || ''},`.replace(' ,', ',');

export function verifyEmailMail(to: string, name: string, url: string, brand: EmailBrand): MailMessage {
  const { html, text } = layout({
    brand,
    title: 'Confirme su correo electrónico',
    intro: [greet(name), `Gracias por registrarse en ${brand.appName}. Confirme su dirección de correo para proteger su cuenta y recibir avisos importantes.`],
    cta: { label: 'Confirmar mi correo', url },
    outro: ['El enlace vence en 3 días. Si usted no creó esta cuenta, ignore este mensaje.'],
  });
  return { to, subject: `Confirme su correo · ${brand.appName}`, html, text, fromName: brand.appName, tag: 'verify_email' };
}

export function resetPasswordMail(to: string, name: string, url: string, brand: EmailBrand): MailMessage {
  const { html, text } = layout({
    brand,
    title: 'Restablecer contraseña',
    intro: [greet(name), 'Recibimos un pedido para restablecer la contraseña de su cuenta. Haga clic en el botón para elegir una nueva.'],
    cta: { label: 'Elegir nueva contraseña', url },
    outro: ['El enlace vence en 1 hora y solo puede usarse una vez. Si usted no lo pidió, puede ignorar este correo: su contraseña no cambiará.'],
  });
  return { to, subject: `Restablecer contraseña · ${brand.appName}`, html, text, fromName: brand.appName, tag: 'reset_password' };
}

export function emailLoginMail(to: string, name: string, url: string, code: string, brand: EmailBrand): MailMessage {
  const { html, text } = layout({
    brand,
    title: 'Su acceso a la plataforma',
    intro: [greet(name), 'Use el botón para ingresar sin contraseña, o escriba el código en la pantalla de inicio de sesión.'],
    cta: { label: 'Ingresar ahora', url },
    code,
    outro: ['El enlace y el código vencen en 15 minutos. Si usted no intentó ingresar, ignore este correo.'],
  });
  return { to, subject: `Código de acceso ${code} · ${brand.appName}`, html, text, fromName: brand.appName, tag: 'email_login' };
}

export function inviteMail(to: string, name: string, inviter: string, organization: string, url: string, brand: EmailBrand): MailMessage {
  const { html, text } = layout({
    brand,
    title: `Lo invitaron a ${organization}`,
    intro: [greet(name), `${inviter} lo invitó a usar ${brand.appName} en ${organization}. Acepte la invitación y elija su contraseña para comenzar.`],
    cta: { label: 'Aceptar invitación', url },
    outro: ['La invitación vence en 7 días.'],
  });
  return { to, subject: `Invitación a ${organization} · ${brand.appName}`, html, text, fromName: brand.appName, tag: 'invite' };
}

export function demoMail(to: string, name: string, url: string, code: string, days: number, brand: EmailBrand): MailMessage {
  const { html, text } = layout({
    brand,
    title: 'Su demo está lista',
    intro: [
      greet(name),
      `Creamos una organización de demostración con datos de ejemplo: servicios, turnos, una pantalla de TV, un kiosco y publicidad. Puede probar todo durante ${days} días.`,
    ],
    cta: { label: 'Entrar a mi demo', url },
    code,
    outro: [
      'Dentro de la demo puede definir una contraseña desde su perfil. Si luego quiere seguir usándola, contáctenos para pasarla a un plan sin perder la configuración.',
    ],
  });
  return { to, subject: `Su demo de ${brand.appName} está lista`, html, text, fromName: brand.appName, tag: 'demo' };
}

export function testMail(to: string, server: string, brand: EmailBrand): MailMessage {
  const { html, text } = layout({
    brand,
    title: 'Correo de prueba',
    intro: [
      `Este mensaje confirma que ${brand.appName} puede enviar correos con el servidor ${server}.`,
      'Las invitaciones, los códigos de acceso y la recuperación de contraseña saldrán por este servidor.',
    ],
  });
  return { to, subject: `Prueba de correo · ${brand.appName}`, html, text, fromName: brand.appName, tag: 'test' };
}

export function invoiceMail(
  to: string,
  name: string,
  invoice: { number: string; description: string; amount: string; dueDate: string; organization: string },
  url: string,
  instructions: string,
  brand: EmailBrand,
): MailMessage {
  const { html, text } = layout({
    brand,
    title: `Factura ${invoice.number}`,
    intro: [
      greet(name),
      `Emitimos la factura ${invoice.number} de ${invoice.organization}: ${invoice.description}.`,
      `Monto: ${invoice.amount}. Vence el ${invoice.dueDate}.`,
    ],
    cta: { label: 'Ver y pagar', url },
    outro: instructions ? [instructions] : [],
  });
  return { to, subject: `Factura ${invoice.number} · ${invoice.amount}`, html, text, fromName: brand.appName, tag: 'invoice' };
}

export function deviceAlertMail(
  to: string,
  name: string,
  alert: { organization: string; offline: { name: string; kind: string; branch: string; since: string }[]; recovered: { name: string; kind: string; branch: string }[] },
  url: string,
  brand: EmailBrand,
): MailMessage {
  const offline = alert.offline.map((d) => `• ${d.kind} «${d.name}» (${d.branch}): sin conexión desde ${d.since}.`);
  const recovered = alert.recovered.map((d) => `• ${d.kind} «${d.name}» (${d.branch}) volvió a conectarse.`);
  const title = alert.offline.length ? (alert.offline.length === 1 ? 'Un equipo se desconectó' : `${alert.offline.length} equipos se desconectaron`) : 'Los equipos volvieron a conectarse';
  const { html, text } = layout({
    brand,
    title,
    intro: [greet(name), ...offline, ...recovered],
    cta: { label: 'Ver los equipos', url },
    outro: alert.offline.length
      ? ['Revise que la TV o la tablet esté encendida, con la página abierta y con conexión a Internet. Si se reinició, ábrala de nuevo desde el enlace o vincúlela con un código.']
      : [],
  });
  return { to, subject: `${title} · ${alert.organization}`, html, text, fromName: brand.appName, tag: 'device_alert' };
}

/** Confirmación o recordatorio de una cita (módulo de citas). */
export function appointmentMail(
  to: string,
  kind: 'confirmation' | 'reminder' | 'cancelled',
  appt: { name: string; organization: string; date: string; time: string; service: string; branch: string; address: string; professional: string | null; code: string },
  url: string,
  brand: EmailBrand,
): MailMessage {
  const title = kind === 'confirmation' ? 'Su cita quedó agendada' : kind === 'reminder' ? 'Recordatorio de su cita' : 'Su cita fue cancelada';
  const details = [
    `• Fecha: ${appt.date} a las ${appt.time}`,
    `• ${appt.service} en ${appt.branch}${appt.address ? ` (${appt.address})` : ''}`,
    ...(appt.professional ? [`• Profesional: ${appt.professional}`] : []),
  ];
  const { html, text } = layout({
    brand,
    title,
    intro: [greet(appt.name), ...details],
    code: kind === 'cancelled' ? undefined : appt.code,
    codeLabel: 'Código de la cita (para presentarse en el kiosco):',
    cta: kind === 'cancelled' ? undefined : { label: 'Ver o cancelar la cita', url },
    outro:
      kind === 'cancelled'
        ? ['Si fue un error, puede agendar una nueva cita.']
        : ['Al llegar, preséntese en el kiosco con su documento o con este código y espere el llamado en la pantalla.'],
  });
  return { to, subject: `${title} · ${appt.organization}`, html, text, fromName: brand.appName, tag: `appointment_${kind}` };
}

/** Factura electrónica aprobada por la SET, con el enlace al KuDE. */
export function sifenMail(to: string, name: string, doc: { issuer: string; number: string; cdc: string }, url: string, brand: EmailBrand): MailMessage {
  const { html, text } = layout({
    brand,
    title: `Factura electrónica ${doc.number}`,
    intro: [greet(name || ''), `${doc.issuer} le emitió la factura electrónica ${doc.number}, aprobada por la SET.`, `CDC: ${doc.cdc.replace(/(.{4})/g, '$1 ').trim()}`],
    cta: { label: 'Ver e imprimir la factura', url },
    outro: ['Puede verificarla con el código QR del documento en el portal e-Kuatia de la SET.'],
  });
  return { to, subject: `Factura electrónica ${doc.number} · ${doc.issuer}`, html, text, fromName: brand.appName, tag: 'sifen_invoice' };
}

/** Aviso de la plataforma (vencimientos, suspensión, términos, alertas para los superadministradores). */
export function noticeMail(
  to: string,
  name: string,
  notice: { subject: string; title: string; lines: string[]; cta?: { label: string; url: string }; outro?: string[]; tag: string },
  brand: EmailBrand,
): MailMessage {
  const { html, text } = layout({ brand, title: notice.title, intro: [greet(name), ...notice.lines], cta: notice.cta, outro: notice.outro ?? [] });
  return { to, subject: notice.subject, html, text, fromName: brand.appName, tag: notice.tag };
}
