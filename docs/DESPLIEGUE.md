# Despliegue y dispositivos

## Producción con Docker

```bash
cp .env.example .env
# Edite: JWT_SECRET (openssl rand -hex 32), PUBLIC_URL, POSTGRES_PASSWORD, SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD
docker compose up -d
```

- La imagen incluye API y frontend; escucha en el puerto `3000`. Las migraciones se aplican solas al iniciar (`AUTO_MIGRATE=true`).
- Coloque un proxy inverso con HTTPS delante (Nginx, Caddy, Traefik o el balanceador de su nube). Debe permitir **WebSockets** en `/socket.io/`.
- Los archivos subidos se guardan en el volumen `uploads` (`/data/uploads`). Haga copias de seguridad del volumen y de PostgreSQL.

Ejemplo con Caddy:

```
colas.ejemplo.com {
  reverse_proxy app:3000
}
```

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

### Varias instancias

La API no guarda estado en memoria salvo las conexiones de Socket.IO. Para escalar horizontalmente use *sticky sessions* en el balanceador y el [adaptador Redis de Socket.IO](https://socket.io/docs/v4/redis-adapter/). Los webhooks usan bloqueo en base de datos, por lo que varias instancias pueden procesarlos sin duplicar envíos.

### Modo SaaS y superadministrador

- `ALLOW_SIGNUP=true` permite que cualquier organización se registre en `/registro`.
- Defina `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD` para crear el administrador de la plataforma. Desde `/plataforma` puede ver todas las organizaciones, cambiar su plan, suspenderlas o entrar en «modo soporte».
- Los límites de cada plan están en `packages/shared/src/plans.ts`.

## Pantallas (TV)

Abra el enlace de la pantalla (**Pantallas → Configurar → Enlace**) en cualquier navegador moderno:

| Dispositivo | Recomendación |
| --- | --- |
| Smart TV (Samsung, LG) | Navegador integrado. Toque/seleccione la pantalla una vez para habilitar el sonido. |
| Android TV / Google TV / Fire TV | Instale una app de *kiosk browser* (p. ej. Fully Kiosk Browser) con autoinicio. |
| Mini PC / Windows / Linux | Chrome o Edge en modo kiosco: `chrome --kiosk --autoplay-policy=no-user-gesture-required https://…/pantalla/TOKEN` |
| Raspberry Pi | Chromium en modo kiosco con los mismos parámetros al iniciar la sesión. |

- La voz usa la síntesis del sistema (sin costo). Las voces disponibles dependen del equipo; en **Voz y sonido** puede elegir una específica y probarla.
- La pantalla mantiene el dispositivo encendido (Wake Lock), se reconecta sola y aplica los cambios de configuración y publicidad sin recargar.

## Kioscos e impresoras

- Enlace: **Kioscos → Configurar → Enlaces y QR**.
- Impresoras térmicas de 58 u 80 mm: configúrelas como predeterminadas en el sistema operativo y abra el kiosco con `chrome --kiosk --kiosk-printing https://…/kiosco/TOKEN` para imprimir sin diálogo.
- La plantilla del ticket es HTML editable con variables (`{{code}}`, `{{service}}`, `{{qr}}`…). Se sanitiza antes de imprimir.
- **Fila virtual:** imprima el cartel con el QR de la versión móvil y colóquelo en la entrada.

## Variables de entorno

Vea [`.env.example`](../.env.example) para la lista completa con descripciones.
