import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, realpath, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { searchLocalProductContext } from './local-product-context.mjs';
import { recordJourneys, journeyRequestAllowed, journeyWriteDecision, inactiveRobotCreateRequest, verifyUniqueRecord } from './journey-runtime.mjs';
import { runJourneys, journeyCoverage } from './journey-service.mjs';

const request = (method, path, body) => ({ method: () => method,
  url: () => `https://qa.example.test/api/${path}`, postData: () => JSON.stringify(body) });
const robot = { taskId: 'robos.criar', apiOrigin: 'https://qa.example.test', generated: new Set(['Robô Exemplo 01']), createdIds: new Set(),
  fixedIds: { department: new Set([2]), channel: new Set([3]), user: new Set([4]) } };

test('SHA da jornada vem do ref real da busca local e CAPTURE_FRONT_SHA conserva fatos da tela', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'journey-front-')));
  const front = join(base, 'front');
  const previous = process.env.PRODUCT_LOCAL_CHECKOUT;
  try {
    await mkdir(join(front, 'src/pages/Robots'), { recursive: true });
    await writeFile(join(front, 'src/pages/Robots/index.tsx'),
      'export function Robots() { return <button>Criar novo Robô</button>; }');
    const router = join(front, 'src/components/core/components/Router/utils/pagesData.tsx');
    await mkdir(join(router, '..'), { recursive: true });
    await writeFile(router, 'export const pagesData = [{ path: "/bot", title: "Robôs", element: <RobotsPage /> }];');
    const git = (...args) => execFileSync('git', args, { cwd: front, encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
    git('add', '-A'); git('commit', '-qm', 'fixture');
    process.env.PRODUCT_LOCAL_CHECKOUT = front;
    const found = await searchLocalProductContext('Robôs', 'Robôs', { repositoryIds: ['frontend'], cache: false });
    const source = found.code.find((item) => item.role === 'frontend' && item.available);
    assert.ok(source, found.code[0]?.reason);
    assert.equal(source.ref, git('rev-parse', 'HEAD'));
    assert.equal(source.sha, undefined);
    assert.ok(source.screenFacts.length);
    for (const override of [undefined, 'b'.repeat(40)]) {
      let seen;
      const browser = { async open() {}, async observe() { return { title: 'Robôs', path: '/bot',
        controls: [{ role: 'button', name: 'Criar novo Robô', enabled: true }], fields: [], messages: [],
        state: {}, screenshot: Buffer.from('masked') }; }, async close() {} };
      const env = { CAPTURE_PROFILE: 'qa', ...(override ? { CAPTURE_FRONT_SHA: override } : {}) };
      const records = await recordJourneys('robos', ['robos.criar'], { env, browser,
        model: { async decide(input) { seen = input; return { type: 'finish' }; } }, root: join(base, override ?? 'detected') });
      assert.equal(records[0].versions.frontSha, override ?? source.ref);
      assert.equal(seen.screen.controls[0].name, 'Criar novo Robô');
    }
  } finally {
    if (previous === undefined) delete process.env.PRODUCT_LOCAL_CHECKOUT;
    else process.env.PRODUCT_LOCAL_CHECKOUT = previous;
    await rm(base, { recursive: true, force: true });
  }
});

test('diagnóstico da configuração informa só o campo inválido', async () => {
  await assert.rejects(runJourneys({ module: 'contatos', tasks: [], profile: 'qa', browser: {}, model: {} }),
    /^Error: frontSha ausente$/u);
  await assert.rejects(runJourneys({ module: 'contatos', tasks: [], frontSha: 'a'.repeat(40), profile: 'qa', browser: {} }),
    /^Error: model ausente$/u);
});

test('conta elegível e verificável por módulo permanece explícita', async () => {
  const catalog = JSON.parse(await readFile(
    new URL('../architecture/faq-regua/tarefas-ouro.json', import.meta.url), 'utf8'));
  const count = (module) => journeyCoverage(catalog.tarefas.filter((item) => item.modulo === module)
    .map((item) => ({ task: item.id, status: 'inconclusiva' }))).eligible;
  assert.equal(count('contatos'), 7);
  assert.equal(count('robos'), 6);
});

test('guardar robô aceita estado inativo e bloqueia ativação ou publicação', () => {
  const body = { title: 'Robô Exemplo 01', type: 1, departmentId: 2, botTrigger: 1,
    botChannels: [{ CanalId: 3 }], status: false };
  assert.equal(journeyRequestAllowed(request('POST', 'bot', body), robot), true);
  const fromFront = request('POST', 'bot', { ...body, status: true });
  const draft = inactiveRobotCreateRequest(fromFront, 'robos.criar');
  assert.equal(JSON.parse(draft).status, false);
  assert.equal(journeyRequestAllowed({ ...fromFront, postData: () => draft }, robot), true);
  for (const state of [{ status: true }, { status: 'published' }, { active: true }, { published: true }])
    assert.equal(journeyRequestAllowed(request('POST', 'bot', { ...body, ...state }), robot), false);
  assert.equal(journeyRequestAllowed(request('POST', 'bot/fake/publish', body), robot), false);
});

test('menu e encaminhamento só aceitam save inativo do robô criado', () => {
  const policy = { ...robot, taskId: 'robos.montar_menu', createdIds: new Set(['owned-ref', 5]),
    generated: new Set(['Robô Exemplo 01', 'Tag Exemplo 01']) };
  const event = { idRef: 'event-ref', title: 'Menu de opções', type: 1, message: 'Tag Exemplo 01',
    botId: 5, botReactionRules: [{ idRef: 'option-ref', rule: 1, message: 'Tag Exemplo 01', botId: 5,
      botEventRedirectRef: 'forward-ref' }] };
  const body = { id: 5, idRef: 'owned-ref', title: 'Robô Exemplo 01', status: false, type: 1,
    departmentId: 2, botTrigger: 1, botEvents: [event] };
  assert.equal(journeyRequestAllowed(request('PUT', 'bot/owned-ref/save', body), policy), true);
  const { idRef: _unused, ...frontSave } = body;
  assert.equal(journeyRequestAllowed(request('PUT', 'bot/owned-ref/save', frontSave), policy), true);
  assert.equal(journeyRequestAllowed(request('PUT', 'bot/owned-ref/save', { ...body,
    botEvents: [{ idRef: 'event-ref', title: 'Mensagem simples', type: 0, message: '', botId: 5 }] }), policy), true);
  const messageBlock = { idRef: 'event-ref', title: 'Mensagem simples', type: 0, botId: 5,
    groupBlockId: 'a'.repeat(24), messages: [{ message: 'Tag Exemplo 01', type: 0 }] };
  assert.equal(journeyRequestAllowed(request('PUT', 'bot/owned-ref/save', { ...body,
    botEvents: [messageBlock] }), policy), true);
  assert.equal(journeyRequestAllowed(request('PUT', 'bot/owned-ref/save', { ...body,
    botEvents: [{ ...messageBlock, messages: [{ message: 'Tag Exemplo 01', type: 0, messageType: 0 }] }] }), policy), true);
  assert.equal(journeyWriteDecision(request('PUT', 'bot/owned-ref/save', { ...body,
    botEvents: [{ ...messageBlock, messages: [{ message: 'Tag Exemplo 01', messageType: 0 }] }] }), policy).keyPath,
  'botEvents[0].messages[0].type');
  assert.equal(journeyRequestAllowed(request('PUT', 'bot/owned-ref/save', { ...body,
    botEvents: [{ ...messageBlock, messages: [{ message: 'Texto livre', type: 0 }] }] }), policy), false);
  assert.equal(journeyRequestAllowed(request('PUT', 'bot/other-ref/save', body), policy), false);
  assert.equal(journeyRequestAllowed(request('PUT', 'bot/owned-ref/save', { ...body, status: true }), policy), false);
  assert.equal(journeyRequestAllowed(request('PUT', 'bot/owned-ref/save', { ...body, botEvents: [{ ...event, type: 7 }] }), policy), false);
  const denied = journeyWriteDecision(request('PUT', 'bot/owned-ref/save', { ...body,
    botEvents: [{ ...event, message: 'Texto privado da conta' }] }), policy);
  assert.equal(denied.keyPath, 'botEvents[0].message');
  assert.doesNotMatch(JSON.stringify(denied), /Texto privado da conta/u);
});

test('robô criado e menu só confirmam estado persistido na ficha reaberta', async () => {
  let url = 'https://qa.example.test/bot/owned-ref';
  const labels = new Set(['Robô Exemplo 01', 'Menu de opções', 'Tag Exemplo 01']);
  const saved = { id: 31, idRef: 'owned-ref', title: 'Robô Exemplo 01', status: false,
    botEvents: [{ idRef: 'menu-ref', type: 1, message: 'Qual opção deseja escolher?', botReactionRules: [
      { message: 'Tag Exemplo 01', botEventRedirectRef: 'forward-ref' },
      { message: 'Tag Exemplo 02', botEventRedirectRef: 'forward-ref' }] },
    { idRef: 'forward-ref', type: 4, configuration: '{"DepartmentId":2}' }] };
  const page = { async goto(value) { url = value; }, async reload() {}, url: () => url,
    getByText(value) { return { count: async () => Number(labels.has(value)) }; } };
  const base = { page, refs: ['owned-ref'], targetUrl: 'https://qa.example.test', name: 'Robô Exemplo 01',
    expectedValue: 'Robô Exemplo 01', fixtureIds: { department: new Set([2]) },
    getPersisted: async () => ({ status: 200, body: { dados: saved } }) };
  assert.equal((await verifyUniqueRecord({ ...base, task: { id: 'robos.criar', modulo: 'robos' } })).confirmed, true);
  assert.equal((await verifyUniqueRecord({ ...base, task: { id: 'robos.montar_menu', modulo: 'robos' } })).confirmed, true);
  labels.add('Encaminhar atendimento');
  assert.equal((await verifyUniqueRecord({ ...base, task: { id: 'robos.encaminhar', modulo: 'robos' } })).confirmed, true);
  saved.botEvents[1].configuration = '{"DepartmentId":999}';
  assert.equal((await verifyUniqueRecord({ ...base, task: { id: 'robos.encaminhar', modulo: 'robos' } })).confirmed, false);
  saved.botEvents[1].configuration = '{"DepartmentId":2}';
  labels.delete('Menu de opções');
  saved.botEvents[0].botReactionRules = [];
  assert.equal((await verifyUniqueRecord({ ...base, task: { id: 'robos.montar_menu', modulo: 'robos' } })).confirmed, false);
});
