# Migración desde la versión anterior (NovoSGA 2)

La versión 3 es una reescritura completa y no comparte código con el sistema anterior (Symfony 4 / PHP 7.1). Esta guía sirve para pasar una instalación existente a la nueva versión.

## Equivalencias

| Antes (NovoSGA) | Ahora (Gestión de Colas) |
| --- | --- |
| Unidade | Sucursal (`branches`) |
| Serviço / Serviço da unidade | Servicio (`services`) habilitado por sucursal (`branch_services`, con prefijo propio) |
| Prioridade (peso) | Prioridad (`priorities.weight`) |
| Local / Número do local | Puesto de atención (`counters`) |
| Departamento | Departamento |
| Perfil / Lotação | Rol (administrador, supervisor, operador) + sucursales y servicios asignados |
| Atendimento / Senha | Turno (`tickets`) con historial de eventos (`ticket_events`) |
| Painel web / Painel web vídeo | Pantalla (`/pantalla/:token`) con 3 diseños y listas de reproducción |
| Triagem touch | Kiosco (`/kiosco/:token`) + fila virtual móvil |
| Módulo Atendimento | Consola de atención (`/app/atencion`) |
| Módulo Monitor | Monitor en vivo (`/app/monitor`) |
| Módulo Relatórios | Reportes (`/app/reportes`) |
| OAuth client/secret para paneles | Enlaces con token por pantalla/kiosco (se pueden regenerar) |
| Websocket server aparte | Integrado (Socket.IO en el mismo proceso) |
| Un video (URL o YouTube) por panel | Biblioteca de medios + listas con programación, múltiples plataformas y subida de archivos |

## Configuración de voz

Las etiquetas del texto de voz anterior siguen funcionando: `[ticket]`, `[priority]`, `[local]` y `[service]` equivalen a `{{code}}`, `{{priority}}`, `{{counter}}` y `{{service}}`.

## Sonidos

Los sonidos de alerta del panel anterior (créditos en `apps/web/public/sounds/CREDITOS.md`) están incluidos y se eligen en **Pantallas → Voz y sonido**.

## Datos históricos

Si necesita conservar el historial de atenciones, exporte las tablas `atendimentos`/`historico_atendimentos` del sistema anterior a CSV e impórtelas como turnos finalizados en `tickets` (mapeando unidad → sucursal, serviço → servicio, prioridade → prioridad). Recomendamos hacerlo con un script SQL puntual una vez creadas las sucursales y servicios en la nueva versión.
