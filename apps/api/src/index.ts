import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { buildApp } from './app';
import { loadConfig } from './config';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultWebDist = [path.resolve(here, '../../web/dist'), path.resolve(here, '../web')].find((dir) =>
  existsSync(path.join(dir, 'index.html')),
);

const config = loadConfig(defaultWebDist && !process.env.WEB_DIST ? { WEB_DIST: defaultWebDist } : {});
const app = await buildApp({ config });

const shutdown = async (signal: string) => {
  app.log.info(`${signal} recibido, cerrando...`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.HOST, port: config.PORT });
app.log.info(`Gestión de Colas escuchando en ${config.PUBLIC_URL} (docs: ${config.PUBLIC_URL}/api/docs)`);
