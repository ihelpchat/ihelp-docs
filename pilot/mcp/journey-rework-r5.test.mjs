import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordJourneys, journeyRequestAllowed, handleJourneyRoute } from './journey-runtime.mjs';
import { fixtureValue, runJourneys } from './journey-service.mjs';

const origin = 'https://qa.example.test';
const contact = { nome: fixtureValue('contactName'), contatoTelefones: [
  { numero: fixtureValue('phone').replace(/\D/gu, ''), tipoTelefone: 1 }] };
const policy = { taskId: 'contatos.cadastrar', apiOrigin: origin,
  generated: new Set([fixtureValue('contactName'), fixtureValue('phone')]) };
const multipart = (parts, end = true) => `--fixture\r\n${parts.join('\r\n--fixture\r\n')}`
  + (end ? '\r\n--fixture--\r\n' : '');
const field = (name, value, filename = '') => `Content-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ''}\r\n\r\n${value}`;
const request = (body) => ({ method: () => 'POST', url: () => `${origin}/api/v2/contacts`, postData: () => body });

test('multipart valida todas as partes, sem anexo, repetição, truncamento ou excesso', () => {
  const valid = multipart([field('contato', JSON.stringify(contact))]);
  assert.equal(journeyRequestAllowed(request(valid), policy), true);
  for (const body of [
    multipart([field('contato', JSON.stringify(contact)), field('media', 'dados', 'clientes.csv')]),
    multipart([field('contato', JSON.stringify(contact)), field('contato', JSON.stringify(contact))]),
    multipart([field('contato', JSON.stringify(contact), 'clientes.csv')]),
    multipart([field('contato', JSON.stringify(contact))], false),
    valid + 'lixo',
    multipart([field('contato', ' '.repeat(20_001) + JSON.stringify(contact))]),
    null,
  ]) assert.equal(journeyRequestAllowed(request(body), policy), false);
});

test('escrita sem apiOrigin conhecido falha fechada antes da rede', async () => {
  assert.equal(journeyRequestAllowed(request(JSON.stringify(contact)), { ...policy, apiOrigin: undefined }), false);
  let aborted = false; let passed = false;
  await handleJourneyRoute({ request: () => request(JSON.stringify(contact)),
    async abort() { aborted = true; }, async fallback() { passed = true; } },
  { ...policy, apiOrigin: undefined, target: { url: origin, local: false }, env: { GUIDE_QA_ALLOWED_HOSTS: 'qa.example.test' },
    thirdPartyDenied: {}, onBlocked() {} });
  assert.equal(aborted, true);
  assert.equal(passed, false);
});

test('recordJourneys reutiliza cache com marcador sorteado e invalida por SHA', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'journey-r5-')));
  const front = join(root, 'front');
  const old = process.env.PRODUCT_LOCAL_CHECKOUT;
  let opens = 0;
  try {
    await mkdir(join(front, 'src/pages/Robots'), { recursive: true });
    await writeFile(join(front, 'src/pages/Robots/index.tsx'), 'export function Robots() { return <button>Criar novo Robô</button>; }');
    const router = join(front, 'src/components/core/components/Router/utils/pagesData.tsx');
    await mkdir(join(router, '..'), { recursive: true });
    await writeFile(router, 'export const pagesData = [{ path: "/bot", title: "Robôs", element: <RobotsPage /> }];');
    const git = (...args) => execFileSync('git', args, { cwd: front, encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
    git('add', '-A'); git('commit', '-qm', 'fixture');
    process.env.PRODUCT_LOCAL_CHECKOUT = front;
    const browser = { async open() { opens++; }, async observe() { return { title: 'Robôs', path: '/bot',
      controls: [], fields: [], messages: [], state: {}, screenshot: Buffer.from('masked') }; }, async close() {} };
    const options = { env: { CAPTURE_FRONT_SHA: 'a'.repeat(40), CAPTURE_PROFILE: 'qa' }, browser,
      model: { async decide() { return { type: 'finish' }; } }, root: join(root, 'records') };
    const [first] = await recordJourneys('robos', ['robos.criar'], options);
    const [second] = await recordJourneys('robos', ['robos.criar'], options);
    assert.equal(opens, 1);
    assert.equal(second.marker, first.marker);
    assert.equal(second.cacheKey, first.cacheKey);
    await recordJourneys('robos', ['robos.criar'], { ...options,
      env: { ...options.env, CAPTURE_FRONT_SHA: 'b'.repeat(40) } });
    assert.equal(opens, 2);
  } finally {
    if (old === undefined) delete process.env.PRODUCT_LOCAL_CHECKOUT;
    else process.env.PRODUCT_LOCAL_CHECKOUT = old;
    await rm(root, { recursive: true, force: true });
  }
});

test('falha de observe preserva estágio e categoria sem texto da tela', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-observe-'));
  try {
    const [record] = await runJourneys({ module: 'contatos', tasks: [{ id: 'contatos.cadastrar', modulo: 'contatos', tarefa: 'Criar' }],
      root, frontSha: 'a'.repeat(40), profile: 'qa', browser: { async open() {},
        async observe() { const error = new Error('segredo de tela'); error.stage = 'máscara'; error.captureReason = 'máscara não cobriu'; throw error; },
        async close() {} }, model: { async decide() { return { type: 'finish' }; } } });
    assert.deepEqual(record.observeError, { stage: 'máscara', category: 'máscara não cobriu' });
    assert.equal(JSON.stringify(record).includes('segredo de tela'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
