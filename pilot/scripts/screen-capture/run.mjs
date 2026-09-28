import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capturePage, uploadPage } from '../../mcp/screen-capture-service.mjs';

const source = process.argv[2];
if (!source) throw new Error('Informe JSON com path e module');
const input = JSON.parse(await readFile(resolve(source), 'utf8'));
const { uploads = [], ...request } = input;
if (!Array.isArray(uploads)) throw new Error('Uploads inválidos');
for (const upload of uploads) {
  if (Object.keys(upload).some((key) => !['page', 'step', 'file', 'alt', 'approved'].includes(key)))
    throw new Error('Upload inválido');
  await uploadPage({ page: upload.page, step: upload.step, alt: upload.alt, approved: upload.approved,
    base64: (await readFile(resolve(upload.file))).toString('base64') });
}
const result = await capturePage(request, { storageState: process.env.GUIDE_QA_STORAGE_STATE });
console.log(JSON.stringify({ captured: result.entries.filter((entry) => entry.page === request.path?.split('/').at(-1)).length }));
