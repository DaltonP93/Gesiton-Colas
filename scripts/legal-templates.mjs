#!/usr/bin/env node
// Copia los documentos de docs/legal/ como plantillas del sistema (packages/shared/src/legalTemplates.ts).
// Uso: npm run legal:templates — y con --check falla si el archivo generado no está al día.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = {
  terms: 'TERMINOS-DEL-SERVICIO.md',
  privacy: 'POLITICA-DE-PRIVACIDAD.md',
  dpa: 'ACUERDO-DE-TRATAMIENTO-DE-DATOS.md',
  license: 'CONTRATO-DE-LICENCIA.md',
};
const target = join(root, 'packages/shared/src/legalTemplates.ts');

const entries = Object.entries(SOURCES).map(([kind, file]) => `  ${kind}: ${JSON.stringify(readFileSync(join(root, 'docs/legal', file), 'utf8'))},`);
const output = `// Generado por scripts/legal-templates.mjs desde docs/legal/. No editar a mano: npm run legal:templates
/* eslint-disable */

/** Textos de los documentos legales tal como están en docs/legal/ (con variables {{…}}). */
export const LEGAL_TEMPLATES = {
${entries.join('\n')}
} as const;
`;

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) {
    console.error('packages/shared/src/legalTemplates.ts no coincide con docs/legal/. Ejecute: npm run legal:templates');
    process.exit(1);
  }
} else {
  writeFileSync(target, output);
  console.log('Plantillas legales actualizadas.');
}
