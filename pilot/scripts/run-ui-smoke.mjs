import { startQaSite } from './visual/serve-qa-build.mjs';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const site = await startQaSite(new URL('../out/', import.meta.url).pathname, basePath);
try {
  process.env.BASE_URL = `${site.url}${basePath}`;
  await import('./ui-smoke.mjs');
} finally {
  await site.close();
}
