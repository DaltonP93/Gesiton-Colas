# Pagos y facturación

Hay dos niveles de cobro, y cada uno se activa por separado:

| Nivel | Quién cobra a quién | Dónde se activa |
| --- | --- | --- |
| **Facturación de la plataforma** | El dueño de la plataforma cobra el plan a cada organización (empresa). | Plataforma → Facturación → «Facturar los planes a las organizaciones». |
| **Cobros a clientes** | Cada organización cobra sus servicios a sus clientes o pacientes. | Módulo **«Cobros a clientes»** (por plan o por organización en Plataforma → Módulos) y luego Configuración → Cobros y pagos. |

Si nada de esto está activo, el sistema funciona igual que antes y no aparece ningún menú de pagos.

## 1. Facturación de la plataforma (superadministrador)

1. **Precio de cada plan**: Plataforma → Ajustes → Planes y módulos.
2. **Facturación**: Plataforma → Facturación.
   - *Emitir sola la factura de cada mes*: el día 1 se crea la factura del plan de cada organización con plan pago. Las organizaciones creadas durante el mes empiezan a facturarse al mes siguiente. Nunca se duplica: hay una factura del plan por mes y organización.
   - *Días para pagar* y *Suspender por falta de pago* con *días de gracia*. Una organización suspendida por deuda **no pierde nada**: sus administradores pueden entrar, pero solo ven «Plan y facturación» para pagar. Las pantallas, los kioscos y la atención quedan detenidos hasta que se pague. Al acreditarse el pago se reactiva sola.
   - *Instrucciones de pago* (cuenta bancaria, alias), razón social y RUC del emisor.
3. **Facturas manuales** («Nueva factura»): instalación, capacitación, equipos, etc.
4. **Registrar pago**: para transferencias o efectivo. Queda la forma de pago y la referencia.
5. **Cobro en línea**: con una pasarela activa (ver abajo), cada organización paga sus facturas con el botón «Pagar».

> Estas facturas son **comprobantes internos de cobro**. La factura legal (timbrada o electrónica SIFEN en Paraguay) se sigue emitiendo con su sistema contable.

El ciclo automático (factura del mes y suspensiones) corre con el mantenimiento del servidor cada 6 horas.

## 2. Cobros a clientes (cada organización)

1. El superadministrador activa el módulo **«Cobros a clientes»** para la organización (o lo incluye en el plan).
2. En **Configuración → Servicios**, cada servicio puede tener **precio**. Los servicios sin precio no se cobran.
3. En **Configuración → Cobros y pagos**:
   - moneda (PYG, USD, ARS, BRL, EUR);
   - «Pago en línea en el seguimiento»: el cliente ve el importe y un botón **Pagar en línea** en la página de su turno (la del QR del ticket);
   - «Mostrar precios en el kiosco»;
   - la **pasarela** propia de la organización (el dinero se acredita en su cuenta).
4. En la **consola de atención**, el operador ve si el turno está pagado y puede **registrar el cobro** en efectivo, POS, transferencia o QR.
5. **Cobros** (menú de supervisores) muestra el listado del día, la semana o el mes con los totales en línea y en el puesto.
6. Cada pago acreditado dispara el webhook `payment.paid` (integraciones con ERP o sistemas contables).

## 3. Pasarelas

La configuración es la misma para la plataforma y para cada organización: se elige la pasarela, se cargan las claves (se guardan **cifradas** y nunca vuelven a mostrarse) y se copia la **URL de confirmación** en el panel de la pasarela.

| Pasarela | Claves | URL de confirmación |
| --- | --- | --- |
| **Bancard vPOS 2.0** | Clave pública y privada del comercio (Bancard las entrega; primero las de *staging*). | Se informa a Bancard como «URL de confirmación». El cliente paga en el checkout de Bancard, que se muestra dentro de la página de pago. |
| **PagoPar** | Clave pública y privada (PagoPar → Integrar con mi sitio). | Se configura como «URL de respuesta». El cliente paga en la página de PagoPar (tarjetas, billeteras, bocas de cobranza). |
| **Stripe Checkout** | Clave secreta `sk_test_…` / `sk_live_…` y el secreto de firma del webhook `whsec_…`. | Stripe → Desarrolladores → Webhooks, eventos `checkout.session.completed` y `checkout.session.expired`. |

- **Modo de pruebas**: úselo con las claves de prueba hasta confirmar que todo funciona; después desactívelo y cargue las claves reales.
- **Pago de prueba**: crea un cobro de prueba en la pasarela para verificar las claves.
- Todas las confirmaciones se **verifican**: la firma HMAC-SHA256 de Stripe (con tolerancia de 5 minutos) y los tokens `sha1` de PagoPar y `md5` de Bancard calculados con la clave privada. Una confirmación falsa se rechaza. Además, la pasarela de una organización solo puede confirmar pagos de esa organización.
- Si el servidor **no es accesible desde Internet** (instalación en una red interna), las confirmaciones no llegan, pero el estado se **consulta a la pasarela** cuando el cliente vuelve a la página de pago.

### Estado de las integraciones

Las tres pasarelas se implementaron según su documentación pública y se probaron con **servidores simulados** que validan las mismas firmas y tokens (`apps/api/test/payments.test.ts`). **No se probaron contra los ambientes reales** de Bancard, PagoPar ni Stripe, porque este entorno no tiene acceso a ellos ni cuentas de comercio. Antes de cobrar de verdad:

1. Pruebe cada pasarela en su ambiente de pruebas (Stripe *test mode*, PagoPar y Bancard *staging*), con un pago aprobado, uno rechazado y uno cancelado.
2. Confirme que la URL de confirmación llega (el pago pasa a «Pagado» sin volver a la página).
3. En Bancard, confirme la versión del script del checkout (`bancard-checkout-4.0.0.js`) con la que le indique Bancard. Si es otra, se cambia en `apps/api/src/lib/payments/gateways.ts`.
4. En PagoPar, confirme con su ejecutivo los datos obligatorios del comprador para su rubro.
