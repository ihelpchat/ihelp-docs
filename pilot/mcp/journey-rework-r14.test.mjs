import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import * as service from './journey-service.mjs';
import { journeyRequestAllowed, configuredJourneyIdentity, observeJourneyDom } from './journey-runtime.mjs';

const { runJourneys, fixtureValue } = service;

test('plano de criação escolhe controles por papel e nome sem chamar modelo', () => {
  const screen = { controls: [{ role: 'button', name: 'Criar novo robô', enabled: true },
    { role: 'textbox', name: 'Título do Robô', enabled: true }],
  fields: [{ role: 'textbox', name: 'Título do Robô', value: null }] };
  assert.deepEqual(service.plannedJourneyAction('robos.criar', screen, []),
    { type: 'click', role: 'button', name: 'Criar novo robô', value: null });
  assert.deepEqual(service.plannedJourneyAction('robos.criar', screen,
    [{ type: 'click', role: 'button', name: 'Criar novo robô' }]),
  { type: 'fill', role: 'textbox', name: 'Título do Robô', value: fixtureValue('robotName') });
});

test('menu preenche a segunda opção sem sobrescrever a primeira', () => {
  const first = fixtureValue('menuOption', 1);
  const second = fixtureValue('menuOption', 2);
  const actions = [{ type: 'click', name: 'Fluxo de Robô' }, { type: 'click', name: 'Adicionar bloco' },
    { type: 'click', name: 'Menu de opções' }, { type: 'fill', name: 'Mensagem de onboarding', value: fixtureValue('menuQuestion') },
    { type: 'fill', name: 'Mensagem', value: fixtureValue('menuQuestion') },
    { type: 'click', name: 'Adicionar opção +' }, { type: 'fill', name: 'Adicione uma opção', value: first },
    { type: 'click', name: 'Adicionar opção +' }];
  const screen = { controls: [], fields: [
    { role: 'textbox', name: 'Adicione uma opção (cabeçalho)', value: first },
    { role: 'textbox', name: 'Adicione uma opção (cabeçalho 2)', value: null }] };
  assert.deepEqual(service.plannedJourneyAction('robos.montar_menu', screen, actions),
    { type: 'fill', role: 'textbox', name: 'Adicione uma opção (cabeçalho 2)', value: second });
});

test('menu envia mensagem pelo botão do Chat antes de adicionar o bloco', () => {
  const actions = [
    { type: 'click', name: 'Fluxo de Robô' },
    ...Array.from({ length: 3 }, () => ({ type: 'click', name: 'Adicionar bloco' })),
    { type: 'click', name: 'Menu de opções' },
    { type: 'click', name: 'Mensagem simples' },
    { type: 'fill', name: 'Mensagem de onboarding', value: service.fixtureValue('menuQuestion') },
    { type: 'fill', name: 'Mensagem', value: service.fixtureValue('menuQuestion') },
    { type: 'click', name: 'Adicionar opção +' },
    { type: 'fill', name: 'Adicione uma opção', value: service.fixtureValue('menuOption', 1) },
    { type: 'click', name: 'Adicionar opção +' },
    { type: 'fill', name: 'Adicione uma opção (cabeçalho 2)', value: service.fixtureValue('menuOption', 2) },
    { type: 'fill', name: 'Título da mensagem', value: service.fixtureValue('menuOption', 1) },
    { type: 'fill', name: 'campo 2 do formulário (texto)', value: service.fixtureValue('menuOption', 1) },
  ];
  const screen = { controls: [{ role: 'button', name: 'Adicionar bloco (cabeçalho)', enabled: true },
    { role: 'button', name: 'Adicionar bloco (cabeçalho 2)', enabled: true }], fields: [] };
  screen.controls.push({ role: 'button', name: 'Enviar mensagem', enabled: true });
  assert.deepEqual(service.plannedJourneyAction('robos.montar_menu', screen, actions),
    { type: 'click', role: 'button', name: 'Enviar mensagem', value: null });
  actions.push({ type: 'click', name: 'Enviar mensagem' });
  assert.deepEqual(service.plannedJourneyAction('robos.montar_menu', screen, actions),
    { type: 'click', role: 'button', name: 'Adicionar bloco (cabeçalho 2)', value: null });
  assert.equal(service.policyDecision({ type: 'click', role: 'button',
    name: 'Enviar mensagem' }, undefined, 'robos.montar_menu').allowed, true);
  assert.equal(service.policyDecision({ type: 'press', role: 'textbox',
    name: 'campo 2 do formulário (texto)', value: 'Escape' }, undefined, 'robos.montar_menu').allowed, false);
});

test('edição do título encerra pelo blur sem salvar o fluxo', () => {
  const actions = [{ type: 'click', name: 'Fluxo de Robô' }, { type: 'click', name: 'Editar título do Robô' },
    { type: 'fill', name: 'Digite o título do robô', value: fixtureValue('robotName', 2) }];
  const screen = { controls: [{ role: 'button', name: 'Voltar para lista', enabled: true }], fields: [] };
  assert.deepEqual(service.plannedJourneyAction('robos.editar', screen, actions),
    { type: 'click', role: 'button', name: 'Voltar para lista', value: null });
});

test('botão da opção usa o texto próprio apesar do rótulo anterior', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<label>Opções</label><button>Adicionar opção +</button>');
    const screen = await observeJourneyDom(page, { vocabulary: ['Opções', 'Adicionar opção +'] });
    assert.ok(screen.controls.some((item) => item.role === 'button' && item.name === 'Adicionar opção +'));
  } finally { await browser.close(); }
});

test('botão sem texto ao lado da mensagem é alvo Enviar mensagem', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div><textarea placeholder="Mensagem"></textarea><button><svg></svg></button></div>');
    const screen = await observeJourneyDom(page, { vocabulary: ['Mensagem', 'Enviar mensagem'] });
    assert.ok(screen.controls.some((item) => item.role === 'button' && item.name === 'Enviar mensagem'));
  } finally { await browser.close(); }
});

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
  const browser = browserFor(); let credential = 'a'.repeat(64);
  try {
    const options = { module: 'contatos', tasks: [task], root, marker, frontSha: 'a'.repeat(40), profile: 'qa', browser, model,
      accountIdentity: async () => ({ credentialHash: credential }) };
    assert.equal((await runJourneys(options))[0].status, 'concluída');
    assert.equal((await runJourneys({ ...options, browser: { async open() { throw Error('homologação fora'); } } }))[0].status, 'concluída');
    credential = 'b'.repeat(64);
    await runJourneys(options);
    assert.equal(browser.opens, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cache confere conta autenticada no ar e sinaliza identidade não verificada fora', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r16-account-'));
  const browser = browserFor();
  let account = 'a'; let online = true;
  const originalOpen = browser.open.bind(browser);
  browser.open = async () => { await originalOpen(); return { account: { userId: 'user-1', companyId: account } }; };
  try {
    const options = { module: 'contatos', tasks: [task], root, marker, frontSha: 'a'.repeat(40),
      profile: 'qa', browser, model, accountIdentity: async () => ({ credentialHash: 'a'.repeat(64) }),
      probeAccount: async () => online ? { userId: 'user-1', companyId: account } : null };
    const first = (await runJourneys(options))[0];
    assert.equal(first.status, 'concluída');
    account = 'b';
    const second = (await runJourneys(options))[0];
    assert.equal(browser.opens, 2, 'troca de empresa reexecuta');
    assert.notEqual(second.accountProof, first.accountProof);
    online = false;
    const cached = (await runJourneys(options))[0];
    assert.equal(cached.identityVerified, false);
    assert.equal((await service.readJourney({ root, module: 'contatos', task: task.id,
      accountHash: 'a'.repeat(64) })).identityVerified, false);
    assert.equal(browser.opens, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ler jornada segrega ponteiro por identidade configurada', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r16-pointer-'));
  const browser = browserFor();
  try {
    const options = { module: 'contatos', tasks: [task], root, marker, frontSha: 'a'.repeat(40),
      profile: 'qa', browser, model, accountIdentity: async () => ({ credentialHash: 'a'.repeat(64) }) };
    await runJourneys(options);
    assert.equal((await service.readJourney({ root, module: 'contatos', task: task.id,
      accountHash: 'a'.repeat(64) })).task, task.id);
    await assert.rejects(service.readJourney({ root, module: 'contatos', task: task.id,
      accountHash: 'b'.repeat(64) }), /ENOENT|indisponível/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('identidade configurada depende de host, e-mail e perfil, sem derivar da senha', () => {
  const env = { GUIDE_QA_STAGING_URL: 'https://qa.example.test', GUIDE_QA_ALLOWED_HOSTS: 'qa.example.test',
    GUIDE_QA_AUTHORIZED_EMAIL: 'Qa@example.com', GUIDE_QA_AUTHORIZED_PASSWORD: 'fixture-pass' };
  const first = configuredJourneyIdentity(env).credentialHash;
  assert.match(first, /^[a-f0-9]{64}$/u);
  assert.equal(configuredJourneyIdentity({ ...env, GUIDE_QA_AUTHORIZED_EMAIL: 'qa@example.com' }).credentialHash, first);
  assert.equal(configuredJourneyIdentity({ ...env, GUIDE_QA_AUTHORIZED_PASSWORD: 'new-pass' }).credentialHash, first);
  assert.notEqual(configuredJourneyIdentity({ ...env, CAPTURE_PROFILE: 'outro' }).credentialHash, first);
  assert.notEqual(configuredJourneyIdentity({ ...env, GUIDE_QA_STAGING_URL: 'https://other.example.test',
    GUIDE_QA_ALLOWED_HOSTS: 'other.example.test' }).credentialHash, first);
});

test('PUT multipart de responsável aceita apenas contato original e IDs de fixtures', () => {
  const name = fixtureValue('contactName'); const phone = fixtureValue('phone');
  const snapshot = { idRef: 'ref-1', nome: name, telefoneId: 2, telefone: phone,
    emailId: 3, email: fixtureValue('email'), responsibleUsers: [] };
  const body = { Nome: name, ContatoTelefones: [{ Id: 2, Numero: phone, TipoTelefone: 1 }],
    ContatoEmails: [{ Id: 3, Email: snapshot.email }],
    ContatoResponsaveis: [{ id: null, DepartmentId: 7, UserId: 8 }] };
  const request = (value) => ({ method: () => 'PUT', url: () => 'https://qa.example.test/api/v2/contacts/ref-1',
    postData: () => `--fixture\r\nContent-Disposition: form-data; name="contato"\r\n\r\n${JSON.stringify(value)}\r\n--fixture--\r\n` });
  const context = { apiOrigin: 'https://qa.example.test', taskId: 'contatos.definir_responsavel',
    generated: new Set([name, phone, snapshot.email]), createdIds: new Set(['ref-1']), contactSnapshot: snapshot,
    fixedIds: { department: new Set([7]), user: new Set([8]) } };
  assert.equal(journeyRequestAllowed(request(body), context), true);
  assert.equal(journeyRequestAllowed(request({ ...body, Nome: 'Pessoa Real' }), context), false);
  assert.equal(journeyRequestAllowed(request({ ...body, ContatoTelefones: [] }), context), false);
  assert.equal(journeyRequestAllowed(request({ ...body,
    ContatoResponsaveis: [{ id: null, DepartmentId: 70, UserId: 8 }] }), context), false);
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

test('sessão ativa bloqueia a tarefa sem clicar em desconectar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r14-session-'));
  let actions = 0;
  try {
    const [record] = await runJourneys({ module: 'contatos', tasks: [task], root, marker,
      frontSha: 'a'.repeat(40), profile: 'qa', model,
      browser: { async open() { const error = new Error('sessão ativa'); error.code = 'QA_SESSION_ACTIVE'; throw error; },
        async act() { actions++; }, async close() {} } });
    assert.equal(record.status, 'bloqueada');
    assert.equal(record.reason, 'ambiente: sessão ativa');
    assert.equal(actions, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
