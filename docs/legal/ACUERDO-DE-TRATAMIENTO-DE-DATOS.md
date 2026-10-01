# Acuerdo de tratamiento de datos personales

Versión {{version}} · Vigente desde el {{fecha}}

Este acuerdo forma parte de los [Términos y condiciones del servicio](/terminos) de **{{producto}}**. Regula el
tratamiento de datos personales que **{{titular}}**, RUC {{ruc}} (el «Encargado»), realiza por cuenta de la
organización cliente (el «Responsable»).

## 1. Objeto y roles

El Responsable decide para qué y cómo se tratan los datos de las personas que atiende, y los carga en el Servicio. El Encargado trata esos datos solo para prestar el Servicio y según las instrucciones documentadas del Responsable: estos términos, este acuerdo y la configuración que el Responsable elige en el panel.

## 2. Datos y personas alcanzadas

- **Personas:** clientes, pacientes, visitantes y demás personas atendidas por el Responsable, y los usuarios del panel del Responsable.
- **Datos:** nombre, documento de identidad, teléfono, correo, los campos propios que configure el Responsable, servicio y sucursal, fecha, hora y tiempos de atención, notas de atención, citas, respuestas de encuestas, datos de cobros (los datos completos de las tarjetas los procesa la pasarela de pago, no el Servicio) y datos de facturación.
- **Datos sensibles:** si el Responsable carga datos de salud u otros datos sensibles (por ejemplo, en las notas o en campos propios), declara que cuenta con la base legal necesaria y los limita a lo indispensable. El Servicio no es una historia clínica: se recomienda no cargar diagnósticos ni información clínica.
- **Operaciones:** registro, almacenamiento, consulta, llamado en las pantallas (el número del turno y, si el Responsable lo carga, el nombre), envío de avisos, reportes, exportación y supresión.

## 3. Obligaciones del Encargado

El Encargado se compromete a:

1. Tratar los datos solo según las instrucciones del Responsable y no usarlos para fines propios, salvo las estadísticas anónimas y agregadas previstas en los términos. Si una instrucción le parece contraria a la ley, lo informará al Responsable.
2. Garantizar que su personal con acceso esté obligado a la confidencialidad y acceda solo cuando sea necesario, por ejemplo para el soporte que pida el Responsable. Los accesos del soporte dentro de la organización quedan marcados en el registro de actividad que ve el Responsable.
3. Aplicar las medidas de seguridad del anexo de este acuerdo.
4. Notificar al Responsable, sin demora indebida y en lo posible dentro de las 72 horas de conocerlo, cualquier incidente de seguridad que afecte sus datos, con la información disponible y las medidas adoptadas.
5. Asistir al Responsable para responder los pedidos de las personas (acceso, rectificación, supresión). El Servicio permite al Responsable borrar los datos de una persona por su documento, teléfono o correo, y fijar un plazo de borrado automático.
6. Al terminar el servicio, permitir la exportación de los datos y suprimirlos según el punto 12.4 de los términos, salvo que una ley obligue a conservarlos.
7. Poner a disposición del Responsable la información necesaria para demostrar el cumplimiento de este acuerdo y permitir auditorías razonables, con aviso previo de 30 días, a cargo del Responsable y sin afectar la seguridad ni la confidencialidad de otros clientes.

## 4. Obligaciones del Responsable

1. Contar con una base legal para tratar los datos y cargarlos en el Servicio, e informar a las personas. El Servicio permite mostrar un aviso de privacidad propio en la reserva en línea, el kiosco, la fila virtual y las encuestas.
2. Cargar solo los datos necesarios y fijar plazos de conservación adecuados.
3. Administrar los accesos de sus usuarios y mantener seguras sus credenciales y claves de API.
4. Responder a las personas que ejerzan sus derechos.
5. Asegurarse de que los sistemas propios que conecte por API o webhooks protejan los datos que reciben.

## 5. Subencargados

El Responsable autoriza al Encargado a usar, con obligaciones de protección equivalentes a las de este acuerdo:

- un proveedor de servidores y almacenamiento en la nube, para alojar el Servicio y sus copias de seguridad;
- un proveedor de correo electrónico saliente.

Cuando el Responsable activa un módulo y conecta su propia cuenta con un tercero (WhatsApp Business u otro proveedor de mensajería, un servicio de SMS, su propio servidor de correo, las pasarelas de pago Bancard, PagoPar o Stripe, la DNIT/SET para la factura electrónica o su propio sistema mediante API o webhooks), es el Responsable quien contrata a ese tercero y decide enviarle los datos. El Encargado solo realiza la transmisión técnica.

El Encargado avisará con al menos 30 días de anticipación la incorporación o el reemplazo de un subencargado. El Responsable puede oponerse por motivos razonables y, si no se encuentra una solución, terminar el contrato sin penalidad. La lista actualizada de subencargados se puede pedir a {{correo}}.

## 6. Transferencias internacionales

Si los servidores o los subencargados están fuera del Paraguay, el Encargado elegirá proveedores que ofrezcan garantías adecuadas de seguridad y confidencialidad, e informará al Responsable, a su pedido, el país donde se alojan los datos.

## 7. Vigencia

Este acuerdo rige mientras el Encargado trate datos por cuenta del Responsable. Las obligaciones de confidencialidad continúan después de su terminación.

## Anexo: medidas de seguridad

- Conexiones cifradas con HTTPS (TLS).
- Contraseñas guardadas con hash bcrypt. Enlaces, códigos de acceso y claves de API guardados como hash.
- Contraseñas de correo, tokens de WhatsApp y SMS, claves de las pasarelas de pago, certificados de firma y CSC cifrados con AES-256-GCM.
- Separación de los datos de cada organización en todas las consultas. Roles (administrador, supervisor, operador) y permisos por sucursal y por servicio.
- Bloqueo por intentos de ingreso fallidos y límites de pedidos por minuto.
- Registro de actividad de cada cambio (quién, cuándo y desde qué IP), visible para el Responsable y conservado un año.
- Copias de seguridad diarias con acceso restringido, rotación y un procedimiento de restauración documentado.
- Borrado automático de los datos personales según el plazo que fija el Responsable y borrado a pedido de una persona.
- Exportación de datos personales reservada a los administradores.
- Actualizaciones de seguridad y revisión periódica de las dependencias.
