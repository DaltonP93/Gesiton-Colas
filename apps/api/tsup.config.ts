import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate-cli.ts', 'src/db/seed-cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // El paquete compartido se distribuye como TypeScript: se incluye en el bundle.
  noExternal: ['@gc/shared'],
});
