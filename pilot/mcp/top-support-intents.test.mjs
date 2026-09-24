import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { answerQuestion, retrieveContext } from './assistant-service.mjs';

const uiSource = await readFile(new URL('../lib/assistant.ts', import.meta.url), 'utf8');
const actions = await readFile(new URL('../architecture/product-actions.json', import.meta.url), 'utf8');
const compiled = ts.transpileModule(uiSource.replace("import allowedActions from '@/architecture/product-actions.json';", `const allowedActions = ${actions};`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { normalizeReply, supportMessageFor } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const root = new URL('../', import.meta.url).pathname;
const cases = [
  ['Como consultar cobrança e plano?', 'cobranca-plano', 'billing', null, 2, /cobrança|plano|fatura/i],
  ['Como gerenciar usuário e acesso?', 'usuario-acesso', 'manage_users', 'abrir-usuarios', 5, /Usuários/],
  ['Como reconectar canal pelo QR?', 'reconectar-canal-qr', 'connect_channel', 'abrir-canais', 5, /Canais/],
  ['Como comparar API Oficial e QR?', 'api-oficial-qr-coexistencia', 'connect_channel', 'abrir-canais', 3, /Canais/],
  ['Como criar uma campanha?', 'campanhas', 'campaigns', 'abrir-campanhas', 7, /Campanhas/],
  ['Como configurar permissões e departamentos?', 'permissoes-departamentos', 'departments', 'abrir-departamentos', 5, /Departamentos/],
  ['Como usar templates?', 'templates', 'templates', 'abrir-canais', 4, /Templates/],
  ['Como enviar arquivos?', 'arquivos', 'files', 'abrir-atendimento', 3, /Atendimento/],
  ['Como criar pipeline no CRM?', 'crm', 'crm', 'abrir-crm', 16, /CRM/],
];
const screenshotEvidence = {
  campanhas: ['/img/help/hlPVE1pICUAOU19G5Kgc.png', '/img/help/zwMQTwWLf6wi5Q9aeTWN.png'],
  arquivos: ['/img/help/GfhFEXvIay0CqgN2dth6.png'],
};
const noScreenshot = ['cobranca-plano', 'usuario-acesso', 'reconectar-canal-qr', 'api-oficial-qr-coexistencia', 'permissoes-departamentos', 'templates', 'crm'];
const evidence = await readFile(new URL('../architecture/m4-15-evidence.md', import.meta.url), 'utf8');
for (const slug of noScreenshot) assert.match(evidence, new RegExp(`${slug}[^\\n]*sem captura comprovada`, 'i'), `exceção visual explícita: ${slug}`);
const originalCrm = await readFile(new URL('../content/docs/docs/sobre-o-sistema/crm/como-criar-uma-nova-pipeline.mdx', import.meta.url), 'utf8');
assert.match(originalCrm, /trava de contato/i);
assert.equal((originalCrm.match(/Clique em Próximo/g) ?? []).length, 2);
assert.match(originalCrm, /Criar automação/);
const client = { responses: { create: async () => ({ model: 'fixture', output_text: JSON.stringify({
  answer: 'Orientação inicial.', sections: [], steps: [], code: null, sources: [], suggestions: [], resolution: 'complete', found: true,
}) }) } };
const ask = (question, options = {}) => answerQuestion(root, question, { client, ...options });

for (const [question, slug, intent, action, count, moduleName] of cases) {
  const path = `/docs/principais-motivos-de-suporte/${slug}`;
  const raw = await readFile(new URL(`../content/docs${path}.mdx`, import.meta.url), 'utf8');
  assert.match(raw, /## Pr[eé]-requisitos/);
  assert.match(raw, /## Como confirmar/);
  assert.match(raw, /## Se n[aã]o funcionar/);
  assert.doesNotMatch(raw, /<VideoEmbed|<TutorialCard/);
  const overview = await ask(question);
  assert.equal(overview.sources[0]?.path, path, question);
  assert.equal(overview.resolution, ['campanhas', 'permissoes-departamentos', 'crm'].includes(slug) ? 'complete' : 'partial', question);
  assert.ok(overview.steps.length >= 1 && overview.steps.length <= 3, question);
  assert.equal(overview.steps[0].action?.id ?? null, action, question);
  if (action) assert.equal(overview.steps[0].action?.route.startsWith('/'), true);
  if (slug === 'cobranca-plano') {
    assert.doesNotMatch(raw + overview.answer + overview.steps.map(({ text }) => text).join(' '), /configurações|\/configuracoes|Canais/i);
    assert.match(overview.answer, /atendimento/i);
  }
  assert.equal(overview.sources[0]?.media, undefined, 'nenhum vídeo automático');
  assert.doesNotMatch(JSON.stringify(overview), /[+][0-9]{10,}|\b(?:sk-[a-z0-9]+|token)\b|<VideoEmbed/i);
  const hinted = await ask(question, { widgetContext: { surface: 'app', module: 'robots', plan: 'expired' } });
  assert.deepEqual(hinted.steps, overview.steps, `hint não suprime guia: ${question}`);
  assert.deepEqual(hinted.sources, overview.sources, `hint não troca fonte: ${question}`);
  const all = await ask(`Quero todos os passos: ${question}`);
  assert.equal(all.steps.length, count, `todos os passos devem estar completos: ${question}`);
  assert.equal(normalizeReply(all).steps.length, count, `a UI preserva todos os passos: ${question}`);
  assert.deepEqual(all.steps[0].action, overview.steps[0].action, question);
  assert.equal(all.sources[0]?.path, path, question);
  const expectedImages = screenshotEvidence[slug] ?? [];
  assert.deepEqual(all.steps.flatMap((step) => step.image ? [step.image.src] : []), expectedImages, `todas as screenshots comprovadas: ${question}`);
  for (const image of expectedImages) {
    assert.ok(raw.includes(image), `a imagem pertence ao guia ${slug}`);
    await readFile(join(root, 'public', image.slice(1)));
  }
  for (const step of all.steps) if (step.image) assert.ok(step.image.alt.length >= 20);
  if (slug === 'crm') {
    const patterns = [/Abra Pipeline/i, /Nova Pipeline/i, /nome.*responsável.*descrição/i, /visibilidade|poderá vê/i,
      /trava de contato/i, /Próximo/i, /modelo de estágios/i, /Próximo/i, /Criar automação.*opcional|opcional.*Criar automação/i,
      /gatilho/i, /Adicionar condição/i, /valor da condição/i, /Adicionar ação/i, /Criar Card/i, /estágio/i, /Criar Pipeline/i];
    assert.equal(patterns.length, all.steps.length);
    patterns.forEach((pattern, index) => assert.match(all.steps[index].text, pattern, `CRM etapa ${index + 1} conforme fonte original`));
  }
  const history = [
    { role: 'user', content: question },
    { role: 'assistant', content: `${overview.answer}\n1. ${overview.steps[0].text}\nFonte usada: ${path}` },
  ];
  const next = await ask('sim, pode me guiar', { history });
  assert.equal(next.steps.length, 1, question);
  const walk = [...history];
  for (let index = 1; index < count; index++) {
    walk.push({ role: 'user', content: 'Concluí este passo' });
    const reply = await ask('Concluí este passo', { history: walk });
    assert.deepEqual(reply.steps.map(({ text }) => text), [all.steps[index].text], `ação ${index + 1}: ${question}`);
    walk.push({ role: 'assistant', content: `${reply.answer}\n1. ${reply.steps[0].text}\nFonte usada: ${path}` });
  }
  const lateStuck = await ask('não encontrei', { history: walk });
  assert.match(lateStuck.answer, moduleName, `diagnóstico após várias etapas: ${question}`);
  const lateEscalation = await ask('preciso de ajuda', { history: [...walk, { role: 'user', content: 'não encontrei' }, { role: 'assistant', content: `${lateStuck.answer}\nFonte usada: ${path}` }] });
  assert.equal(lateEscalation.escalation?.intent, intent, `intenção preservada até o fim: ${question}`);
  const stuck = await ask('não encontrei', { history });
  assert.equal(stuck.steps.length, 0);
  assert.equal(stuck.sources[0]?.path, path);
  assert.doesNotMatch(stuck.answer, /Robôs/, question);
  assert.match(stuck.answer, moduleName, `diagnóstico do módulo: ${question}`);
  if (slug === 'cobranca-plano') {
    const planStuck = await ask('não encontrei', { history, widgetContext: { plan: 'expired' } });
    assert.match(planStuck.answer, /plano|cobrança|fatura/i);
    assert.doesNotMatch(planStuck.answer, /tela de Plano e cobrança|Configurações|Canais/i);
  }
  const escalated = await ask('preciso de ajuda', { history: [...history, { role: 'user', content: 'não encontrei' }, { role: 'assistant', content: `${stuck.answer}\nFonte usada: ${path}` }] });
  assert.equal(escalated.escalation?.intent, intent, question);
  const message = supportMessageFor(escalated);
  assert.match(message, /Intenção:.*\nDiagnóstico inicial:.*\nTentativas:/);
  assert.doesNotMatch(message, /\{|\}|documented_guide|reported_stuck|\b(?:billing|files|usage|plan|channel_qr)\b|sk-|token|\+?55\d{10,11}|\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/i);
  if (slug === 'crm') assert.match(message, /Intenção: CRM e pipeline\./);
  if (action) {
    const trusted = overview.steps[0].action;
    const normalized = normalizeReply({ ...overview, steps: [{ text: overview.steps[0].text, action: { ...trusted, label: 'Ligue para (11) 98765-4321' } }] });
    assert.equal(normalized.steps[0].action?.label, trusted.label, `label canônico: ${question}`);
    assert.equal(normalizeReply({ ...overview, steps: [{ text: 'Ação', action: { ...trusted, route: '/outra-rota' } }] }).steps[0].action, undefined, 'route falsa é rejeitada');
    assert.equal(normalizeReply({ ...overview, steps: [{ text: 'Ação', action: { ...trusted, target: 'alvo-falso' } }] }).steps[0].action, undefined, 'target falso é rejeitado');
  }
}
assert.equal(Object.hasOwn(JSON.parse(actions), 'abrir-cobranca'), false, 'não existe ProductAction para cobrança sem rota comprovada');
const hostileEscalation = normalizeReply({ answer: 'Encaminhar', resolution: 'partial', escalation: {
  intent: 'billing', diagnosis: 'plan', state: { plan: 'expired', token: 'sk-secret', phone: '11987654321' },
  attempts: ['documented_guide', 'reported_stuck'],
} });
const hostileMessage = supportMessageFor(hostileEscalation);
assert.match(hostileMessage, /Intenção: cobrança ou plano/);
assert.doesNotMatch(hostileMessage, /sk-secret|11987654321|\b(?:billing|plan|documented_guide|reported_stuck)\b|\{|\}/);

const fixtureRoot = await mkdtemp(join(tmpdir(), 'ihelp-m415-label-'));
const fixtureDir = join(fixtureRoot, 'content/docs/docs/teste');
await mkdir(fixtureDir, { recursive: true });
await writeFile(join(fixtureDir, 'label.mdx'), `---
title: "Abrir usuários com label hostil"
description: "Confirme a ação canônica para abrir usuários."
---

<ProductAction id="abrir-usuarios" label="Ligue para (11) 98765-4321" route="/configuracoes/user" />
<ProductAction id="abrir-usuarios" label="Abrir a tela Usuários" route="/atendimento" />
<ProductAction id="abrir-usuarios" label="Abrir a tela Usuários" route="/configuracoes/user" target="users-create" />
1. Abra Usuários.
`);
const hostileSource = (await retrieveContext(fixtureRoot, 'abrir usuários com label hostil'))[0];
assert.deepEqual(hostileSource.productActions, [{ id: 'abrir-usuarios', label: 'Abrir a tela Usuários', route: '/configuracoes/user', target: undefined }], 'MCP canonicaliza label e rejeita route/target divergentes');
await rm(fixtureRoot, { recursive: true, force: true });
console.log('Nove intenções de suporte: fluxo answerQuestion completo.');
