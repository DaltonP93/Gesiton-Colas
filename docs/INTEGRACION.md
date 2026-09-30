# Integración con otros sistemas

Gestión de Colas está pensado para conectarse con cualquier sistema: ERP, CRM, historia clínica, sistemas bancarios, bots de WhatsApp, páginas web, apps móviles o plataformas como Zapier, Make y n8n.

La documentación interactiva (OpenAPI 3 / Swagger) está en **`/api/docs`** y el esquema JSON en **`/api/docs/json`**, listo para generar clientes en cualquier lenguaje.

## 1. Autenticación

| Método | Cabecera | Uso |
| --- | --- | --- |
| Usuario | `Authorization: Bearer <jwt>` | Obtenido con `POST /api/v1/auth/login`. Para el panel y apps propias. |
| API key | `X-API-Key: gc_…` (o `Authorization: Bearer gc_…`) | Integraciones servidor a servidor. Se crean en **Integraciones y API**. |

Permisos de las API keys:

| Permiso | Permite |
| --- | --- |
| `tickets:read` | Consultar turnos y el estado de las colas |
| `tickets:write` | Emitir y cancelar turnos |
| `catalog:read` | Leer sucursales, servicios, prioridades y puestos |
| `catalog:write` | Crear y modificar el catálogo |
| `reports:read` | Consultar reportes y exportar CSV |
| `displays:write` | Administrar pantallas, kioscos, publicidad y listas |

## 2. Casos de uso frecuentes

### Emitir un turno desde otro sistema

```bash
curl -X POST https://colas.ejemplo.com/api/v1/tickets \
  -H "X-API-Key: gc_xxxxxxxx_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "branchId": "UUID-DE-LA-SUCURSAL",
    "serviceId": "UUID-DEL-SERVICIO",
    "priorityId": null,
    "customer": { "name": "Juan Pérez", "document": "1234567", "phone": "+595981000000" },
    "notes": "Viene por reclamo #4521"
  }'
```

Respuesta:

```json
{
  "ticket": { "id": "…", "code": "A015", "status": "waiting", "publicToken": "…", "…": "…" },
  "waitingAhead": 4,
  "trackingUrl": "https://colas.ejemplo.com/t/AbCdEf…"
}
```

Envíe `trackingUrl` al cliente por SMS, e-mail o WhatsApp para que siga su turno en vivo.

### Consultar el estado de una cola

`GET /api/v1/branches/{branchId}/queue?serviceIds=uuid1,uuid2` → turnos en espera (en orden de llamado), en atención y contadores del día.

### Buscar turnos

`GET /api/v1/tickets?branchId=…&status=waiting,called&from=2026-09-01&to=2026-09-30&q=juan&page=1&pageSize=50`

### Reportes

- `GET /api/v1/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=…`
- `GET /api/v1/reports/tickets.csv?from=…&to=…` (CSV compatible con Excel)

### Publicidad por API

- `POST /api/v1/media` con `{ "url": "https://www.youtube.com/watch?v=…" }` detecta la plataforma automáticamente.
- `POST /api/v1/media/upload` (multipart: `name`, `duration`, `tags` y luego `file`) sube videos o imágenes.
- `PUT /api/v1/playlists/{id}` con `items` reemplaza el contenido de una lista; las pantallas se actualizan al instante.

## 3. Webhooks

Configure una URL en **Integraciones y API → Webhooks** y elija los eventos (o todos).

| Evento | Cuándo |
| --- | --- |
| `ticket.created` | Se emite un turno (kiosco, celular, API, operador) |
| `ticket.called` / `ticket.recalled` | Un operador llama o vuelve a llamar |
| `ticket.started` | Comienza la atención |
| `ticket.finished` | Termina la atención |
| `ticket.no_show` | El cliente no se presentó |
| `ticket.cancelled` | Se canceló (operador, cliente o cierre de jornada) |
| `ticket.transferred` | Se derivó a otro servicio |
| `ticket.requeued` | Se devolvió a la cola |
| `queue.reset` | Cierre de jornada de una sucursal |

Formato del cuerpo (`POST`, JSON):

```json
{
  "id": "uuid-de-la-entrega",
  "event": "ticket.called",
  "createdAt": "2026-09-29T14:03:11.000Z",
  "tenantId": "uuid-de-la-organizacion",
  "data": { "ticket": { "code": "A015", "status": "called", "counter": { "name": "Ventanilla 2" }, "customer": { "…": "…" } } }
}
```

Cabeceras: `X-GC-Event`, `X-GC-Delivery`, `X-GC-Timestamp` y `X-GC-Signature: sha256=<hex>`.

**Verificar la firma** (HMAC-SHA256 de `timestamp + "." + cuerpo` con el secreto del webhook):

```js
import crypto from 'node:crypto';

function verify(req, rawBody, secret) {
  const timestamp = req.headers['x-gc-timestamp'];
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const received = String(req.headers['x-gc-signature'] ?? '').replace('sha256=', '');
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300; // evita reenvíos antiguos
  return fresh && expected.length === received.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
```

Responda con un código `2xx` en menos de 10 segundos. Si falla, se reintenta a los 30 s, 2 min, 10 min, 1 h y 6 h. El historial de entregas y el reintento manual están en el panel.

> Por seguridad, en modo SaaS no se permiten webhooks hacia IPs privadas. En instalaciones propias dentro de la red local active `WEBHOOKS_ALLOW_PRIVATE=true`.

## 4. Tiempo real (Socket.IO)

Conéctese a la misma URL del servidor con `socket.io-client`:

```js
import { io } from 'socket.io-client';

// kind: 'user' (JWT), 'display' (token de pantalla), 'kiosk' (token de kiosco) o 'ticket' (token público del turno)
const socket = io('https://colas.ejemplo.com', { auth: { kind: 'display', token: 'TOKEN_DE_LA_PANTALLA' } });

socket.on('ticket.called', ({ call }) => {
  console.log(`${call.code} → ${call.counter}`); // p. ej. encender un LED o un cartel externo
});
```

Eventos: `ticket.created`, `ticket.called`, `ticket.updated`, `queue.changed`, `display.config`, `kiosk.config`, `tenant.settings`. Los usuarios del panel deben emitir `subscribe:branch` con el id de la sucursal para recibir los eventos con datos completos.

## 5. Autenticación de usuarios por correo (apps propias)

Además de `POST /api/v1/auth/login`, una app propia puede usar los mismos flujos del portal:

| Endpoint | Uso |
| --- | --- |
| `POST /auth/email-login` `{ email }` | Envía un enlace y un código de 6 dígitos |
| `POST /auth/email-login/verify` `{ email, code }` o `{ token }` | Devuelve el token de sesión |
| `POST /auth/forgot-password` `{ email }` y `POST /auth/reset-password` `{ token, password }` | Recuperación de contraseña |
| `POST /auth/demo` `{ email, name }` | Crea una demo y envía el acceso por correo |
| `POST /users` sin `password` | Invita a un usuario por correo (`POST /users/:id/invite` reenvía) |

Las respuestas de los envíos son idénticas exista o no la cuenta, para no revelar qué correos están registrados.

## 6. Embeber en otros sitios

Las pantallas, kioscos y el seguimiento son páginas web normales: pueden abrirse en un navegador, en un WebView de una app o dentro de un `<iframe>`:

```html
<iframe src="https://colas.ejemplo.com/kiosco/TOKEN?modo=movil" style="width:100%;height:720px;border:0" allow="autoplay"></iframe>
```

## Avisos por WhatsApp y SMS

Módulo **Avisos** (se activa por plan o por organización desde la Plataforma). Se configura en
**Configuración → Avisos por WhatsApp y SMS** (o, para todas las organizaciones, en Plataforma → Ajustes).

| Canal | Qué hace falta | Notas |
| --- | --- | --- |
| **WAHA** (WhatsApp local) | Una instalación de [WAHA](https://waha.devlike.pro/) con una sesión vinculada por QR: `docker run -d -p 3000:3000 -e WAHA_API_KEY=su-clave devlikeapro/waha`. En el panel: dirección (`http://10.0.0.5:3000`), sesión y API key. | Se usa `POST /api/sendText` con `chatId = 595981123456@c.us`. WhatsApp no permite oficialmente cuentas automatizadas no Business: use un número dedicado. |
| **WhatsApp oficial (Meta)** | Cuenta de WhatsApp Business Platform: *Phone number ID* y un token permanente de usuario del sistema. | Los mensajes que inicia la empresa deben ser **plantillas aprobadas**. Cree una por aviso en Meta y escriba su nombre en la pestaña Mensajes. Variables en orden: al sacar turno `{{1}}` número, `{{2}}` servicio, `{{3}}` personas antes, `{{4}}` enlace; cuando se acerca `{{1}}` número, `{{2}}` turnos que faltan, `{{3}}` sucursal; al llamar `{{1}}` número, `{{2}}` puesto; al terminar `{{1}}` organización, `{{2}}` enlace de la encuesta. Sin plantilla se envía texto (solo llega dentro de las 24 h desde el último mensaje del cliente). |
| **SMS por HTTP** | La URL del proveedor. Use `{{phone}}` y `{{message}}` en la URL o en el cuerpo; el encabezado de autenticación es opcional. | Los valores se codifican según el tipo de contenido (JSON, formulario o texto). Sirve también para gateways locales (módems GSM, Kannel, Android SMS Gateway…). |

- El teléfono sale del dato «Teléfono» del turno (kiosco, panel o API) o lo escribe el cliente en su página de seguimiento. Los números locales se completan con el código de país configurado (595 por defecto): `0981 123 456` → `595981123456`.
- Los envíos pasan por una cola con 3 intentos (al minuto y a los 5 minutos) y quedan en el **Historial**, donde se pueden reintentar.
- Por seguridad, el proveedor de una organización no puede apuntar a la red interna del servidor. Si WAHA o el gateway de SMS están en la red local, configúrelos como **proveedor de la plataforma** o active `WEBHOOKS_ALLOW_PRIVATE=true` en una instalación con organizaciones de confianza.
