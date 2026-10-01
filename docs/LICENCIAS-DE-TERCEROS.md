# Avisos de software de terceros — Gestión de Colas 3.0.0

Generado el 2026-10-01 a partir de `package-lock.json` y de los `package.json`/`LICENSE` instalados en `node_modules`.
Incluye el conjunto transitivo completo de dependencias de **producción** de los workspaces `apps/api`, `apps/web` y `packages/shared`
(se excluyen las `devDependencies`: vite, typescript, vitest, playwright, drizzle-kit, tsup, tsx, pino-pretty, @tailwindcss/vite, etc.).

- **API/servidor**: se instala en `node_modules` de la imagen Docker / instalación on-premise (`apps/api`).
- **bundle web**: se empaqueta (tree-shaking) en los `.js` de `apps/web/dist` que se envían al navegador.
- **solo tipos**: paquetes `@types/*` y similares arrastrados como dependencias declaradas; no contienen código ejecutable.

Los textos completos de cada licencia están en los ficheros `LICENSE` de cada paquete y en los enlaces SPDX indicados. 
Para cumplir MIT/ISC/BSD/Apache-2.0, este documento (o uno equivalente con los textos de licencia) debe acompañar a cada copia distribuida del producto.

## Resumen (286 paquetes únicos nombre@versión)

| Licencia | Paquetes | Texto |
| --- | ---: | --- |
| MIT | 204 | https://spdx.org/licenses/MIT.html |
| ISC | 37 | https://spdx.org/licenses/ISC.html |
| Apache-2.0 | 27 | https://www.apache.org/licenses/LICENSE-2.0 |
| BSD-3-Clause | 7 | https://spdx.org/licenses/BSD-3-Clause.html |
| BlueOak-1.0.0 | 6 | https://blueoakcouncil.org/license/1.0.0 |
| (MPL-2.0 OR Apache-2.0) | 1 | https://github.com/cure53/DOMPurify/blob/main/LICENSE |
| (BSD-3-Clause OR GPL-2.0) | 1 |  |
| MIT-0 | 1 | https://spdx.org/licenses/MIT-0.html |
| 0BSD | 1 | https://spdx.org/licenses/0BSD.html |
| MIT AND ISC | 1 | https://spdx.org/licenses/MIT.html + https://spdx.org/licenses/ISC.html |

Notas sobre licencias no estándar:
- **dompurify** `(MPL-2.0 OR Apache-2.0)`: licencia dual; Gestión de Colas la usa bajo **Apache-2.0**.
- **nodemailer** `MIT-0`: MIT sin obligación de atribución.
- **victory-vendor** `MIT AND ISC`: re-empaqueta módulos d3 (ISC, Mike Bostock) bajo MIT de Formidable.
- **BlueOak-1.0.0** (glob, minimatch, lru-cache, minipass, path-scurry, de Isaac Z. Schlueter): permisiva, equivalente a MIT.
- **es-toolkit** (MIT) incluye un fichero NOTICE: partes derivadas de Lodash — "Copyright OpenJS Foundation and other contributors <https://openjsf.org/>", licencia MIT.

## MIT (204)

| Paquete | Versión | Se distribuye en | Repositorio / web | Copyright |
| --- | --- | --- | --- | --- |
| @fastify/accept-negotiator | 2.1.0 | API/servidor | https://github.com/fastify/accept-negotiator | Copyright (c) 2022-present The Fastify team <https://github.com/fastify/fastify#team> |
| @fastify/ajv-compiler | 4.0.6 | API/servidor | https://github.com/fastify/ajv-compiler | Copyright (c) 2022-present The Fastify team <https://github.com/fastify/fastify#team> |
| @fastify/busboy | 3.2.2 | API/servidor | https://github.com/fastify/busboy | Copyright Brian White. All rights reserved. / Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team> |
| @fastify/cors | 11.3.0 | API/servidor | https://github.com/fastify/fastify-cors | Copyright (c) 2018-present The Fastify team <https://github.com/fastify/fastify#team> |
| @fastify/deepmerge | 3.2.1 | API/servidor | https://github.com/fastify/deepmerge | Copyright (c) 2022-present The Fastify team |
| @fastify/error | 4.2.0 | API/servidor | https://github.com/fastify/fastify-error | Copyright (c) 2020 Fastify |
| @fastify/fast-json-stringify-compiler | 5.1.0 | API/servidor | https://github.com/fastify/fast-json-stringify-compiler | Copyright (c) 2022-present The Fastify team <https://github.com/fastify/fastify#team> |
| @fastify/forwarded | 3.0.2 | API/servidor | https://github.com/fastify/forwarded | Copyright (c) 2014-2017 Douglas Christopher Wilson / Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team> |
| @fastify/helmet | 13.1.1 | API/servidor | https://github.com/fastify/fastify-helmet | Copyright (c) 2017-present The Fastify team <https://github.com/fastify/fastify#team> / Copyright (c) 2012-2017 Evan Hahn, Adam Baldwin |
| @fastify/merge-json-schemas | 0.2.1 | API/servidor | https://github.com/fastify/merge-json-schemas | Copyright (c) 2024 Fastify |
| @fastify/multipart | 10.1.2 | API/servidor | https://github.com/fastify/fastify-multipart | Copyright (c) 2017-present The Fastify team <https://github.com/fastify/fastify#team> |
| @fastify/proxy-addr | 5.1.1 | API/servidor | https://github.com/fastify/proxy-addr | Copyright (c) 2014-2016 Douglas Christopher Wilson / Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team> |
| @fastify/rate-limit | 11.2.0 | API/servidor | https://github.com/fastify/fastify-rate-limit | Copyright (c) 2018-present The Fastify team <https://github.com/fastify/fastify#team> |
| @fastify/send | 4.1.1 | API/servidor | https://github.com/fastify/send | Copyright (c) 2012 TJ Holowaychuk / Copyright (c) 2014-2022 Douglas Christopher Wilson |
| @fastify/static | 10.1.5 | API/servidor | https://github.com/fastify/fastify-static | Copyright (c) 2017-present The Fastify team <https://github.com/fastify/fastify#team> |
| @fastify/swagger | 9.9.0 | API/servidor | https://github.com/fastify/fastify-swagger | Copyright (c) 2017-present The Fastify team <https://github.com/fastify/fastify#team> |
| @fastify/swagger-ui | 6.1.1 | API/servidor | https://github.com/fastify/fastify-swagger-ui | Copyright (c) 2022-present The Fastify team <https://github.com/fastify/fastify#team> |
| @lukeed/ms | 2.0.2 | API/servidor | https://github.com/lukeed/ms | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |
| @pinojs/redact | 0.4.0 | API/servidor | https://github.com/pinojs/redact | Copyright (c) 2025 pinojs contributors |
| @reduxjs/toolkit | 2.13.0 | bundle web | https://github.com/reduxjs/redux-toolkit | Copyright (c) 2018 Mark Erikson |
| @remix-run/route-pattern | 0.22.1 | bundle web | https://github.com/remix-run/remix | Copyright (c) 2025 Shopify Inc. |
| @socket.io/component-emitter | 3.1.2 | API/servidor, bundle web | https://github.com/socketio/emitter | Copyright (c) 2014 Component contributors <dev@component.io> |
| @standard-schema/spec | 1.1.0 | bundle web | https://github.com/standard-schema/standard-schema | Copyright (c) 2024 Colin McDonnell |
| @standard-schema/utils | 0.3.0 | bundle web | https://github.com/standard-schema/standard-schema | Copyright (c) 2024 Fabian Hiller |
| @tanstack/query-core | 5.104.0 | bundle web | https://github.com/TanStack/query | Copyright (c) 2021-present Tanner Linsley |
| @tanstack/react-query | 5.104.0 | bundle web | https://github.com/TanStack/query | Copyright (c) 2021-present Tanner Linsley |
| @types/cors | 2.8.19 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/d3-array | 3.2.2 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/d3-color | 3.1.3 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/d3-ease | 3.0.2 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/d3-interpolate | 3.0.4 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/d3-path | 3.1.1 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/d3-scale | 4.0.9 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/d3-shape | 3.2.0 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/d3-time | 3.0.4 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/d3-timer | 3.0.2 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/node | 22.20.4 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.23.1 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/react | 19.3.0 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/trusted-types | 2.0.7 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/use-sync-external-store | 0.0.6 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @types/ws | 8.18.2 | solo tipos (no se ejecuta) | https://github.com/DefinitelyTyped/DefinitelyTyped | Copyright (c) Microsoft Corporation. |
| @xmldom/is-dom-node | 1.0.1 | API/servidor | https://github.com/xmldom/is-dom-node | Copyright (c) 2023 Chris Barth |
| @xmldom/xmldom | 0.8.15 | API/servidor | https://github.com/xmldom/xmldom | Copyright 2019 - present Christopher J. Brody and other contributors, as listed in: https://github.com/xmldom/xmldom/graphs/contributors / Copyright 2012 - 2017 @jindw <jindw@xidea.org> and other contributors, as listed in: https://github.com/jindw/xmldom/graphs/contributors |
| @xmldom/xmldom | 0.9.12 | API/servidor | https://github.com/xmldom/xmldom | Copyright 2019 - present Christopher J. Brody and other contributors, as listed in: https://github.com/xmldom/xmldom/graphs/contributors / Copyright 2012 - 2017 @jindw <jindw@xidea.org> and other contributors, as listed in: https://github.com/jindw/xmldom/graphs/contributors |
| abstract-logging | 2.0.1 | API/servidor | https://github.com/jsumners/abstract-logging | (autor según package.json: James Sumners) |
| accepts | 1.3.8 | API/servidor | https://github.com/jshttp/accepts | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| ajv | 8.20.0 | API/servidor | https://github.com/ajv-validator/ajv | Copyright (c) 2015-2021 Evgeny Poberezkin |
| ajv-formats | 3.0.1 | API/servidor | https://github.com/ajv-validator/ajv-formats | Copyright (c) 2020 Evgeny Poberezkin |
| ansi-regex | 5.0.1 | API/servidor, bundle web | https://github.com/chalk/ansi-regex | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| ansi-styles | 4.3.0 | API/servidor, bundle web | https://github.com/chalk/ansi-styles | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| atomic-sleep | 1.0.0 | API/servidor | https://github.com/davidmarkclements/atomic-sleep | Copyright (c) 2020 David Mark Clements |
| avvio | 9.3.0 | API/servidor | https://github.com/fastify/avvio | Copyright (c) 2016-2020 Matteo Collina / Copyright (c) 2020-present The Fastify team <https://github.com/fastify/fastify#team> |
| balanced-match | 1.0.2 | API/servidor | https://github.com/juliangruber/balanced-match | Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; |
| balanced-match | 4.0.4 | API/servidor | https://github.com/juliangruber/balanced-match | Original code Copyright Julian Gruber <julian@juliangruber.com> / Port to TypeScript Copyright Isaac Z. Schlueter <i@izs.me> |
| base64-js | 1.5.1 | API/servidor | https://github.com/beatgammit/base64-js | Copyright (c) 2014 Jameson Little |
| bowser | 2.14.1 | API/servidor | https://github.com/bowser-js/bowser | Copyright 2015, Dustin Diaz (the "Original Author") |
| brace-expansion | 1.1.21 | API/servidor | https://github.com/juliangruber/brace-expansion | Copyright (c) 2013 Julian Gruber <julian@juliangruber.com> |
| brace-expansion | 5.0.12 | API/servidor | https://github.com/juliangruber/brace-expansion | Copyright Julian Gruber <julian@juliangruber.com> / TypeScript port Copyright Isaac Z. Schlueter <i@izs.me> |
| buffer | 5.6.0 | API/servidor | https://github.com/feross/buffer | Copyright (c) Feross Aboukhadijeh, and other contributors. |
| camelcase | 5.3.1 | bundle web | https://github.com/sindresorhus/camelcase | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| clsx | 2.1.1 | bundle web | https://github.com/lukeed/clsx | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |
| color-convert | 2.0.1 | API/servidor, bundle web | https://github.com/Qix-/color-convert | Copyright (c) 2011-2016 Heather Arthur <fayearthur@gmail.com> |
| color-name | 1.1.4 | API/servidor, bundle web | https://github.com/colorjs/color-name | Copyright (c) 2015 Dmitry Ivanov |
| concat-map | 0.0.1 | API/servidor | https://github.com/substack/node-concat-map | (autor según package.json: James Halliday) |
| content-disposition | 3.0.0 | API/servidor | https://github.com/jshttp/content-disposition | Copyright (c) 2014-2017 Douglas Christopher Wilson |
| cookie | 0.7.2 | API/servidor | https://github.com/jshttp/cookie | Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com> / Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| cookie | 1.1.1 | API/servidor | https://github.com/jshttp/cookie | Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com> / Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| cookie-es | 3.1.1 | bundle web | https://github.com/unjs/cookie-es | Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com> / Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| copyfiles | 2.4.1 | API/servidor | https://github.com/calvinmetcalf/copyfiles | Copyright (c) 2014-2018 Calvin Metcalf |
| core-util-is | 1.0.3 | API/servidor | https://github.com/isaacs/core-util-is | Copyright Node.js contributors. All rights reserved. |
| cors | 2.8.6 | API/servidor | https://github.com/expressjs/cors | Copyright (c) 2013 Troy Goode <troygoode@gmail.com> |
| csstype | 3.2.3 | solo tipos (no se ejecuta) | https://github.com/frenic/csstype | Copyright (c) 2017-2018 Fredrik Nicol |
| debug | 4.4.3 | API/servidor, bundle web | https://github.com/debug-js/debug | Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> / Copyright (c) 2018-2021 Josh Junon |
| decamelize | 1.2.0 | bundle web | https://github.com/sindresorhus/decamelize | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| decimal.js-light | 2.5.1 | bundle web | https://github.com/MikeMcl/decimal.js-light | Copyright (c) 2020 Michael Mclaughlin |
| depd | 2.0.0 | API/servidor | https://github.com/dougwilson/nodejs-depd | Copyright (c) 2014-2018 Douglas Christopher Wilson |
| dequal | 2.0.3 | API/servidor | https://github.com/lukeed/dequal | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |
| dijkstrajs | 1.0.3 | bundle web | https://github.com/tcort/dijkstrajs | Copyright (C) 2008 |
| emoji-regex | 8.0.0 | API/servidor, bundle web | https://github.com/mathiasbynens/emoji-regex | Copyright Mathias Bynens <https://mathiasbynens.be/> |
| engine.io | 6.6.11 | API/servidor | https://github.com/socketio/socket.io | Copyright (c) 2014-present Guillermo Rauch and Socket.IO contributors |
| engine.io-client | 6.6.7 | bundle web | https://github.com/socketio/socket.io | Copyright (c) 2014-present Guillermo Rauch and Socket.IO contributors |
| engine.io-parser | 5.2.3 | API/servidor, bundle web | https://github.com/socketio/socket.io | Copyright (c) 2014-present Guillermo Rauch and Socket.IO contributors |
| es-toolkit | 1.52.0 | bundle web | https://github.com/toss/es-toolkit | Copyright (c) 2024 Viva Republica, Inc. |
| escalade | 3.2.0 | API/servidor | https://github.com/lukeed/escalade | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |
| escape-html | 1.0.3 | API/servidor | https://github.com/component/escape-html | Copyright (c) 2012-2013 TJ Holowaychuk / Copyright (c) 2015 Andreas Lubbe |
| eventemitter3 | 5.0.4 | bundle web | https://github.com/primus/eventemitter3 | Copyright (c) 2014 Arnout Kazemier |
| events | 3.3.0 | API/servidor | https://github.com/Gozala/events | Copyright Joyent, Inc. and other Node contributors. |
| facturacionelectronicapy-xmlgen | 1.0.283 | API/servidor | https://github.com/marcosjara/facturacionelectronicapy-xmlgen | Copyright (c) 2020 Marcos Silva |
| fast-decode-uri-component | 1.0.1 | API/servidor | https://github.com/delvedor/fast-decode-uri-component | Copyright (c) 2018 Tomas Della Vedova / Copyright (c) 2017 Justin Ridgewell |
| fast-deep-equal | 3.1.3 | API/servidor | https://github.com/epoberezkin/fast-deep-equal | Copyright (c) 2017 Evgeny Poberezkin |
| fast-json-stringify | 7.0.1 | API/servidor | https://github.com/fastify/fast-json-stringify | Copyright (c) 2016-present Matteo Collina / Copyright (c) 2016-present The Fastify team <https://github.com/fastify/fastify#team> |
| fast-querystring | 1.1.2 | API/servidor | https://github.com/anonrig/fast-querystring | Copyright (c) 2022 Yagiz Nizipli |
| fastify | 5.12.5 | API/servidor | https://github.com/fastify/fastify | Copyright (c) 2016-present The Fastify team <https://github.com/fastify/fastify#team> |
| fastify-plugin | 6.0.0 | API/servidor | https://github.com/fastify/fastify-plugin | Copyright (c) 2017-present The Fastify team <https://github.com/fastify/fastify#team> |
| fastify-type-provider-zod | 7.0.0 | API/servidor | https://github.com/turkerdev/fastify-type-provider-zod | Copyright (c) 2022-2024 turkerdev |
| find-my-way | 9.9.0 | API/servidor | https://github.com/delvedor/find-my-way | Copyright (c) 2017-2019 Tomas Della Vedova |
| find-up | 4.1.0 | bundle web | https://github.com/sindresorhus/find-up | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| helmet | 8.3.0 | API/servidor | https://github.com/helmetjs/helmet | Copyright (c) 2012-2026 Evan Hahn, Adam Baldwin |
| http-errors | 2.0.1 | API/servidor | https://github.com/jshttp/http-errors | Copyright (c) 2014 Jonathan Ong me@jongleberry.com / Copyright (c) 2016 Douglas Christopher Wilson doug@somethingdoug.com |
| immer | 11.1.18 | bundle web | https://github.com/immerjs/immer | Copyright (c) 2017 Michel Weststrate |
| ip-address | 10.7.2 | API/servidor | https://github.com/beaugunderson/ip-address | Copyright (C) 2011 by Beau Gunderson |
| ipaddr.js | 2.5.0 | API/servidor | https://github.com/whitequark/ipaddr.js | Copyright (C) 2011-2017 whitequark <whitequark@whitequark.org> |
| is-fullwidth-code-point | 3.0.0 | API/servidor, bundle web | https://github.com/sindresorhus/is-fullwidth-code-point | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| isarray | 0.0.1 | API/servidor | https://github.com/juliangruber/isarray | (autor según package.json: Julian Gruber) |
| isarray | 1.0.0 | API/servidor | https://github.com/juliangruber/isarray | (autor según package.json: Julian Gruber) |
| jose | 6.2.12 | API/servidor | https://github.com/panva/jose | Copyright (c) 2018 Filip Skokan |
| json-schema-ref-resolver | 3.0.0 | API/servidor | https://github.com/fastify/json-schema-ref-resolver | Copyright (c) 2023 Fastify |
| json-schema-resolver | 3.0.0 | API/servidor | https://github.com/Eomm/json-schema-resolver | Copyright (c) 2020 Manuel Spigolon |
| json-schema-traverse | 1.0.0 | API/servidor | https://github.com/epoberezkin/json-schema-traverse | Copyright (c) 2017 Evgeny Poberezkin |
| locate-path | 5.0.0 | bundle web | https://github.com/sindresorhus/locate-path | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| mime | 3.0.0 | API/servidor | https://github.com/broofa/mime | Copyright (c) 2010 Benjamin Thomas, Robert Kieffer |
| mime-db | 1.52.0 | API/servidor | https://github.com/jshttp/mime-db | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2015-2022 Douglas Christopher Wilson <doug@somethingdoug.com> |
| mime-types | 2.1.35 | API/servidor | https://github.com/jshttp/mime-types | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| mkdirp | 1.0.4 | API/servidor | https://github.com/isaacs/node-mkdirp | Copyright James Halliday (mail@substack.net) and Isaac Z. Schlueter (i@izs.me) |
| ms | 2.1.3 | API/servidor, bundle web | https://github.com/vercel/ms | Copyright (c) 2020 Vercel, Inc. |
| negotiator | 0.6.3 | API/servidor | https://github.com/jshttp/negotiator | Copyright (c) 2012-2014 Federico Romero / Copyright (c) 2012-2014 Isaac Z. Schlueter |
| object-assign | 4.1.1 | API/servidor | https://github.com/sindresorhus/object-assign | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| on-exit-leak-free | 2.1.2 | API/servidor | https://github.com/mcollina/on-exit-or-gc | Copyright (c) 2021 Matteo Collina |
| openapi-types | 12.1.3 | API/servidor | https://github.com/kogosoftwarellc/open-api/tree/master/packages/openapi-types | Copyright (c) 2018 Kogo Softare LLC |
| p-limit | 2.3.0 | bundle web | https://github.com/sindresorhus/p-limit | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| p-locate | 4.1.0 | bundle web | https://github.com/sindresorhus/p-locate | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| p-try | 2.2.0 | bundle web | https://github.com/sindresorhus/p-try | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| path-exists | 4.0.0 | bundle web | https://github.com/sindresorhus/path-exists | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| path-is-absolute | 1.0.1 | API/servidor | https://github.com/sindresorhus/path-is-absolute | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| pg | 8.23.0 | API/servidor | https://github.com/brianc/node-postgres | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.0 | API/servidor (opcional, no usado en Node) | https://github.com/brianc/node-postgres | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.0 | API/servidor | https://github.com/brianc/node-postgres | Copyright (c) 2014 Iced Development |
| pg-pool | 3.14.0 | API/servidor | https://github.com/brianc/node-postgres | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.0 | API/servidor | https://github.com/brianc/node-postgres | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | API/servidor | https://github.com/brianc/node-pg-types | (autor según package.json: Brian M. Carlson) |
| pgpass | 1.0.5 | API/servidor | https://github.com/hoegaarden/pgpass | (autor según package.json: Hannes Hörl) |
| pino | 10.3.1 | API/servidor | https://github.com/pinojs/pino | Copyright (c) 2016-2025 Matteo Collina, David Mark Clements and the Pino contributors listed at <https://github.com/pinojs/pino#the-team> and in the README file. |
| pino-abstract-transport | 3.0.0 | API/servidor | https://github.com/pinojs/pino-abstract-transport | Copyright (c) 2021 pino |
| pino-std-serializers | 7.1.0 | API/servidor | https://github.com/pinojs/pino-std-serializers | Copyright Mateo Collina, David Mark Clements, James Sumners |
| pngjs | 5.0.0 | bundle web | https://github.com/lukeapage/pngjs | pngjs2 original work Copyright (c) 2015 Luke Page & Original Contributors / pngjs derived work Copyright (c) 2012 Kuba Niegowski |
| postgres-array | 2.0.0 | API/servidor | https://github.com/bendrucker/postgres-array | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | API/servidor | https://github.com/bendrucker/postgres-bytea | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | API/servidor | https://github.com/bendrucker/postgres-date | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | API/servidor | https://github.com/bendrucker/postgres-interval | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| process-nextick-args | 2.0.1 | API/servidor | https://github.com/calvinmetcalf/process-nextick-args | Copyright (c) 2015 Calvin Metcalf |
| process-warning | 4.0.1 | API/servidor | https://github.com/fastify/process-warning | Copyright (c) Fastify |
| process-warning | 5.1.0 | API/servidor | https://github.com/fastify/process-warning | Copyright (c) 2020-present The Fastify team <https://github.com/fastify/fastify#team> |
| qrcode | 1.5.4 | bundle web | https://github.com/soldair/node-qrcode | Copyright (c) 2012 Ryan Day |
| quick-format-unescaped | 4.0.4 | API/servidor | https://github.com/davidmarkclements/quick-format | Copyright (c) 2016-2019 David Mark Clements |
| react | 19.3.0 | bundle web | https://github.com/react/react | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom | 19.3.0 | bundle web | https://github.com/react/react | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-is | 19.3.0 | bundle web | https://github.com/react/react | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-redux | 9.3.0 | bundle web | https://github.com/reduxjs/react-redux | Copyright (c) 2015-present Dan Abramov |
| react-router | 8.4.0 | bundle web | https://github.com/remix-run/react-router | Copyright (c) React Training LLC 2015-2019 / Copyright (c) Remix Software Inc. 2020-2021 |
| readable-stream | 1.0.34 | API/servidor | https://github.com/isaacs/readable-stream | Copyright Joyent, Inc. and other Node contributors. All rights reserved. |
| readable-stream | 2.3.8 | API/servidor | https://github.com/nodejs/readable-stream | Copyright Node.js contributors. All rights reserved. / Copyright Joyent, Inc. and other Node contributors. All rights reserved. |
| readable-stream | 3.6.2 | API/servidor | https://github.com/nodejs/readable-stream | Copyright Node.js contributors. All rights reserved. / Copyright Joyent, Inc. and other Node contributors. All rights reserved. |
| real-require | 0.2.0 | API/servidor | https://github.com/pinojs/real-require | Copyright (c) 2021 Paolo Insogna and the real-require contributors |
| real-require | 1.0.0 | API/servidor | https://github.com/pinojs/real-require | Copyright (c) 2021 Paolo Insogna and the real-require contributors |
| recharts | 3.10.1 | bundle web | https://github.com/recharts/recharts | Copyright (c) 2015-present recharts |
| redux | 5.0.1 | bundle web | https://github.com/reduxjs/redux | Copyright (c) 2015-present Dan Abramov |
| redux-thunk | 3.1.0 | bundle web | https://github.com/reduxjs/redux-thunk | Copyright (c) 2015-present Dan Abramov |
| require-directory | 2.1.1 | API/servidor, bundle web | https://github.com/troygoode/node-require-directory | Copyright (c) 2011 Troy Goode <troygoode@gmail.com> |
| require-from-string | 2.0.2 | API/servidor | https://github.com/floatdrop/require-from-string | Copyright (c) Vsevolod Strukchinsky <floatdrop@gmail.com> (github.com/floatdrop) |
| reselect | 5.2.0 | bundle web | https://github.com/reduxjs/reselect | Copyright (c) 2015-2018 Reselect Contributors |
| ret | 0.5.0 | API/servidor | https://github.com/fent/ret.js | Copyright (C) 2011 by fent |
| reusify | 1.1.0 | API/servidor | https://github.com/mcollina/reusify | Copyright (c) 2015-2024 Matteo Collina |
| rfdc | 1.4.1 | API/servidor | https://github.com/davidmarkclements/rfdc | Copyright 2019 "David Mark Clements <david.mark.clements@gmail.com>" |
| safe-buffer | 5.1.2 | API/servidor | https://github.com/feross/safe-buffer | Copyright (c) Feross Aboukhadijeh |
| safe-buffer | 5.2.1 | API/servidor | https://github.com/feross/safe-buffer | Copyright (c) Feross Aboukhadijeh |
| safe-regex2 | 5.1.1 | API/servidor | https://github.com/fastify/safe-regex2 | Copyright (c) 2019-present The Fastify team <https://github.com/fastify/fastify#team> |
| safe-stable-stringify | 2.5.0 | API/servidor | https://github.com/BridgeAR/safe-stable-stringify | Copyright (c) Ruben Bridgewater |
| scheduler | 0.28.0 | bundle web | https://github.com/react/react | Copyright (c) Meta Platforms, Inc. and affiliates. |
| set-cookie-parser | 2.7.2 | API/servidor | https://github.com/nfriedly/set-cookie-parser | Copyright (c) 2015 Nathan Friedly <nathan@nfriedly.com> (http://nfriedly.com/) |
| socket.io | 4.8.4 | API/servidor | https://github.com/socketio/socket.io | Copyright (c) 2014-present Guillermo Rauch and Socket.IO contributors |
| socket.io-adapter | 2.5.8 | API/servidor | https://github.com/socketio/socket.io | Copyright (c) 2014-present Guillermo Rauch and Socket.IO contributors |
| socket.io-client | 4.8.4 | bundle web | https://github.com/socketio/socket.io | Copyright (c) 2014-present Guillermo Rauch and Socket.IO contributors |
| socket.io-parser | 4.2.7 | API/servidor, bundle web | https://github.com/socketio/socket.io | Copyright (c) 2014-present Guillermo Rauch and Socket.IO contributors |
| sonic-boom | 4.2.1 | API/servidor | https://github.com/pinojs/sonic-boom | Copyright (c) 2017 Matteo Collina |
| statuses | 2.0.2 | API/servidor | https://github.com/jshttp/statuses | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2016 Douglas Christopher Wilson <doug@somethingdoug.com> |
| stream-browserify | 3.0.0 | API/servidor | https://github.com/browserify/stream-browserify | Copyright (c) James Halliday |
| string_decoder | 0.10.31 | API/servidor | https://github.com/rvagg/string_decoder | Copyright Joyent, Inc. and other Node contributors. |
| string_decoder | 1.1.1 | API/servidor | https://github.com/nodejs/string_decoder | Copyright Node.js contributors. All rights reserved. / Copyright Joyent, Inc. and other Node contributors. All rights reserved. |
| string_decoder | 1.3.0 | API/servidor | https://github.com/nodejs/string_decoder | Copyright Node.js contributors. All rights reserved. / Copyright Joyent, Inc. and other Node contributors. All rights reserved. |
| string-width | 4.2.3 | API/servidor, bundle web | https://github.com/sindresorhus/string-width | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| strip-ansi | 6.0.1 | API/servidor, bundle web | https://github.com/chalk/strip-ansi | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| thread-stream | 4.2.0 | API/servidor | https://github.com/mcollina/thread-stream | Copyright (c) 2021 Matteo Collina |
| through2 | 2.0.5 | API/servidor | https://github.com/rvagg/through2 | Copyright (c) Rod Vagg (the "Original Author") and additional contributors** |
| tiny-invariant | 1.3.3 | bundle web | https://github.com/alexreardon/tiny-invariant | Copyright (c) 2019 Alexander Reardon |
| toad-cache | 3.7.4 | API/servidor | https://github.com/kibertoad/toad-cache | Copyright (c) 2023 Igor Savin |
| toidentifier | 1.0.1 | API/servidor | https://github.com/component/toidentifier | Copyright (c) 2016 Douglas Christopher Wilson <doug@somethingdoug.com> |
| undici-types | 6.21.0 | API/servidor | https://github.com/nodejs/undici | Copyright (c) Matteo Collina and Undici contributors |
| untildify | 4.0.0 | API/servidor | https://github.com/sindresorhus/untildify | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| use-sync-external-store | 1.7.0 | bundle web | https://github.com/react/react | Copyright (c) Meta Platforms, Inc. and affiliates. |
| util-deprecate | 1.0.2 | API/servidor | https://github.com/TooTallNate/util-deprecate | Copyright (c) 2014 Nathan Rajlich <nathan@tootallnate.net> |
| vary | 1.1.2 | API/servidor | https://github.com/jshttp/vary | Copyright (c) 2014-2017 Douglas Christopher Wilson |
| wrap-ansi | 6.2.0 | bundle web | https://github.com/chalk/wrap-ansi | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| wrap-ansi | 7.0.0 | API/servidor | https://github.com/chalk/wrap-ansi | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| ws | 8.21.3 | API/servidor, bundle web | https://github.com/websockets/ws | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> / Copyright (c) 2013 Arnout Kazemier and contributors |
| xml-crypto | 6.3.2 | API/servidor | https://github.com/node-saml/xml-crypto | Copyright (c) Yaron Naveh <yaronn01@gmail.com> |
| xml2js | 0.6.2 | API/servidor | https://github.com/Leonidas-from-XIV/node-xml2js | Copyright 2010, 2011, 2012, 2013. All rights reserved. |
| xmlbuilder | 11.0.1 | API/servidor | https://github.com/oozcitak/xmlbuilder-js | Copyright (c) 2013 Ozgur Ozcitak |
| xmlhttprequest-ssl | 2.1.2 | bundle web | https://github.com/mjwwit/node-XMLHttpRequest | Copyright (c) 2010 passive.ly LLC |
| xpath | 0.0.33 | API/servidor | https://github.com/goto100/xpath | Copyright (c) 2018 Cameron McCormack |
| xtend | 4.0.2 | API/servidor | https://github.com/Raynos/xtend | Copyright (c) 2012-2014 Raynos. |
| yargs | 15.4.1 | bundle web | https://github.com/yargs/yargs | Copyright 2010 James Halliday (mail@substack.net); Modified work Copyright 2014 Contributors (ben@npmjs.com) |
| yargs | 16.2.2 | API/servidor | https://github.com/yargs/yargs | Copyright 2010 James Halliday (mail@substack.net); Modified work Copyright 2014 Contributors (ben@npmjs.com) |
| zod | 4.6.5 | API/servidor, bundle web | https://github.com/colinhacks/zod | Copyright (c) 2025 Colin McDonnell |

## ISC (37)

| Paquete | Versión | Se distribuye en | Repositorio / web | Copyright |
| --- | --- | --- | --- | --- |
| cliui | 6.0.0 | bundle web | https://github.com/yargs/cliui | Copyright (c) 2015, Contributors |
| cliui | 7.0.4 | API/servidor | https://github.com/yargs/cliui | Copyright (c) 2015, Contributors |
| d3-array | 3.2.4 | bundle web | https://github.com/d3/d3-array | Copyright 2010-2023 Mike Bostock |
| d3-color | 3.1.0 | bundle web | https://github.com/d3/d3-color | Copyright 2010-2022 Mike Bostock |
| d3-format | 3.1.2 | bundle web | https://github.com/d3/d3-format | Copyright 2010-2026 Mike Bostock |
| d3-interpolate | 3.0.1 | bundle web | https://github.com/d3/d3-interpolate | Copyright 2010-2021 Mike Bostock |
| d3-path | 3.1.0 | bundle web | https://github.com/d3/d3-path | Copyright 2015-2022 Mike Bostock |
| d3-scale | 4.0.2 | bundle web | https://github.com/d3/d3-scale | Copyright 2010-2021 Mike Bostock |
| d3-shape | 3.2.0 | bundle web | https://github.com/d3/d3-shape | Copyright 2010-2022 Mike Bostock |
| d3-time | 3.1.0 | bundle web | https://github.com/d3/d3-time | Copyright 2010-2022 Mike Bostock |
| d3-time-format | 4.1.0 | bundle web | https://github.com/d3/d3-time-format | Copyright 2010-2021 Mike Bostock |
| d3-timer | 3.0.1 | bundle web | https://github.com/d3/d3-timer | Copyright 2010-2021 Mike Bostock |
| fastq | 1.20.3 | API/servidor | https://github.com/mcollina/fastq | Copyright (c) 2015-2020, Matteo Collina <matteo.collina@gmail.com> |
| fs | 0.0.1-security | API/servidor | https://github.com/npm/security-holder |  |
| fs.realpath | 1.0.0 | API/servidor | https://github.com/isaacs/fs.realpath | Copyright (c) Isaac Z. Schlueter and Contributors / Copyright Joyent, Inc. and other Node contributors. |
| get-caller-file | 2.0.5 | API/servidor, bundle web | https://github.com/stefanpenner/get-caller-file | Copyright 2018 Stefan Penner |
| glob | 7.2.3 | API/servidor | https://github.com/isaacs/node-glob | Copyright (c) Isaac Z. Schlueter and Contributors |
| inflight | 1.0.6 | API/servidor | https://github.com/npm/inflight | Copyright (c) Isaac Z. Schlueter |
| inherits | 2.0.4 | API/servidor | https://github.com/isaacs/inherits | Copyright (c) Isaac Z. Schlueter |
| internmap | 2.0.3 | bundle web | https://github.com/mbostock/internmap | Copyright 2021 Mike Bostock |
| lucide-react | 1.48.0 | bundle web | https://github.com/lucide-icons/lucide | Copyright (c) 2026 Lucide Icons and Contributors / Copyright (c) 2013-present Cole Bemis |
| minimatch | 3.1.5 | API/servidor | https://github.com/isaacs/minimatch | Copyright (c) Isaac Z. Schlueter and Contributors |
| noms | 0.0.0 | API/servidor | https://github.com/calvinmetcalf/noms | (autor según package.json: Calvin Metcalf) |
| once | 1.4.0 | API/servidor | https://github.com/isaacs/once | Copyright (c) Isaac Z. Schlueter and Contributors |
| pg-int8 | 1.0.1 | API/servidor | https://github.com/charmander/pg-int8 | Copyright © 2017, Charmander <~@charmander.me> |
| require-main-filename | 2.0.0 | bundle web | https://github.com/yargs/require-main-filename | Copyright (c) 2016, Contributors |
| semver | 7.8.5 | API/servidor | https://github.com/npm/node-semver | Copyright (c) Isaac Z. Schlueter and Contributors |
| set-blocking | 2.0.0 | bundle web | https://github.com/yargs/set-blocking | Copyright (c) 2016, Contributors |
| setprototypeof | 1.2.0 | API/servidor | https://github.com/wesleytodd/setprototypeof | Copyright (c) 2015, Wes Todd |
| split2 | 4.2.0 | API/servidor | https://github.com/mcollina/split2 | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| which-module | 2.0.1 | bundle web | https://github.com/nexdrew/which-module | Copyright (c) 2016, Contributors |
| wrappy | 1.0.2 | API/servidor | https://github.com/npm/wrappy | Copyright (c) Isaac Z. Schlueter and Contributors |
| y18n | 4.0.3 | bundle web | https://github.com/yargs/y18n | Copyright (c) 2015, Contributors |
| y18n | 5.0.8 | API/servidor | https://github.com/yargs/y18n | Copyright (c) 2015, Contributors |
| yaml | 2.9.1 | API/servidor | https://github.com/eemeli/yaml | Copyright Eemeli Aro <eemeli@gmail.com> |
| yargs-parser | 18.1.3 | bundle web | https://github.com/yargs/yargs-parser | Copyright (c) 2016, Contributors |
| yargs-parser | 20.2.9 | API/servidor | https://github.com/yargs/yargs-parser | Copyright (c) 2016, Contributors |

## Apache-2.0 (27)

| Paquete | Versión | Se distribuye en | Repositorio / web | Copyright |
| --- | --- | --- | --- | --- |
| @aws-sdk/checksums | 3.1001.1 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/client-s3 | 3.1143.0 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/core | 3.978.1 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-env | 3.972.72 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-http | 3.972.74 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | (autor según package.json: AWS SDK for JavaScript Team) |
| @aws-sdk/credential-provider-ini | 3.973.17 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-login | 3.972.79 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | (autor según package.json: AWS SDK for JavaScript Team) |
| @aws-sdk/credential-provider-node | 3.972.84 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-process | 3.972.72 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-sso | 3.973.16 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-web-identity | 3.972.78 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/lib-storage | 3.1143.0 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-sdk-s3 | 3.972.77 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/nested-clients | 3.997.46 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | (autor según package.json: AWS SDK for JavaScript Team) |
| @aws-sdk/signature-v4-multi-region | 3.996.47 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/token-providers | 3.1138.0 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/types | 3.974.6 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/xml-builder | 3.972.41 | API/servidor | https://github.com/aws/aws-sdk-js-v3 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws/lambda-invoke-store | 0.3.0 | API/servidor | https://github.com/awslabs/aws-lambda-invoke-store | (autor según package.json: Amazon Web Services) |
| @smithy/core | 3.35.0 | API/servidor | https://github.com/smithy-lang/smithy-typescript | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/credential-provider-imds | 4.5.2 | API/servidor | https://github.com/smithy-lang/smithy-typescript | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/fetch-http-handler | 5.8.0 | API/servidor | https://github.com/smithy-lang/smithy-typescript | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/node-http-handler | 4.12.1 | API/servidor | https://github.com/smithy-lang/smithy-typescript | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/signature-v4 | 5.7.4 | API/servidor | https://github.com/smithy-lang/smithy-typescript | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/types | 4.19.0 | API/servidor | https://github.com/smithy-lang/smithy-typescript | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| drizzle-orm | 0.45.3 | API/servidor | https://github.com/drizzle-team/drizzle-orm | (autor según package.json: Drizzle Team) |
| hls.js | 1.7.3 | bundle web | https://github.com/video-dev/hls.js | Copyright (c) 2017 Dailymotion (http://www.dailymotion.com) / Copyright (c) 2013-2015 Brightcove |

## BSD-3-Clause (7)

| Paquete | Versión | Se distribuye en | Repositorio / web | Copyright |
| --- | --- | --- | --- | --- |
| bcryptjs | 3.0.3 | API/servidor | https://github.com/dcodeIO/bcrypt.js | Copyright (c) 2012 Nevins Bartolomeo <nevins.bartolomeo@gmail.com> / Copyright (c) 2012 Shane Girish <shaneGirish@gmail.com> |
| d3-ease | 3.0.1 | bundle web | https://github.com/d3/d3-ease | Copyright 2010-2021 Mike Bostock / Copyright 2001 Robert Penner |
| fast-uri | 3.1.8 | API/servidor | https://github.com/fastify/fast-uri | Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae / Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team> |
| fast-uri | 4.2.1 | API/servidor | https://github.com/fastify/fast-uri | Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae / Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team> |
| ieee754 | 1.2.1 | API/servidor | https://github.com/feross/ieee754 | Copyright 2008 Fair Oaks Labs, Inc. |
| light-my-request | 6.6.0 | API/servidor | https://github.com/fastify/light-my-request | Copyright (c) 2017 The Fastify Team / Copyright (c) 2012-2017, Project contributors |
| secure-json-parse | 4.1.0 | API/servidor | https://github.com/fastify/secure-json-parse | Copyright (c) 2019, Sideway Inc, and project contributors / Copyright (c) 2019-present The Fastify team |

## BlueOak-1.0.0 (6)

| Paquete | Versión | Se distribuye en | Repositorio / web | Copyright |
| --- | --- | --- | --- | --- |
| glob | 13.0.6 | API/servidor | https://github.com/isaacs/node-glob | (autor según package.json: Isaac Z. Schlueter) |
| lru-cache | 11.5.3 | API/servidor | https://github.com/isaacs/node-lru-cache | (autor según package.json: Isaac Z. Schlueter) |
| minimatch | 10.2.6 | API/servidor | https://github.com/isaacs/minimatch | (autor según package.json: Isaac Z. Schlueter) |
| minipass | 7.1.3 | API/servidor | https://github.com/isaacs/minipass | (autor según package.json: Isaac Z. Schlueter) |
| path-scurry | 2.0.2 | API/servidor | https://github.com/isaacs/path-scurry | (autor según package.json: Isaac Z. Schlueter) |
| sax | 1.6.1 | API/servidor | https://github.com/isaacs/sax-js | (autor según package.json: Isaac Z. Schlueter) |

## (MPL-2.0 OR Apache-2.0) (1)

| Paquete | Versión | Se distribuye en | Repositorio / web | Copyright |
| --- | --- | --- | --- | --- |
| dompurify | 3.4.16 | bundle web | https://github.com/cure53/DOMPurify | (autor según package.json: Dr.-Ing. Mario Heiderich, Cure53) |

## (BSD-3-Clause OR GPL-2.0) (1)

`node-forge` tiene licencia doble: se usa bajo **BSD-3-Clause** (sin obligaciones de copyleft).

| Paquete | Versión | Se distribuye en | Repositorio / web | Copyright |
| --- | --- | --- | --- | --- |
| node-forge | 1.4.0 | API/servidor | https://github.com/digitalbazaar/forge | Copyright (c) 2010, Digital Bazaar, Inc. / Copyright (C) 1989, 1991 Free Software Foundation, Inc. |

## MIT-0 (1)

| Paquete | Versión | Se distribuye en | Repositorio / web | Copyright |
| --- | --- | --- | --- | --- |
| nodemailer | 10.0.12 | API/servidor | https://github.com/nodemailer/nodemailer | Copyright (c) 2011-2023 Andris Reinman |

## 0BSD (1)

| Paquete | Versión | Se distribuye en | Repositorio / web | Copyright |
| --- | --- | --- | --- | --- |
| tslib | 2.8.1 | API/servidor | https://github.com/Microsoft/tslib | Copyright (c) Microsoft Corporation. |

## MIT AND ISC (1)

| Paquete | Versión | Se distribuye en | Repositorio / web | Copyright |
| --- | --- | --- | --- | --- |
| victory-vendor | 37.3.6 | bundle web | https://github.com/FormidableLabs/victory | (autor según package.json: Formidable) |

## Otros componentes y recursos (no npm)

| Componente | Licencia | Cómo se usa | Obligación |
| --- | --- | --- | --- |
| Tailwind CSS 4.3.3 (CSS generado, incluye preflight) | MIT — Tailwind Labs, Inc. | Embebido en `apps/web/dist/assets/index-*.css` (conserva el banner `/*! tailwindcss v4.3.3 \| MIT License */`) | Mantener el banner / este aviso |
| Fuente Inter (Rasmus Andersson) | SIL Open Font License 1.1 | Se carga en tiempo de ejecución desde Google Fonts (`fonts.googleapis.com`); no se redistribuye | Ninguna mientras se sirva desde Google; si se auto-hospeda, incluir `OFL.txt` |
| Otras familias de Google Fonts elegidas por el cliente (`apps/web/src/lib/theme.ts`) | OFL 1.1 / Apache-2.0 / UFL según familia | Carga desde CDN de Google | Idem |
| Iconos lucide-react | ISC (partes derivadas de Feather, MIT) | Embebidos en el bundle web | Incluidos arriba |
| `favicon.svg`, `manifest.webmanifest` | Propio | — | — |
| 12 sonidos sintetizados (chime-soft, bell-ding, triple-rise, triple-fall, announcement, marimba, xylophone, harp, double-beep, soft-pop, gong, retro) | Propios (generados por `apps/web/scripts/generate-sounds.mjs`; verificado: salida idéntica byte a byte) | `apps/web/public/sounds` | — |
| airport-bingbong.wav — "Airport Bingbong.wav" por Benboncan (freesound.org/s/93646) | CC BY 4.0 | Sonido por defecto | Atribución: autor, título, enlace y licencia |
| doorbell-bingbong.wav — "Bingbong.wav" por Benboncan (freesound.org/s/76925) | CC BY 4.0 | Opcional | Atribución |
| ding-dong.wav — "Ding_dong(Remix of 110165).wav" por 2887679652 (freesound.org/s/171755) | CC0 1.0 | Opcional | Ninguna |
| infobleep.wav — "infobleep.wav" por Divinux (freesound.org/s/198414) | CC0 1.0 | Opcional | Ninguna |
| toydoorbell.wav — "toydoorbell.wav" por AMPUL (freesound.org/s/29726) | CC Sampling+ 1.0 (distribución del sonido completo solo no comercial) | Opcional | **No apto para uso comercial tal cual — retirar** |
| quito-mariscal-sucre.wav — "quito Mariscal sucre.WAV" por milton. (freesound.org/s/81085) | CC BY-NC 3.0 | Opcional | **No comercial — retirar** |
| ekiga-vm.wav | Desconocida (sin crédito; probablemente del softphone Ekiga, GPL-2.0+) | Opcional | **Origen no documentado — retirar o sustituir** |
| Imagen Docker base `node:22-alpine` (Node.js, npm, musl, BusyBox, OpenSSL, …) | MIT, Artistic-2.0, GPL-2.0 (BusyBox, apk-tools), Apache-2.0, etc. | Solo si se entrega la imagen al cliente (on-premise) | Mantener avisos de la imagen; para componentes GPL, ofrecer/enlazar el código fuente de Alpine correspondiente |

## Servicios de terceros integrados por URL (no se redistribuye su código)

YouTube (IFrame Player API, `youtube-nocookie.com`), Vimeo, Dailymotion, Twitch, Facebook, Instagram, TikTok, Loom, Canva, Google Drive/Slides y enlaces `wa.me` (WhatsApp) se usan mediante sus reproductores/embeds oficiales. Las marcas pertenecen a sus titulares; su uso queda sujeto a los términos de servicio de cada plataforma y los derechos sobre el contenido mostrado corresponden al cliente que lo configura.
