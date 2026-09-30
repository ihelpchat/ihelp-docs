import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from './journey-runtime.mjs';
import { fixtureValue } from './journey-service.mjs';

const call = (method, path, body) => ({ method: () => method,
  url: () => `https://qa.example.test/api/v2${path}`, postData: () => method === 'POST' && /^\/contacts\/?$/u.test(path)
    ? `--fixture\r\nContent-Disposition: form-data; name="contato"\r\n\r\n${JSON.stringify(body)}\r\n--fixture--\r\n`
    : JSON.stringify(body) });
const generated = new Set([fixtureValue('contactName'), fixtureValue('phone'), fixtureValue('email'),
  fixtureValue('robotName')]);
const { journeyRequestAllowed } = runtime;

test('cadastro real aceita telefone normalizado pelo formulário e nega nome alheio ao gerador', () => {
  const body = { nome: fixtureValue('contactName'), contatoTelefones: [
    { numero: fixtureValue('phone').replace(/\D/gu, ''), tipoTelefone: 1 }],
    contatoEmails: [{ email: fixtureValue('email') }] };
  const context = { apiOrigin: 'https://qa.example.test', taskId: 'contatos.cadastrar', generated, createdIds: new Set() };
  assert.equal(journeyRequestAllowed(call('POST', '/contacts', body), context), true);
  assert.equal(journeyRequestAllowed(call('POST', '/contacts', { ...body, nome: 'Pessoa Real' }), context), false);
});

test('diagnóstico sanitizado classifica rota, chave, valor e estado sem vazar payload', () => {
  assert.equal(typeof runtime.journeyWriteDecision, 'function');
  const journeyWriteDecision = runtime.journeyWriteDecision;
  const context = { apiOrigin: 'https://qa.example.test', taskId: 'robos.criar', generated, createdIds: new Set(),
    fixedIds: { channel: new Set([3]) } };
  const body = { title: fixtureValue('robotName'), type: 1, botTrigger: 1,
    botChannels: [{ CanalId: 3 }], status: false };
  const route = journeyWriteDecision(call('POST', '/bot/77/publish', body), context);
  assert.equal(route.reason, 'rota fora da lista');
  assert.equal(route.path, '/bot/:id/publish');
  assert.equal(route.task, 'robos.criar');
  assert.deepEqual(route.keys, Object.keys(body).sort());
  assert.equal(journeyWriteDecision(call('POST', '/bot', { ...body, surprise: 'segredo' }), context).reason, 'chave desconhecida');
  assert.equal(journeyWriteDecision(call('POST', '/bot', { ...body, title: 'Pessoa Real' }), context).reason, 'valor fora do gerador');
  assert.equal(journeyWriteDecision(call('POST', '/bot', { ...body, status: 'published' }), context).reason, 'estado ativo');
  assert.doesNotMatch(JSON.stringify(route), /77|segredo|Pessoa Real/u);
});

test('cadastro e salvamento de robô seguem payload do formulário, sempre inativos', () => {
  const context = { apiOrigin: 'https://qa.example.test', taskId: 'robos.criar', generated, createdIds: new Set(),
    fixedIds: { channel: new Set([3]) } };
  const body = { title: fixtureValue('robotName'), type: 1, botTrigger: 1,
    botChannels: [{ CanalId: 3 }], status: false };
  assert.equal(journeyRequestAllowed(call('POST', '/bot/', body), context), true);
  assert.equal(journeyRequestAllowed(call('POST', '/bot/', { ...body, status: 'published' }), context), false);
});
