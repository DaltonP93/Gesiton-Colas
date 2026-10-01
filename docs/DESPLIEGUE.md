# Despliegue y dispositivos

## Producción con Docker

```bash
cp .env.example .env
# Edite: JWT_SECRET (openssl rand -hex 32), PUBLIC_URL, POSTGRES_PASSWORD, SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD
docker compose up -d
```

- La imagen incluye API y frontend; escucha en el puerto `3000`. Las migraciones se aplican solas al iniciar (`AUTO_MIGRATE=true`).
- Coloque un proxy inverso con HTTPS delante (Nginx, Caddy, Traefik o el balanceador de su nube). Debe permitir **WebSockets** en `/socket.io/`.
- Los archivos subidos se guardan en el volumen `uploads` (`/data/uploads`) y las copias de seguridad automáticas en el volumen `backups` (`/data/backups`; ver [Copias de seguridad](#copias-de-seguridad)).

Ejemplo con Caddy:

```
colas.ejemplo.com {
  reverse_proxy app:3000
}
```

### Página de presentación con dominio propio

La presentación del producto se arma en **Plataforma → Ajustes → Página de presentación → Personalizar**: 6 plantillas (moderna, clásica, minimalista, oscura, corporativa y vibrante), portada, secciones, colores, tipografía, pie, redes y la imagen al compartir el enlace. Siempre está en `/presentacion`; la dirección principal (`/`) muestra lo que se elija en «Página principal».

Para tenerla en otro dominio (por ejemplo `www.suempresa.com`) y el panel en `PUBLIC_URL` (por ejemplo `app.suempresa.com`):

1. Apunte el dominio nuevo al mismo servidor (registro A o CNAME).
2. Agréguelo al mismo sitio del proxy, que debe pasar el encabezado `Host` original:

   ```
   app.suempresa.com, www.suempresa.com {
     reverse_proxy app:3000
   }
   ```

3. Escriba `www.suempresa.com` en **Publicación → Dominio propio**. Con ese dominio, `/` muestra siempre la presentación y los botones («Ingresar», «Probar gratis», «Ver demo») llevan al panel.

El servidor agrega el título, la descripción y la imagen de la presentación al HTML de `/` y `/presentacion`, para que se vean al compartir el enlace por WhatsApp, Facebook o LinkedIn.

### Correo electrónico (SMTP)

Necesario para la demo por correo, la verificación de email, «olvidé mi contraseña», el ingreso con código y las invitaciones. Funciona con cualquier proveedor SMTP:

| Proveedor | Configuración |
| --- | --- |
| Google Workspace / Gmail | `SMTP_URL=smtps://usuario%40dominio.com:CLAVE_DE_APLICACION@smtp.gmail.com:465` |
| Microsoft 365 | `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS` |
| Amazon SES | `SMTP_HOST=email-smtp.<región>.amazonaws.com`, `SMTP_PORT=587`, credenciales SMTP de SES |
| SendGrid | `SMTP_HOST=smtp.sendgrid.net`, `SMTP_USER=apikey`, `SMTP_PASS=<API key>` |
| Brevo / Mailgun / Resend | Use el host, usuario y clave SMTP que indique el proveedor |

Defina también `MAIL_FROM` con un remitente de su dominio (configure SPF/DKIM en el proveedor para evitar la carpeta de spam). Los correos usan el logo, colores y nombre de cada organización.

Opciones relacionadas:

- `EMAIL_VERIFICATION=required` exige confirmar el correo antes de ingresar (`optional` lo recuerda con un aviso; `off` lo desactiva).
- `ALLOW_DEMO` y `DEMO_DAYS` controlan la demo por correo. Las demos vencidas quedan bloqueadas y se eliminan 30 días después; desde `/plataforma` se pueden extender o convertir en clientes.

### Almacenamiento en la nube (S3, Cloudflare R2, MinIO, Spaces)

```
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<cuenta>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=gestion-colas
S3_ACCESS_KEY=…
S3_SECRET_KEY=…
S3_PUBLIC_URL=https://cdn.ejemplo.com   # dominio público del bucket o CDN
```

Con S3 los videos se sirven directamente desde el bucket/CDN, lo que descarga al servidor.

### Copias de seguridad

Desde **Plataforma → Copias** el superadministrador programa una copia diaria automática (hora, zona horaria y cuántos días se guardan), crea una en el momento, la descarga o la borra. Cada copia es un archivo `gestion-colas-AAAAMMDD-HHMMSS.tar.gz` con:

- la base de datos completa (`pg_dump`, todas las organizaciones),
- los archivos subidos (si se guardan en el servidor; con S3 ya quedan en el bucket),
- un manifiesto con la fecha.

Detalles:

- La imagen de Docker trae `pg_dump`, `pg_restore` y `psql` de PostgreSQL 16, la misma versión de la base de `docker-compose.yml`; si actualiza la base a otra versión, cambie también el paquete `postgresql16-client` del `Dockerfile`. Sin Docker instale el cliente de PostgreSQL de la **misma versión** que el servidor, o indique su carpeta en `PG_BIN_DIR`; la carpeta de las copias se cambia con `BACKUP_DIR`.
- Las copias más viejas que el plazo se borran solas después de cada copia correcta. Si una falla, se avisa por correo a los superadministradores.
- **Guarde una copia fuera del servidor**: en **Plataforma → Copias → Copias fuera del servidor** agregue uno o más destinos y cada copia se sube también allí (una copia en el mismo disco no sirve si se pierde el servidor):
  - **S3 y compatibles**: Amazon S3, Cloudflare R2, Backblaze B2, Wasabi, DigitalOcean Spaces, Google Cloud Storage (clave HMAC) o MinIO. Cada proveedor indica el endpoint y de dónde sacar las claves.
  - **SFTP**: otro servidor Linux, un NAS (Synology, QNAP) o un hosting con SSH, con contraseña o clave privada. La huella del servidor se guarda en la primera conexión y se verifica en las siguientes.
  - **WebDAV**: Nextcloud, ownCloud, Synology, pCloud, Koofr, Yandex Disk u otro.

  «Probar conexión» escribe y borra un archivo de prueba. Las claves se guardan cifradas con `JWT_SECRET`. Si una subida falla, la copia queda en el servidor, se avisa por correo a los superadministradores y se puede reintentar desde el listado. Al vencer el plazo, las copias se borran también de los destinos. El S3 configurado con variables (`S3_BUCKET`, carpeta `backups/`) sigue disponible como «S3 del servidor».
- Las copias contienen **todos los datos**, también las claves de las pasarelas de pago y del correo (cifradas con `JWT_SECRET`, que no viaja en la copia: guárdelo aparte; sin él esas claves no se pueden leer). Se guardan con permisos `600`, solo el superadministrador las descarga y cada descarga queda en el registro de actividad. Si usa S3, el bucket debe ser privado.

**Restaurar una copia** reemplaza todos los datos actuales. Antes se guarda automáticamente una copia de lo actual (`…-previa.tar.gz`) y la restauración se hace en una sola transacción: si falla, la base queda como estaba.

```bash
docker compose stop app
docker compose run --rm app node apps/api/dist/db/admin-cli.js restore /data/backups/gestion-colas-20261001-030000.tar.gz --confirm
docker compose start app
```

Para restaurar un archivo descargado, cópielo primero al volumen: `docker compose cp ./gestion-colas-….tar.gz app:/data/backups/` (con la app iniciada) o `docker run --rm -v gestion-colas_backups:/data/backups -v "$PWD":/src alpine cp /src/gestion-colas-….tar.gz /data/backups/`. Después de restaurar, al iniciar se aplican las migraciones que falten (una copia vieja se actualiza sola). Sin Docker: `node apps/api/dist/db/admin-cli.js restore <archivo> --confirm`. También se puede crear una copia por consola con `admin-cli.js backup`.

### Varias instancias

La API no guarda estado en memoria salvo las conexiones de Socket.IO. Para escalar horizontalmente use *sticky sessions* en el balanceador y el [adaptador Redis de Socket.IO](https://socket.io/docs/v4/redis-adapter/). Los webhooks, las alertas de equipos y la copia de seguridad diaria usan bloqueos en la base de datos, por lo que varias instancias pueden funcionar juntas sin duplicar envíos ni copias. Con varias instancias, monte el mismo volumen de copias en todas (o use S3) para que el listado y las descargas coincidan.

### Modo SaaS y superadministrador

- `ALLOW_SIGNUP=true` permite que cualquier organización se registre en `/registro`.
- Defina `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD` para crear el administrador de la plataforma. Desde `/plataforma` puede ver todas las organizaciones, cambiar su plan, suspenderlas o entrar en «modo soporte».
- Los límites de cada plan están en `packages/shared/src/plans.ts`.

## Pantallas (TV)

La forma más simple: en el navegador de la TV abra **`https://su-dominio/vincular`**. Aparece un código de 6 dígitos; en el portal (**Vincular dispositivo**) escriba el código y elija la pantalla. La TV pasa sola a su pantalla y la recuerda al encenderse.

También puede abrir directamente el enlace de la pantalla (**Pantallas → Configurar → Enlace**) en cualquier navegador moderno:

| Dispositivo | Recomendación |
| --- | --- |
| Smart TV (Samsung, LG) | Navegador integrado. Toque/seleccione la pantalla una vez para habilitar el sonido. |
| Android TV / Google TV / Fire TV | Instale una app de *kiosk browser* (p. ej. Fully Kiosk Browser) con autoinicio. |
| Mini PC / Windows / Linux | Chrome o Edge en modo kiosco: `chrome --kiosk --autoplay-policy=no-user-gesture-required https://…/pantalla/TOKEN` |
| Raspberry Pi | Chromium en modo kiosco con los mismos parámetros al iniciar la sesión. |

- La voz usa la síntesis del sistema (sin costo). Las voces disponibles dependen del equipo; en **Voz y sonido** puede elegir una específica y probarla. En **Sonidos de llamado** hay una guía para instalar más voces en Windows, Android/Google TV y macOS.
- Sonidos: 19 tonos incluidos, audios propios (también una voz grabada) y música ambiental o radios por streaming que bajan el volumen en cada llamado.
- La pantalla mantiene el dispositivo encendido (Wake Lock), se reconecta sola y aplica los cambios de configuración y publicidad sin recargar.

## Kioscos e impresoras

- Enlace: **Kioscos → Configurar → Enlaces y QR**.
- Impresoras térmicas de 58 u 80 mm: configúrelas como predeterminadas en el sistema operativo y abra el kiosco con `chrome --kiosk --kiosk-printing https://…/kiosco/TOKEN` para imprimir sin diálogo.
- La plantilla del ticket es HTML editable con variables (`{{code}}`, `{{service}}`, `{{qr}}`…). Se sanitiza antes de imprimir.
- **Fila virtual:** imprima el cartel con el QR de la versión móvil y colóquelo en la entrada.

## Variables de entorno

Vea [`.env.example`](../.env.example) para la lista completa con descripciones.
