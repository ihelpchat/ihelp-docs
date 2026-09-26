import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { normalizeSessionEvent, saveSessionEvent } from './session-events.mjs';
import { topicForQuestion } from './closed-router.mjs';
import { collectGaps } from './lacunas.mjs';
import { buildServer } from './server.mjs';

const root = new URL('../', import.meta.url).pathname;
const file = join(await mkdtemp(join(tmpdir(), 'm540-gaps-')), 'events.jsonl');
const now = Date.now();
const base = { origin: 'faq', durationMs: 20, result: 'partial', path: '/assistente', issue: 'usage' };
const add = (sessionId, fields = {}) => saveSessionEvent(file, { ...base, sessionId, ...fields }, { now });

assert.equal(topicForQuestion('Onde ficam os contatos?'), 'importar-contatos');
assert.equal(topicForQuestion('Quero importar uma lista de contatos'), 'importar-contatos');
assert.equal(topicForQuestion('assunto sem área reconhecida'), undefined);
assert.equal(normalizeSessionEvent({ ...base, sessionId: 'fixture-1', topic: 'tema-livre' }).topic, undefined,
  'tópico fora do enum é descartado');

await add('fixture-1', { topic: 'importar-contatos' });
await add('fixture-1', { topic: 'importar-contatos' });
await add('fixture-2', { topic: 'importar-contatos' });
assert.deepEqual((await collectGaps(root, file, { now })).documentable, [], '2 sessões: abaixo do mínimo');
await add('fixture-3', { topic: 'importar-contatos' });
let gaps = await collectGaps(root, file, { now });
assert.equal(gaps.documentable.length, 1, 'perguntas equivalentes formam uma lacuna');
assert.equal(gaps.documentable[0].topic, 'importar-contatos');
assert.equal(gaps.documentable[0].sessions, 3);
assert.equal(gaps.documentable[0].proposal, 'criar');
assert.equal(gaps.documentable[0].criar_guia.guideId, 'guia-importar-contatos');

for (let i = 1; i <= 3; i++) await add(`canal-${i}`, { topic: 'abrir-canais' });
gaps = await collectGaps(root, file, { now });
assert.equal(gaps.documentable.find(({ topic }) => topic === 'abrir-canais').proposal, 'atualizar');
assert.equal(gaps.documentable.find(({ topic }) => topic === 'abrir-canais').guideId, 'reconectar-canal-qr');

for (let i = 1; i <= 3; i++) await add(`erro-${i}`, { topic: 'importar-contatos', issue: 'incident' });
gaps = await collectGaps(root, file, { now });
assert.equal(gaps.documentable.find(({ topic }) => topic === 'importar-contatos').sessions, 3,
  'incidente não aumenta a proposta de artigo');
assert.equal(gaps.incidents[0].reason, 'incidente — não documentar', 'incidente deve sair separado');
assert.equal(gaps.incidents[0].sessions, 3);
for (let i = 1; i <= 3; i++) await add(`sem-${i}`, { issue: 'usage' });
gaps = await collectGaps(root, file, { now });
assert.equal(gaps.review[0].reason, 'sem tópico — revisão humana');
assert.equal(gaps.review[0].sessions, 3);
assert.doesNotMatch(JSON.stringify(gaps), /fixture-|canal-|erro-|sem-|sessionId|\/assistente/);
assert.equal((await readFile(file, 'utf8')).includes('tema-livre'), false);

const registered = new Map();
const original = McpServer.prototype.registerTool;
McpServer.prototype.registerTool = function (name, config, callback) {
  registered.set(name, { config, callback });
  return original.call(this, name, config, callback);
};
try { buildServer(root); } finally { McpServer.prototype.registerTool = original; }
assert.equal(registered.get('lacunas')?.config.mutates, false, 'lacunas não é ferramenta de escrita');
assert.equal([...registered].filter(([, { config }]) => config.mutates).some(([name]) => name === 'lacunas'), false);
console.log('lacunas: agregação, classificação e política MCP ok');
