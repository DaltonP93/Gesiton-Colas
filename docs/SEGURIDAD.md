# Seguridad y protección de datos

Informe de la auditoría forense del código (septiembre de 2026) y de las medidas aplicadas.
Se revisó el aislamiento entre organizaciones, la escalada de privilegios, las fugas de datos
personales y de secretos, la autenticación, la inyección y la privacidad.

## Resultado

**No se encontró ningún acceso a datos de otra organización.** Todas las rutas filtran por
organización y los tokens públicos (pantalla, kiosco, seguimiento) son aleatorios de 116 a 140 bits.
Se encontraron y **corrigieron** los siguientes problemas:

| # | Gravedad | Hallazgo | Estado |
| --- | --- | --- | --- |
| 1 | Alta | El CSS de la plantilla del ticket podía cerrar la etiqueta `<style>` e inyectar código que se ejecutaba al imprimir (también en la sesión del superadministrador en modo soporte). | **Corregido**: impresión en un iframe aislado sin scripts, el CSS no admite `<` (se valida en el servidor) y política de contenido (CSP). |
| 2 | Alta | El filtro contra accesos a la red interna (SSRF) de webhooks y SMTP se evadía con IPv6 especiales (`::ffff:7f00:1`) y con cambios de DNS. | **Corregido**: clasificación completa de IPv4/IPv6 y validación en el momento de conectar (webhooks) o conexión a la IP ya validada (SMTP de cada organización). |
| 3 | Alta | Los límites de intentos se evadían enviando `X-Forwarded-For`. | **Corregido**: `TRUST_PROXY` configurable (por defecto no se confía en el encabezado) y bloqueo por cuenta tras 5 contraseñas o códigos incorrectos (15 min, luego el doble). |
| 4 | Media | Se podían probar códigos de vinculación al azar para quedarse con TVs de otras organizaciones. | **Corregido**: bloqueo por organización tras 10 códigos incorrectos, además del límite por IP. |
| 5 | Media | `legacy/novosga/public/.htaccess` tenía una contraseña real de MySQL. | **Corregido en el archivo.** Queda en el historial de git: **cambie esa contraseña** si todavía se usa y, si el repositorio se compartió, púrguelo con `git filter-repo`. |
| 6 | Media | Sin SMTP, los enlaces de recuperación y códigos de acceso se escribían en el log. | **Corregido**: en producción solo se registra el destinatario. |
| 7 | Media | Un operador asignado a una sucursal veía turnos y datos personales de todas. | **Corregido**: listados, cola, detalle y tiempo real limitados a sus sucursales. |
| 8 | Media | Los datos personales se guardaban para siempre y cualquier supervisor los exportaba. | **Corregido**: plazo de conservación configurable, borrado a pedido del titular y exportación de datos personales solo para administradores. El historial de webhooks se borra a los 30 días y el de avisos por WhatsApp/SMS (teléfono y texto) con el plazo de la organización o a los 90 días; el borrado a pedido también lo alcanza. |
| 9 | Media | El CSS propio de una organización se aplicaba en la sesión del superadministrador. | **Corregido.** |
| 10 | Baja | El máximo de 5 intentos por código no era atómico. | **Corregido.** |
| 11 | Baja | El ingreso por código no se desactivaba en todos los caminos. | **Corregido.** |
| 12 | Baja | La prueba de SMTP podía enviar la contraseña guardada a otro servidor. | **Corregido**: con otro servidor o usuario hay que escribir la contraseña. |
| 13 | Baja | Con el QR del kiosco se podían recibir los nombres de los llamados. | **Corregido**: los kioscos ya no reciben los llamados. |
| 14 | Baja | El tiempo de respuesta del login revelaba si una cuenta existía. | **Corregido** (comparación ficticia). Los mensajes «invitación pendiente» / «sin contraseña» se mantienen por usabilidad. |

## Medidas vigentes

- Contraseñas con bcrypt; enlaces, códigos, API keys y secretos de vinculación guardados como hash.
- Contraseñas SMTP, tokens de WhatsApp/SMS y claves de las pasarelas de pago cifradas con AES-256-GCM (clave derivada de `JWT_SECRET`; si cambia `JWT_SECRET` hay que volver a cargarlas).
- Confirmaciones de pago verificadas (firma HMAC de Stripe, tokens de PagoPar y Bancard) y limitadas a la organización dueña de la pasarela; los pagos acreditados no cambian de estado.
- Sesiones JWT con algoritmo fijo que se invalidan al cambiar o restablecer la contraseña.
- Rol y estado del usuario leídos de la base en cada pedido; módulos y suspensión aplicados en la API.
- **Registro de auditoría** (Configuración → Registro de actividad; Plataforma → Actividad): cada cambio guarda quién lo hizo, cuándo, desde qué IP y los datos enviados (sin contraseñas ni claves), además de los ingresos y los intentos fallidos. Lo que hace un superadministrador dentro de una organización queda marcado como «Soporte» y la organización lo ve. Se conserva un año.
- Consultas parametrizadas, protección contra inyección de fórmulas en CSV, archivos subidos con nombres generados y servidos con `CSP sandbox`.
- Política de contenido (CSP) en el panel, las pantallas y los kioscos: solo se ejecuta código propio y la API de YouTube.

## Recomendaciones pendientes para la instalación

1. **HTTPS con dominio** (Caddy o Nginx con Let's Encrypt) y luego `TRUST_PROXY=1`. Hoy el acceso por IP viaja sin cifrar.
2. **Copias de seguridad** diarias de la base y del volumen `/data` (ver `docs/DESPLIEGUE.md`).
3. `JWT_SECRET` de al menos 32 caracteres (`openssl rand -hex 32`); no reutilizarlo en otros sistemas.
4. No usar `DEV_OUTBOX=true` en una instalación real.
5. Rotar la contraseña de MySQL del sistema anterior (hallazgo 5).
6. Definir el plazo de conservación de datos personales (Configuración → Datos del cliente) según la política del establecimiento.
