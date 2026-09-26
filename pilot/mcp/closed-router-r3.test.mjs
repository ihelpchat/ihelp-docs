import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';
import { publishedGuideCatalog, routeMessage } from './closed-router.mjs';
import { requestsHuman } from './guide-state.mjs';
import { answerQuestion } from './assistant-service.mjs';
import { compileGuidePackage } from '../lib/guide-package.mjs';

const root = new URL('../', import.meta.url).pathname;
const catalog = await publishedGuideCatalog(root);
const published = await compileGuidePackage(root);
const byId = new Map(catalog.map((guide) => [guide.guideId, guide]));

for (const id of ['reconectar-canal-qr', 'usuario-acesso', 'recado-fora-do-horario']) {
  const guide = byId.get(id);
  assert.ok(guide, `${id} precisa estar publicado`);
  assert.ok(guide.aliases.length, `${id} precisa de vocabulário leigo no frontmatter`);
  assert.deepEqual(published.catalog.guides.find((item) => item.guide.guideId === id)?.aliases, guide.aliases,
    `${id}: aliases publicados no pacote`);
}

const budget = { file: '/tmp/m5-20-r3-budget.json', dailyLimitUsd: 100, reserveUsd: 0.01 };
const provider = (choice) => ({ responses: { create: async () => ({ status: 'completed',
  output_text: JSON.stringify({ choice }), usage: { input_tokens: 1, output_tokens: 1 } }) } });
const guideCases = [
  ['O zap parou, apareceu um quadrado com pontinhos', 'reconectar-canal-qr'],
  ['Meu zap parou', 'reconectar-canal-qr'],
  ['O WhatsApp desconectou e não chega mensagem', 'reconectar-canal-qr'],
  ['Como reconectar canal pelo QR?', 'reconectar-canal-qr'],
  ['Cadastrar minha secretária só com os clientes do setor dela', 'usuario-acesso'],
  ['Colocar uma pessoa da equipe no departamento dela', 'usuario-acesso'],
  ['Como gerenciar usuário e acesso?', 'usuario-acesso'],
  ['NÃO é campanha: quero resposta automática quando o salão está fechado', 'recado-fora-do-horario'],
  ['Recado fora do horário no domingo', 'recado-fora-do-horario'],
];
for (const [question, id] of guideCases) {
  assert.deepEqual(await routeMessage(question, { catalog, client: provider(id), budget }),
    { kind: 'guide', guideId: id }, question);
}
for (const question of ['Como cultivar tomates?', 'Quanto vou pagar quando o teste acabar?']) {
  for (const id of byId.keys()) {
    assert.notEqual((await routeMessage(question, { catalog, client: provider(id), budget })).kind, 'guide',
      `${question}: não aceitar guia errado ${id}`);
  }
}
assert.deepEqual(await routeMessage('NÃO é campanha, quero recado fora do horário',
  { catalog, client: provider('campanhas'), budget }), { kind: 'none' });

for (const question of [
  'Quero falar com suporte', 'Preciso falar com atendimento', 'Pode me colocar com alguém da equipe?',
  'Me passa para um técnico', 'Atendente', 'Humano', 'Suporte',
]) {
  assert.equal(requestsHuman(question), true, question);
  const reply = await answerQuestion(root, question, { apiKey: '' });
  assert.ok(reply.escalation || reply.actions?.some((action) => action.destination === 'support'),
    `${question}: handoff mesmo sem provider`);
}
for (const question of ['Não quero falar com ninguém', 'Não preciso de atendimento', 'Quero configurar suporte no robô']) {
  assert.equal(requestsHuman(question), false, question);
}

const locked = [
  'content/docs/docs/principais-motivos-de-suporte/reconectar-canal-qr.mdx',
  'content/docs/docs/principais-motivos-de-suporte/usuario-acesso.mdx',
  'content/docs/docs/sobre-o-sistema/configuracoes/departamentos/recado-fora-do-horario.mdx',
];
for (const path of locked) {
  const raw = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const metadata = parseDocument(raw.match(/^---\n([\s\S]*?)\n---/)[1]).toJS();
  assert.ok(metadata.assistantAliases?.length, `${path}: aliases são metadados fora dos passos`);
}
console.log('M5.20 r3: frases leigas publicadas, abstenção e pedido de pessoa sem provider.');
