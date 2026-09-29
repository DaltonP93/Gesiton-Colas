# Gestión de Colas

Plataforma **SaaS** de gestión de turnos, pantallas y publicidad digital. Organiza la atención de todas sus sucursales, muestra contenido en las salas de espera y se integra con cualquier sistema mediante API REST, webhooks y eventos en tiempo real.

> Versión 3 — reescritura completa del sistema anterior (NovoSGA 2 / Symfony 4). El código original se conserva como referencia en [`legacy/novosga`](legacy/novosga).

## Qué incluye

| Módulo | Descripción |
| --- | --- |
| **Pantallas (TV)** | Llamados con voz (síntesis del navegador), sonido de alerta, historial, reloj y cintillo. Tres diseños: publicidad + turnos, publicidad a pantalla completa con llamado destacado, o solo turnos. Colores, tipografía, tamaños y CSS configurables. |
| **Publicidad multiplataforma** | Subida de **videos e imágenes** (disco local o S3/R2/MinIO) y contenido de **YouTube, Vimeo, TikTok, Instagram, Facebook, Twitch, Dailymotion, Google Drive, Google Slides, Canva, Loom, transmisiones HLS (m3u8)**, videos/imágenes por URL, páginas web y anuncios de texto. Listas de reproducción con orden, duración, volumen, silencio y **programación por fecha, día y horario**. El volumen baja automáticamente durante un llamado. |
| **Kioscos** | Emisión táctil de turnos, prioridad (normal/preferencial o lista), datos del cliente configurables, impresión térmica con **plantilla HTML editable**, QR de seguimiento. |
| **Fila virtual** | El mismo kiosco funciona desde el celular (`?modo=movil`): el cliente saca su turno con un QR y sigue su posición y tiempo estimado en vivo, con aviso al ser llamado. Puede cancelarlo. |
| **Consola de atención** | Llamar siguiente, llamar uno específico, rellamar, iniciar, finalizar con notas, no se presentó, devolver a la cola, derivar a otro servicio, pausa y emisión manual. Atajos F1–F8. Varios operadores sin duplicados (bloqueo en base de datos). |
| **Administración** | Sucursales, puestos de atención, departamentos, servicios (prefijo, color, ícono, tiempo estimado), prioridades con peso, usuarios con roles (administrador, supervisor, operador) y asignación a sucursales/servicios. |
| **Personalización total** | Logo, favicon, colores, tipografía, bordes, modo oscuro, CSS propio, **terminología** (Turno/Ficha/Ticket, Ventanilla/Box/Caja…), numeración (dígitos, reinicio diario, por servicio o sucursal), campos del cliente, idioma (es/en/pt) y zona horaria. |
| **Reportes** | Espera y atención promedio, por servicio, operador, hora y día. Monitor en vivo y exportación a CSV/Excel. |
| **Integraciones** | API REST con OpenAPI/Swagger (`/api/docs`), API keys con permisos, **webhooks firmados (HMAC-SHA256) con reintentos**, Socket.IO. Ideal para ERP, CRM, WhatsApp, Zapier, Make o n8n. |
| **SaaS** | Registro autónomo de organizaciones, datos aislados por organización, planes con límites (sucursales, pantallas, kioscos, usuarios, almacenamiento), superadministrador con modo soporte. |

Funciona en **cualquier dispositivo con navegador**: Smart TV, Android TV/Google TV, mini PC, Raspberry Pi, tablets, celulares, Windows, macOS y Linux.

## Arquitectura

```
apps/
  api/        API REST + tiempo real (Node.js 22, Fastify 5, Drizzle ORM, PostgreSQL, Socket.IO)
  web/        Panel, consola, pantallas, kioscos y seguimiento (React 19, Vite, Tailwind CSS 4)
packages/
  shared/     Tipos, esquemas de configuración, detección de plataformas y plantillas
legacy/       Sistema anterior (solo referencia)
docs/         Guías de integración y despliegue
```

- Multi-tenant por columna `tenant_id` con verificación en cada consulta.
- Numeración de turnos atómica (`INSERT … ON CONFLICT`) y llamado concurrente seguro (`FOR UPDATE SKIP LOCKED`).
- Las pantallas y kioscos reciben eventos **sin datos personales**; el personal recibe los datos completos.
- Configuración validada con Zod y combinada con valores por defecto: nada se rompe si falta un campo.

## Inicio rápido (Docker)

```bash
cp .env.example .env        # defina al menos JWT_SECRET y PUBLIC_URL
docker compose up -d
```

Abra <http://localhost:3000>, cree su organización y listo: se generan una sucursal, servicios, puestos, una pantalla y un kiosco de ejemplo.

## Desarrollo local

Requisitos: Node.js 22+ y PostgreSQL 14+.

```bash
npm install
cp .env.example .env         # ajuste DATABASE_URL
npm run db:migrate           # crea las tablas (también se ejecuta al iniciar la API)
npm run db:seed              # opcional: organización demo (demo@gestioncolas.local / demo1234)
npm run dev                  # API en :3000 y web en :5173 (con proxy a la API)
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev:api` / `npm run dev:web` | Levanta solo la API o solo el frontend |
| `npm test` | Tests del paquete compartido y de integración de la API (usa `TEST_DATABASE_URL`, por defecto `gestion_colas_test`) |
| `npm run typecheck` | Verificación de tipos de todo el monorepo |
| `npm run build` | Compila web y API (`apps/api/dist`, `apps/web/dist`) |
| `npm start` | Inicia la API compilada; si existe `apps/web/dist`, también sirve el frontend |
| `npm run db:generate` | Genera una migración a partir de cambios en `apps/api/src/db/schema.ts` |

## Rutas principales

| Ruta | Uso |
| --- | --- |
| `/` | Página pública del producto |
| `/registro`, `/login` | Alta de organización e inicio de sesión |
| `/app` | Panel de administración |
| `/app/atencion` | Consola del operador |
| `/pantalla/:token` | Pantalla de TV (enlace por pantalla) |
| `/kiosco/:token` | Kiosco táctil · `?modo=movil` para fila virtual |
| `/t/:token` | Seguimiento del turno del cliente |
| `/plataforma` | Superadministrador (organizaciones y planes) |
| `/api/docs` | Documentación interactiva de la API |

## Documentación

- [Integración con otros sistemas](docs/INTEGRACION.md): API keys, endpoints, webhooks, tiempo real, embebido.
- [Despliegue y dispositivos](docs/DESPLIEGUE.md): producción, S3, TV, kioscos e impresoras.
- [Migración desde la versión anterior](docs/MIGRACION.md).
