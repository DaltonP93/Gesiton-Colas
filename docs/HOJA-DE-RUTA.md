# Hoja de ruta

Estado al 1 de octubre de 2026 y próximos pasos sugeridos. El foco comercial: **gestión de colas que se conecta con los
sistemas que el cliente ya tiene** (HIS, ERP, agendas, CRM). En hospitales y clínicas la agenda y la historia clínica
viven en el HIS: el valor está en la llegada, la fila, el llamado, la experiencia del paciente y los datos de atención.

## Licencia y documentos legales

Ya están la licencia propietaria ([LICENSE](../LICENSE)) y las plantillas de **términos del servicio**, **política de
privacidad**, **acuerdo de tratamiento de datos** y **contrato de licencia** para instalación propia
([docs/legal](legal/README.md)), con publicación por versión y aceptación de cada organización en el sistema.
**Falta:** completar los datos del titular en el `LICENSE` y en Plataforma → Legal, y que un abogado revise los textos
antes de publicarlos.

## Ya disponible

Atención y fila (sucursales, servicios, prioridades, numeración, consola, monitor), pantallas TV con publicidad,
kioscos y fila virtual, sonidos y voz, reportes, integraciones (API REST, API keys, webhooks), avisos por WhatsApp y
SMS, encuestas (NPS/CSAT), cobros a clientes (Bancard, PagoPar, Stripe, manual), facturación de planes con módulos
adicionales, **citas** (API/CSV/reserva en línea, llegada en el kiosco por horario), **factura electrónica SIFEN**,
**registro de actividad**, **alertas de equipos desconectados**, **copias de seguridad automáticas** y **términos y
contratos** con aceptación por versión. Cada función
es un módulo que el superadministrador activa por plan o por organización, con precio de módulo adicional.

## Próximos pasos recomendados (en orden)

### 1. Interoperabilidad en salud (lo que más vende en hospitales)

- **HL7 FHIR R4**: recibir `Appointment` / `Patient` y devolver `Encounter` (llegada, llamado, atención) desde y hacia
  el HIS; endpoint FHIR mínimo y suscripciones.
- **HL7 v2** (SIU^S12 citas, ADT^A04 admisión) mediante un conector compatible con Mirth Connect / NextGen Connect.
- **Llamado desde el HIS**: que el médico llame al siguiente desde su sistema (API de puesto con API key y botón
  integrable), sin abrir la consola.
- Mapeo de servicios/consultorios del HIS ↔ servicios/puestos del sistema y sincronización de profesionales.

### 2. Acceso y seguridad corporativa

- **Inicio de sesión único**: OpenID Connect (Microsoft Entra ID, Google Workspace) y SAML; **LDAP / Active
  Directory** para el personal de hospitales y bancos; alta automática de usuarios (SCIM).
- **Doble factor (2FA)** para administradores y superadministradores; política de contraseñas y bloqueo por intentos.
- Permisos por sucursal y por servicio más finos (p. ej. supervisor de una sola sucursal).

### 3. Escala y operación del SaaS

- Socket.IO con **adaptador Redis** y varias instancias detrás de un balanceador (ya preparado: bloqueos en base).
- Métricas y trazas (OpenTelemetry / Prometheus), página de estado y alertas de la plataforma.
- Cobro recurrente con tarjeta guardada, prueba gratis con conversión, límites de uso por plan (sucursales, turnos,
  pantallas) y portal de autoservicio del cliente.
- Copias fuera del servidor por defecto (S3) y prueba periódica de restauración.

### 4. Canales para el cliente

- **Bot de WhatsApp**: sacar turno o presentarse a la cita por chat, consultar cuánto falta y confirmar/cancelar la
  cita respondiendo al recordatorio.
- Lectura de la **cédula** en el kiosco (código del documento) para no escribir el número.
- App/PWA instalable para TVs y kioscos (modo quiosco, reinicio automático, funcionamiento sin conexión breve).

### 5. Datos y gestión

- Predicción del tiempo de espera y de la demanda por hora; sugerencia de cuántos puestos abrir.
- Tableros para BI (Power BI, Metabase) y exportación programada; comparativo entre sucursales.
- Productividad y pausas de operadores; metas de tiempo (SLA) por servicio con alertas.

### 6. SIFEN y cobros

- **Nota de crédito electrónica** (anular después de las 48 h), envío por **lotes asíncronos** para volúmenes altos y
  KuDE en PDF generado en el servidor.
- Conciliación de cobros con la factura y reportes de ventas por servicio.

## Acciones que dependen del cliente / dueño del producto

- Probar SIFEN contra **sifen-test.set.gov.py** con el RUC, el certificado y el CSC de pruebas; luego producción.
- Tras la limpieza del historial de git: actualizar el servidor (`git fetch origin && git reset --hard origin/main`),
  **cambiar la contraseña de MySQL del sistema anterior** y pedir a GitHub Support que purgue las referencias en caché
  de los pull requests antiguos. Considerar volver **privado** el repositorio.
- Reemplazar el sonido de origen no documentado señalado en [LICENCIAS-DE-TERCEROS.md](LICENCIAS-DE-TERCEROS.md).
- Completar el titular en el `LICENSE` y en Plataforma → Legal, revisar los documentos con un abogado y publicarlos.
