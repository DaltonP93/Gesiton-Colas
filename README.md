# Gestión de Colas

Plataforma **SaaS** de gestión de turnos, pantallas y publicidad digital. Organiza la atención de todas sus sucursales, muestra contenido en las salas de espera y se integra con cualquier sistema mediante API REST, webhooks y eventos en tiempo real.

## Qué incluye

| Módulo | Descripción |
| --- | --- |
| **Pantallas (TV)** | Llamados con voz (síntesis del navegador), sonido de alerta, historial, reloj y cintillo. Tres diseños: publicidad + turnos, publicidad a pantalla completa con llamado destacado, o solo turnos. Colores, tipografía, tamaños y CSS configurables. |
| **Publicidad multiplataforma** | Subida de **videos e imágenes** (disco local o S3/R2/MinIO) y contenido de **YouTube, Vimeo, TikTok, Instagram, Facebook, Twitch, Dailymotion, Google Drive, Google Slides, Canva, Loom, transmisiones HLS (m3u8)**, videos/imágenes por URL, páginas web y anuncios de texto. Listas de reproducción con orden, duración, volumen, silencio y **programación por fecha, día y horario**. El volumen baja automáticamente durante un llamado. |
| **Kioscos** | Emisión táctil de turnos, prioridad (normal/preferencial o lista), datos del cliente configurables, impresión térmica con **plantilla HTML editable**, QR de seguimiento. |
| **Fila virtual** | El mismo kiosco funciona desde el celular (`?modo=movil`): el cliente saca su turno con un QR y sigue su posición y tiempo estimado en vivo, con aviso al ser llamado. Puede cancelarlo. |
| **Consola de atención** | Llamar siguiente, llamar uno específico, rellamar, iniciar, finalizar con notas, no se presentó, devolver a la cola, derivar a otro servicio, pausa y emisión manual. Atajos F1–F8. Varios operadores sin duplicados (bloqueo en base de datos). |
| **Administración** | Sucursales, puestos de atención, departamentos, servicios (prefijo, color, ícono, tiempo estimado), prioridades con peso, usuarios con roles (administrador, supervisor, operador) y asignación a sucursales/servicios. |
| **Personalización total** | Logo, favicon, colores, tipografía de texto y de títulos, bordes, modo oscuro, **estilo de tarjetas** (sombra, borde, plano, vidrio), **menú lateral** claro, oscuro o del color de la marca, fondo (degradado, puntos o imagen), densidad, CSS propio, **terminología** (Turno/Ficha/Ticket, Ventanilla/Box/Caja…), numeración, campos del cliente, idioma (es/en/pt) y zona horaria. |
| **Pantalla TV a medida** | Imagen de fondo, paneles sólidos, de vidrio o con borde, redondeo, tipografía propia para los números, tamaño del llamado y del historial, animación del llamado, reloj de 12/24 h, **código QR en pantalla** (fila virtual, encuesta, WhatsApp), frase de voz por servicio y **segundo idioma**. |
| **Kiosco a medida** | Temas rápidos, fondo liso, degradado o imagen, botones redondeados, píldora, rectos, de contorno o **mosaico**, color por servicio, ícono a la izquierda, arriba o a la derecha y en 4 tamaños, tamaño de logo, encabezado centrado, texto al pie y **pantalla de espera** con logo y hora o con una **galería de imágenes / video promocional** (lista de Publicidad). Ticket con **5 diseños prediseñados**, encabezado y pie sin tocar HTML. |
| **Íconos e imágenes propias** | Más de 80 íconos de servicio agrupados por rubro o una **imagen propia por servicio**. En la TV y el kiosco se suman **logos, sellos o íconos ubicables** en 9 posiciones, con tamaño, opacidad y delante o detrás del contenido. |
| **Asistente inicial** | Al crear una organización, un asistente de 5 pasos propone según el **rubro** (banco, salud, farmacia, oficina pública, comercio, educación) la terminología, los colores y los servicios, y configura la sucursal, los puestos, la pantalla y el kiosco. |
| **Reportes** | Espera y atención promedio, por servicio, operador, hora y día. Monitor en vivo y exportación a CSV/Excel. |
| **Integraciones** | API REST con OpenAPI/Swagger (`/api/docs`), API keys con permisos, **webhooks firmados (HMAC-SHA256) con reintentos**, Socket.IO. Ideal para ERP, CRM, WhatsApp, Zapier, Make o n8n. |
| **SaaS** | Registro autónomo de organizaciones, datos aislados por organización, planes con límites (sucursales, pantallas, kioscos, usuarios, almacenamiento), superadministrador con modo soporte. |
| **Plataforma (superadministrador)** | Varios **superadministradores** (alta, edición, invitación, baja). **Página principal configurable**: presentación del producto, directamente el **login** o redirección a otro sitio. **Editor de la página de presentación** con 6 plantillas, vista previa en computadora, tablet y celular, secciones (funciones, pasos, precios, testimonios, clientes, preguntas, contacto…) y dominio propio. **Mi perfil** con foto, correo y celular para los avisos. Registro, demos e ingreso por código activables. **Marca de la plataforma** (nombre, logo, color, frase e imagen del ingreso, correo de soporte). Por organización: ver usuarios, **definir contraseñas** y generar **enlaces de acceso** de un solo uso. |
| **Correo saliente (SMTP) desde el panel** | El superadministrador configura el servidor de toda la plataforma y **cada organización puede usar el suyo** (Configuración → Correo saliente), con proveedores precargados (Gmail, Microsoft 365, SES, Brevo, Mailgun, Zoho), contraseña cifrada y **correo de prueba**. Sin correo, las invitaciones muestran el **enlace para copiar o enviar por WhatsApp**. |
| **Acceso por correo** | **Demo por correo** (organización de ejemplo con historial, operadores, publicidad y turnos, con vencimiento), verificación de email, **olvidé mi contraseña**, ingreso sin contraseña con **enlace o código de 6 dígitos**, invitación de usuarios por correo. SMTP con cualquier proveedor. |
| **Portal de herramientas** | Al ingresar, un portal abre la consola, el **kiosco / triage** o el **panel TV** con un clic, copia enlaces o muestra el QR. Las TVs y tablets se **vinculan con un código de 6 dígitos** desde `/vincular`, sin escribir URLs largas; el equipo recuerda su pantalla. |
| **Sonidos y audio** | 19 sonidos de llamado incluidos (escuchar y descargar), subida de audios propios (MP3, WAV, OGG, M4A) como tono de llamado o voz grabada, **música ambiental** y radios por streaming con atenuación en cada llamado, y guía para instalar más voces. |
| **Módulos activables** | Pantallas, kioscos, publicidad, reportes, integraciones, avisos, encuestas, pagos, citas y factura electrónica son **módulos**: el superadministrador define qué incluye cada plan y puede **activar o desactivar cada módulo por organización**. Un módulo apagado desaparece del menú y la API responde `403 module_disabled`. |
| **Numeración de turnos** | Prefijo por servicio, 1 a 6 dígitos, número inicial, reinicio **diario, semanal, mensual, anual o nunca**, y qué pasa al llegar al máximo (A999 → A001 o A1000). Estado del contador y **reinicio manual** en Configuración → Numeración. |
| **Avisos por WhatsApp y SMS** | Mensajes al **sacar el turno**, **cuando se acerca** (faltan N), **cuando lo llaman** y **al terminar** (con la encuesta). Canales: **WhatsApp oficial (Meta Cloud API)** con plantillas, **WAHA** u otra API local de WhatsApp y **cualquier proveedor de SMS por HTTP** (URL y cuerpo con `{{phone}}` y `{{message}}`). Proveedor de la plataforma o propio de cada organización, clave cifrada, mensaje de prueba, historial con reintentos y alta del teléfono desde la página de seguimiento. |
| **Encuestas de satisfacción** | Constructor de encuestas con **estrellas, caritas, recomendación (NPS), una o varias opciones, sí/no y comentarios**, plantillas (general, rápida, pacientes, NPS), vista previa en celular y alcance por servicio y sucursal. El cliente responde desde el **seguimiento de su turno**, el **aviso por WhatsApp/SMS al terminar** o un **QR general** (por sucursal). Métricas: **NPS, CSAT, promedio**, tasa de respuesta, evolución diaria, por servicio, operador y sucursal, detalle por pregunta, comentarios y CSV. Webhook `survey.answered`. |
| **Pagos y facturación** | **Facturación de los planes** a cada organización (factura del mes automática o manual, registro de pagos, vencimientos, suspensión por falta de pago con reactivación al pagar) y **cobros a clientes** (precio por servicio, pago en línea desde el seguimiento del turno o registro en el puesto: efectivo, POS, transferencia, QR). Pasarelas **Bancard vPOS 2.0, PagoPar y Stripe Checkout**, de la plataforma o propias de cada organización. Ver [docs/PAGOS.md](docs/PAGOS.md). |
| **Citas con fecha y hora** | Módulo para **conectarse con la agenda que ya tiene** (HIS, ERP): las citas llegan por **API o CSV** con el identificador de su sistema, o se cargan en el panel, o los clientes **reservan en línea** (`/reservar/<organización>`, con horarios, cupo y feriados). Al llegar, el cliente se presenta en el **kiosco con su documento o código** (o en recepción) y entra a la fila **por la hora de su cita**. Confirmación y **recordatorio** por correo, WhatsApp o SMS; «No vino» automático; webhooks de llegada. Ver [docs/INTEGRACION.md](docs/INTEGRACION.md#citas-con-fecha-y-hora-his-erp-agendas). |
| **Factura electrónica SIFEN** | Facturas electrónicas de **Paraguay** (Manual Técnico v150): XML con CDC, **firma digital** con el certificado .p12 del emisor, **QR con CSC**, envío a la **SET** (pruebas y producción), consulta, **anulación**, **KuDE** imprimible y envío por correo. Cada organización factura a sus clientes (a mano, desde un cobro o **automática al cobrar**) y la plataforma factura sus planes con su propio emisor. Ver [docs/SIFEN.md](docs/SIFEN.md). |
| **Registro de actividad** | Quién cambió qué: cada cambio guarda la persona, la fecha, la IP y los datos enviados (sin contraseñas ni claves), además de los ingresos y los intentos fallidos. Filtros, búsqueda y CSV en Configuración → Registro de actividad y, para toda la plataforma, en Plataforma → Actividad. Lo que hace el soporte dentro de una organización queda marcado. |
| **Alertas de equipos** | Aviso por **correo, WhatsApp o SMS** cuando una TV o un kiosco deja de responder (después de N minutos, solo en el horario elegido) y cuando vuelve; una sola alerta por corte y un aviso en el panel con los equipos desconectados. |
| **Adaptable a cualquier equipo** | El panel, la plataforma, la consola de atención, el kiosco y la fila virtual, las reservas y las páginas públicas se usan desde el celular, la tablet o la notebook; una prueba automática verifica que ninguna página se desborde en 360 px y 820 px. |
| **Comunicaciones** | Cada organización configura su **correo** (todos los planes; si no, usa el de la plataforma) y **WhatsApp/SMS** según su plan (módulo «Avisos»; sin el módulo la sección se ve como no incluida). El superadministrador elige por qué canal —correo y/o WhatsApp/SMS— envía cada aviso de la plataforma: factura emitida, por vencer y vencida, suspensión, demo por vencer, nuevos términos, nueva organización y copia fallida (Plataforma → Comunicaciones), y ve los canales de cada organización. |
| **Términos y licencia** | Licencia propietaria del código ([LICENSE](LICENSE)) y documentos propios para Paraguay: **términos del servicio**, **política de privacidad**, **acuerdo de tratamiento de datos** y **contrato de licencia** para instalación propia. El superadministrador los completa, edita y publica por versión; cada organización los acepta al registrarse y en cada cambio importante, con constancia de quién, cuándo y desde qué IP. Cada organización puede mostrar su **aviso de privacidad** en la reserva, el kiosco y las encuestas. Ver [docs/legal](docs/legal/README.md). |
| **Copias de seguridad** | Copia **diaria automática** de la base y los archivos, con plazo de conservación, subida a **destinos externos** configurables desde el panel (**S3 y compatibles**: R2, B2, Wasabi, Spaces, GCS, MinIO; **SFTP**; **WebDAV**: Nextcloud, ownCloud, Synology…), descarga desde Plataforma → Copias, aviso si falla y restauración por consola en una sola transacción (ver [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md#copias-de-seguridad)). |
| **Privacidad** | Plazo de conservación de datos personales, borrado a pedido del titular y exportación de datos personales solo para administradores (ver [docs/SEGURIDAD.md](docs/SEGURIDAD.md)). |

Funciona en **cualquier dispositivo con navegador**: Smart TV, Android TV/Google TV, mini PC, Raspberry Pi, tablets, celulares, Windows, macOS y Linux.

## Arquitectura

```
apps/
  api/        API REST + tiempo real (Node.js 22, Fastify 5, Drizzle ORM, PostgreSQL, Socket.IO)
  web/        Panel, consola, pantallas, kioscos y seguimiento (React 19, Vite, Tailwind CSS 4)
packages/
  shared/     Tipos, esquemas de configuración, detección de plataformas y plantillas
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

Sin SMTP configurado, los correos (verificación, recuperación, códigos, demos) se imprimen en la consola de la API con sus enlaces, para poder probar todos los flujos en desarrollo. En producción el correo se configura desde **Plataforma → Ajustes → Correo saliente** (o con las variables `SMTP_*`).

### Recuperar el acceso de superadministrador

El superadministrador inicial se crea con `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` solo si todavía no hay ninguno; después se administran en **Plataforma → Superadministradores**. Si se pierde el acceso:

```bash
docker compose exec app node apps/api/dist/db/admin-cli.js superadmin correo@empresa.com   # genera una contraseña nueva
# sin Docker: node apps/api/dist/db/admin-cli.js superadmin correo@empresa.com 'NuevaClave123'
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev:api` / `npm run dev:web` | Levanta solo la API o solo el frontend |
| `npm test` | Tests del paquete compartido y de integración de la API (usa `TEST_DATABASE_URL`, por defecto `gestion_colas_test`) |
| `npm run typecheck` | Verificación de tipos de todo el monorepo |
| `npm run build` | Compila web y API (`apps/api/dist`, `apps/web/dist`) |
| `npm start` | Inicia la API compilada; si existe `apps/web/dist`, también sirve el frontend |
| `npm run db:generate` | Genera una migración a partir de cambios en `apps/api/src/db/schema.ts` |
| `npm run e2e` | Prueba de punta a punta en Chromium (requiere `npm run build`) |
| `node apps/web/scripts/generate-sounds.mjs` | Regenera los sonidos de llamado sintetizados |

## Rutas principales

| Ruta | Uso |
| --- | --- |
| `/` | Página principal: presentación del producto, el login o una redirección (lo elige el superadministrador) |
| `/presentacion` | Página de presentación (también en su dominio propio, si se configura) |
| `/registro`, `/login`, `/demo` | Alta de organización, inicio de sesión y demo por correo |
| `/ingresar-con-correo`, `/olvide-contrasena` | Acceso con código por correo y recuperación de contraseña |
| `/app` | Portal de herramientas (consola, kiosco, panel TV, administración) |
| `/app/configuracion` | Toda la configuración en un solo lugar: marca, sucursales, servicios, usuarios, integraciones… |
| `/app/bienvenida` | Asistente de configuración inicial |
| `/vincular` | Se abre en la TV o tablet para vincularla con un código |
| `/app/atencion` | Consola del operador |
| `/pantalla/:token` | Pantalla de TV (enlace por pantalla) |
| `/kiosco/:token` | Kiosco táctil · `?modo=movil` para fila virtual |
| `/t/:token` | Seguimiento del turno del cliente |
| `/plataforma` | Superadministrador: organizaciones, facturación, SIFEN, comunicaciones (correo, WhatsApp/SMS y avisos), legal, actividad, copias y ajustes |
| `/plataforma/presentacion`, `/plataforma/perfil` | Editor de la página de presentación · perfil del superadministrador |
| `/app/configuracion/correo` | Servidor de correo propio de la organización |
| `/app/configuracion/avisos` | Avisos por WhatsApp y SMS: canal, mensajes e historial |
| `/app/encuestas` | Encuestas de satisfacción: resultados (NPS, CSAT, comentarios) y constructor |
| `/app/facturacion`, `/app/cobros` | Plan y facturas de la organización · cobros de turnos |
| `/pago/:token` | Página de pago (checkout de la pasarela y confirmación) |
| `/encuesta/:token`, `/encuesta/s/:token` | Encuesta del turno y encuesta por enlace general o QR (`?sucursal=`) |
| `/terminos`, `/privacidad`, `/tratamiento-de-datos` | Documentos legales publicados (con sus versiones anteriores) |
| `/api/docs` | Documentación interactiva de la API |

## Documentación

- [Integración con otros sistemas](docs/INTEGRACION.md): API keys, endpoints, webhooks, tiempo real, embebido.
- [Despliegue y dispositivos](docs/DESPLIEGUE.md): producción, S3, TV, kioscos e impresoras.
- [Migración desde la versión anterior](docs/MIGRACION.md).
- [Pagos y facturación](docs/PAGOS.md): planes, cobros a clientes y pasarelas.
- [Factura electrónica SIFEN](docs/SIFEN.md): emisor, timbrado, certificado, CSC, pruebas y producción.
- [Documentos legales](docs/legal/README.md): licencia, términos del servicio, privacidad, tratamiento de datos y contrato de licencia.
- [Hoja de ruta](docs/HOJA-DE-RUTA.md): próximos pasos y pendientes.

## Licencia

Software propietario: todos los derechos reservados (ver [LICENSE](LICENSE)). Los componentes de terceros conservan sus licencias ([docs/LICENCIAS-DE-TERCEROS.md](docs/LICENCIAS-DE-TERCEROS.md)).
