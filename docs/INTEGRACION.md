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

## 5. Embeber en otros sitios

Las pantallas, kioscos y el seguimiento son páginas web normales: pueden abrirse en un navegador, en un WebView de una app o dentro de un `<iframe>`:

```html
<iframe src="https://colas.ejemplo.com/kiosco/TOKEN?modo=movil" style="width:100%;height:720px;border:0" allow="autoplay"></iframe>
```
