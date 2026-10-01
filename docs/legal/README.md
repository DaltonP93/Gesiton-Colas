# Documentos legales

Plantillas propias para vender el sistema como **servicio en la nube (SaaS)** y para **instalarlo en los servidores
del cliente**, redactadas para la República del Paraguay. Son una base de trabajo, **no asesoramiento legal**:
revíselas con un abogado antes de usarlas, en especial precios, responsabilidad, datos personales y jurisdicción.

| Archivo | Para qué sirve | Cómo se usa |
| --- | --- | --- |
| [`../../LICENSE`](../../LICENSE) | Licencia propietaria del código: todos los derechos reservados. | Reemplace `[TITULAR…]` y `[CORREO DE CONTACTO]` por los datos reales. |
| [TERMINOS-DEL-SERVICIO.md](TERMINOS-DEL-SERVICIO.md) | Contrato del servicio en la nube: uso, precios, pagos, datos, disponibilidad, responsabilidad, terminación. | Se publica en `/terminos`; cada organización lo acepta. |
| [POLITICA-DE-PRIVACIDAD.md](POLITICA-DE-PRIVACIDAD.md) | Qué datos trata el titular, para qué, con quién, cuánto tiempo y cómo ejercer los derechos. | Se publica en `/privacidad` (informativa, no se acepta). |
| [ACUERDO-DE-TRATAMIENTO-DE-DATOS.md](ACUERDO-DE-TRATAMIENTO-DE-DATOS.md) | El titular como **encargado** de los datos de los pacientes o clientes de cada organización (responsable): obligaciones, subencargados, incidentes, medidas de seguridad. | Se publica en `/tratamiento-de-datos`; cada organización lo acepta. |
| [CONTRATO-DE-LICENCIA.md](CONTRATO-DE-LICENCIA.md) | Licencia de uso para **instalación propia** (bancos, hospitales): alcance, restricciones, mantenimiento, garantía, verificación y Anexo I con módulos, precio y plazo. | Se completa e imprime desde **Plataforma → Legal → Preparar contrato** y se firma. |

## Cómo se publican en el sistema

1. **Plataforma → Legal → Titular del software:** razón social, RUC, domicilio, correo, ciudad de la jurisdicción,
   disponibilidad, horario de soporte y días para exportar los datos. Son obligatorios los cinco primeros.
2. **Revisar y publicar** cada documento: se puede editar el texto (Markdown) con vista previa. Al publicar se crea
   una **versión** que no se modifica más: el texto queda con los datos del titular y es la constancia de lo aceptado.
3. Con **«Pedir que cada organización acepte los términos»** activado:
   - el registro y la demo muestran la casilla «Acepto…» (obligatoria);
   - en cada versión marcada como **cambio importante**, los administradores de cada organización ven un aviso que
     deben aceptar para seguir usando el panel (los operadores siguen atendiendo);
   - el soporte de la plataforma no puede aceptar en nombre de una organización.
4. Cada aceptación guarda organización, versión, usuario, fecha, IP y navegador, y queda en el registro de actividad.
   Se ve en **Plataforma → Legal → Aceptaciones por organización** y en **Configuración → Términos y contrato** de cada
   organización. Las constancias se conservan aunque se borre la organización o el usuario.
5. Las versiones anteriores siguen disponibles en `/terminos?version=N`.

Si cambian los datos del titular, el panel avisa qué documentos quedaron desactualizados: publique una versión nueva
(sin pedir nueva aceptación si el contenido no cambió).

## Variables

Los documentos usan variables que se completan al publicar:

| Variable | Valor |
| --- | --- |
| `{{producto}}` | Nombre de la plataforma (Plataforma → Ajustes → marca). |
| `{{titular}}`, `{{ruc}}`, `{{domicilio}}`, `{{correo}}` | Datos del titular. |
| `{{ciudad}}` | Ciudad de la jurisdicción (tribunales). |
| `{{sitio}}` | Dirección del sitio (o `PUBLIC_URL`). |
| `{{disponibilidad}}`, `{{soporte}}`, `{{dias_exportacion}}` | Disponibilidad comprometida, horario de soporte y días para exportar al terminar. |
| `{{version}}`, `{{fecha}}` | Número y fecha de la versión publicada. |

El contrato de licencia agrega los datos del licenciatario: `{{licenciatario}}`, `{{licenciatario_ruc}}`,
`{{licenciatario_domicilio}}`, `{{licenciatario_representante}}`, `{{modulos}}`, `{{alcance}}`, `{{plazo}}`,
`{{precio}}`, `{{mantenimiento}}`, `{{instalacion}}` e `{{inicio}}`. Lo que no se completa sale como una línea para
llenar a mano.

## Aviso de privacidad de cada organización

Cada organización es la **responsable** de los datos de sus pacientes o clientes. En **Configuración → Datos del
cliente → Privacidad** puede activar un aviso que se muestra en la reserva en línea, el kiosco, la fila virtual y las
encuestas. El texto estándar se arma con su nombre y su plazo de conservación; también puede escribir uno propio o
enlazar su política completa.

## Al editar estas plantillas

Los textos de esta carpeta son también las plantillas del sistema (`packages/shared/src/legalTemplates.ts`).
Después de cambiarlos, ejecute:

```bash
npm run legal:templates
```

Las pruebas verifican que el archivo generado coincida con esta carpeta y que las plantillas usen solo variables
conocidas.

## Para revisar con el abogado

- **Datos personales:** las referencias a la Ley N.° 1682/2001 y al artículo 135 de la Constitución. Verifique si rige
  una ley general de protección de datos posterior y ajuste plazos, derechos, transferencias internacionales y
  notificación de incidentes.
- **Datos de salud:** si se vende a hospitales, confirme las exigencias sobre datos sensibles y confidencialidad médica.
- **Consumidores:** las plantillas suponen clientes empresa u organizaciones. Si se vende a personas físicas como
  consumidores, revise la Ley N.° 1334/1998 de Defensa del Consumidor.
- **Precios e impuestos:** moneda, IVA, mora, intereses y suspensión por falta de pago.
- **Responsabilidad:** el tope de 12 meses de pagos, las exclusiones y la indemnidad.
- **Disponibilidad:** el porcentaje comprometido y el crédito por indisponibilidad.
- **Jurisdicción:** tribunales de la ciudad elegida o arbitraje (por ejemplo, el Centro de Arbitraje y Mediación
  Paraguay).
- **Aceptación electrónica:** la validez de la casilla de aceptación y de la constancia que guarda el sistema.
- **Instalación propia:** licencia perpetua o por suscripción, verificación del uso y entrega de código fuente.
