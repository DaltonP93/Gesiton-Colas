# Factura electrónica SIFEN (Paraguay)

Módulo **Factura electrónica SIFEN**: cada organización emite sus facturas electrónicas ante la SET desde el sistema, y la
plataforma factura sus planes a las organizaciones con su propio emisor. Implementa el **Manual Técnico SIFEN v150**.

## Qué hace

- Arma el XML del Documento Electrónico (factura, `iTiDE = 1`) con el CDC y su dígito verificador
  ([facturacionelectronicapy-xmlgen](https://github.com/marcosjara/facturacionelectronicapy-xmlgen), MIT).
- Lo **firma** con el certificado del emisor (XML-DSig, RSA-SHA256, c14n exclusiva), arma el **QR** con el CSC y lo
  **envía a la SET** por el servicio sincrónico (`siRecepDE`) con el certificado como TLS de cliente.
- Guarda la respuesta: **Aprobada**, **Rechazada** (con el código y el mensaje de la SET) o **Sin enviar** (sin conexión).
  Rechazada → «Corregir y reenviar» genera de nuevo el documento con **el mismo número**; sin conexión → «Reenviar» o
  «Consultar en la SET» (`siConsDE`), por si la SET la aprobó y no llegó la respuesta.
- **Anulación** (evento de cancelación firmado, `siRecepEvento`) hasta 48 h después de la aprobación; después corresponde
  una nota de crédito.
- **KuDE** (representación gráfica) en `/factura/<enlace>`: para imprimir, guardar en PDF o enviar; se manda solo al
  correo del cliente al aprobarse. Descarga del XML firmado.
- Consulta de RUC en la SET (`siConsRUC`) para completar la razón social del cliente.
- Clientes: contribuyente (RUC), cédula, pasaporte o sin nombre (consumidor final). IVA 10 %, 5 % o exento por ítem,
  contado (efectivo, tarjeta, transferencia, billetera, pago electrónico…) o crédito, en guaraníes o dólares.

Dónde se usa:

| Quién | Dónde | Cómo |
| --- | --- | --- |
| Organización | **Facturas** (menú) | Factura manual con los servicios y sus precios. |
| Organización | **Cobros** | Botón «Facturar» en cada cobro; o **automática** al cobrar (Configuración → Factura electrónica → «Facturar sola cada cobro»), al documento del cliente del turno o como consumidor final. |
| Plataforma | **Plataforma → Facturación** | «Factura electrónica» en las facturas pagadas de los planes, con el RUC que cada organización carga en «Plan y facturación → Datos para su factura». |
| Plataforma | **Plataforma → SIFEN** | Facturas emitidas y emisor de la plataforma. |

## Qué necesita el emisor

1. **RUC activo** y estar habilitado como **facturador electrónico** en Marangatú (solicitud de timbrado electrónico).
2. **Timbrado** electrónico: número (8 dígitos) y fecha de inicio de vigencia; establecimiento y punto de expedición.
3. **Certificado digital** de firma (archivo `.p12` / `.pfx` y su contraseña) emitido por una certificadora habilitada
   (Code100, Documenta, VIT S.A., etc.). Se guarda cifrado; nunca se muestra ni se devuelve.
4. **CSC** (código de seguridad del contribuyente) y su identificador, que la SET entrega en Marangatú. Hay uno para
   el ambiente de pruebas y otro para producción.
5. Actividad económica principal (código y descripción), domicilio fiscal (departamento, distrito y ciudad de las
   tablas de SIFEN), teléfono y correo.

Todo se carga en **Configuración → Factura electrónica** (organización) o **Plataforma → SIFEN → Emisor** (plataforma).
El panel indica qué falta para poder emitir.

## Pruebas y producción

- Empiece en el ambiente de **Pruebas** (`sifen-test.set.gov.py`, QR en `ekuatia.set.gov.py/consultas-test`): las
  facturas no tienen valor fiscal, el emisor figura como «DE generado en ambiente de prueba - sin valor comercial ni
  fiscal» y el KuDE lo indica. Use el CSC de pruebas.
- Emita varias facturas de prueba (cédula, RUC, sin nombre, contado y crédito), verifique el QR en e-Kuatia y una
  anulación. Cuando la SET lo habilite, cambie a **Producción**, cargue el CSC de producción y fije el **próximo número**
  que corresponda (no se puede volver a un número ya usado).
- Los números son correlativos por emisor, establecimiento y punto: dos emisiones a la vez nunca comparten número y,
  si los datos no pasan las validaciones del manual, el número se devuelve.

> **Importante:** las pruebas automáticas del sistema usan un simulador de la SET. La conexión real con
> `sifen-test.set.gov.py` debe probarse con su RUC, su certificado y su CSC de pruebas antes de pasar a producción.
> Las respuestas, los plazos y las validaciones finales son los de la SET.

## Integración

- API (con sesión de usuario): `GET/PUT /api/v1/invoicing/issuer`, `POST /api/v1/invoicing/issuer/certificate`
  (`{ p12: base64, password }`), `PUT /api/v1/invoicing/issuer/csc`, `GET/POST /api/v1/invoicing/documents`,
  `GET /api/v1/invoicing/documents/{id}/xml`, `POST …/retry`, `POST …/refresh`, `POST …/cancel`, `POST /api/v1/invoicing/ruc`.
  La plataforma usa las mismas rutas bajo `/api/v1/platform/invoicing`. Ver `/api/docs`.
- Cada emisión, anulación y cambio de configuración queda en el **registro de actividad** (sin la clave del certificado
  ni el CSC).
