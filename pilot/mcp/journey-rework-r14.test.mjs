import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as service from './journey-service.mjs';

const { runJourneys, fixtureValue } = service;

const task = { id: 'contatos.cadastrar', modulo: 'contatos', tarefa: 'Criar contato' };
const marker = 'a1b2c3d4';
function browserFor(ref = 'ref-1') {
  let values;
  return { opens: 0,
    async open() { this.opens++; values = new Map(); }, async close() {},
    async observe() { return { title: 'Contatos', path: '/contact', controls: [{ role: 'button', name: 'Salvar', enabled: true }],
      fields: ['Nome', 'Telefone'].map((name) => ({ role: 'textbox', name, value: values.get(name) ?? null })),
      messages: [], state: {}, screenshot: Buffer.from('masked') }; },
    async act(action) { if (action.type === 'fill') values.set(action.name, action.value); },
    async awaitCreation() { return { capture: { postSeen: true, status: 200, refFound: true }, ref }; },
    async verify() { return { confirmed: true, observed: 'feito', created: { contact: fixtureValue('contactName', 1, marker) },
      identity: { refs: [ref], ids: [1] } }; } };
}
const model = { async decide({ actions }) { return [
  { type: 'fill', role: 'textbox', name: 'Nome', value: fixtureValue('contactName', 1, marker) },
  { type: 'fill', role: 'textbox', name: 'Telefone', value: fixtureValue('phone', 1, marker) },
  { type: 'click', role: 'button', name: 'Salvar' }][actions.length]; } };

test('cache da credencial configurada funciona sem homologação e outra credencial não o lê', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r14-account-'));
  const browser = browserFor(); let credential = 'a';
  try {
    const options = { module: 'contatos', tasks: [task], root, marker, frontSha: 'a'.repeat(40), profile: 'qa', browser, model,
      accountIdentity: async () => ({ credentialHash: credential }) };
    assert.equal((await runJourneys(options))[0].status, 'concluída');
    assert.equal((await runJourneys({ ...options, browser: { async open() { throw Error('homologação fora'); } } }))[0].status, 'concluída');
    credential = 'b';
    await runJourneys(options);
    assert.equal(browser.opens, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sanitização rejeita createdRef antes de gravar qualquer arquivo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r14-sanitize-'));
  try {
    assert.equal(typeof service.saveJourney, 'function');
    await assert.rejects(service.saveJourney(root, 'contatos', { task: task.id, cacheKey: 'a'.repeat(64),
      createdRef: 'alguem@example.com' }, [['a'.repeat(64), Buffer.from('masked')]]), /sanitização falhou/);
    assert.deepEqual(await readdir(join(root, 'contatos')).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
