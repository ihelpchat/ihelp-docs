import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { addUploadedScreenshot, capturePlan, captureScreens } from './capture.mjs';
import { envCompatibility } from '../../mcp/env-compat.mjs';

const source = process.argv[2];
if (!source) throw new Error('Informe um plano JSON com page, module, steps, screenFacts e appSha');
const input = JSON.parse(await readFile(resolve(source), 'utf8'));
const coverage = JSON.parse(await readFile(new URL('../../architecture/coverage-matrix.json', import.meta.url), 'utf8'));
const plan = capturePlan({ ...input, coverage });
const manifest = { version: 1, entries: [] };
for (const upload of input.uploads ?? []) {
  const step = plan.find((item) => item.page === upload.page && item.step === upload.step);
  if (!step) throw new Error('Upload sem passo confirmado no plano');
  await addUploadedScreenshot({ ...upload, label: step.label, route: step.route, appSha: input.appSha, manifest });
}
const baseUrl = process.env[envCompatibility.guideProof.stagingUrl];
if (!baseUrl) throw new Error('GUIDE_QA_STAGING_URL ausente');
const result = await captureScreens({ baseUrl, plan, manifest, appSha: input.appSha,
  storageState: process.env.GUIDE_QA_STORAGE_STATE });
console.log(JSON.stringify({ captured: result.entries.length, manifest: 'pilot/public/img/mcp/manifest.json' }));
