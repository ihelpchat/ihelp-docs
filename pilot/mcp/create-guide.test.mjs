import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGuide } from './create-guide.mjs';

const root = await mkdtemp(join(tmpdir(), 'm536-'));
const actor = 'user:editor-1';
const input = { guideId: 'usuario-acesso', topic: 'Adicionar pessoa da equipe', module: 'usuarios', description: 'Criar acesso para uma pessoa da equipe.', requestedBy: actor };
const context = (sha = 'a'.repeat(40)) => ({ groundingRequired: true, code: [{ repository: 'front', ref: sha, available: true }], matches: [{ repository: 'front', path: 'src/pages/Users.tsx', line: 10, sha, ref: sha, excerpt: 'Criar usuário' }], support: { categories: [], rules: [] }, coverage: [] });
const article = { path: 'docs/usuario-acesso', title: 'Adicionar pessoa da equipe', description: 'Como adicionar uma pessoa da equipe e verificar o acesso no iHelp.', source: 'produto', contentType: 'guia', body: 'Abra a tela de usuários e confira as permissões antes de salvar. '.repeat(7), guide: { schemaVersion: 1, guideId: 'usuario-acesso', version: 1, mode: 'real', initialStepId: 'inicio', steps: [{ stepId: 'inicio', text: 'Abra Usuários.' }] } };
let plans = 0;
let generations = 0;
let submissions = 0;
const options = {
  getContext: async () => context(),
  plan: async () => { plans++; return { status: 'needs_information', questions: ['Qual departamento recebe o acesso?'], guidance: 'Confirme o departamento.' }; },
  generate: async (_root, request, settings) => {
    generations++;
    assert.equal(settings.plan.questions[0], 'Qual departamento recebe o acesso?');
    assert.match(request.details, /Vendas/);
    return { status: 'ready', articles: [article] };
  },
  existing: async () => null,
  submit: async (_root, articles, mode) => {
    submissions++;
    assert.equal(mode, 'draft');
    assert.equal(articles.length, 1);
    return { status: 'draft', articles: [{ path: articles[0].path, draft: '.drafts/1' }] };
  },
};
const first = await createGuide(root, input, options);
assert.match(first.planId, /^[a-f0-9]{32,}$/);
assert.deepEqual(first.questions, ['Qual departamento recebe o acesso?']);
assert.equal(generations, 0);
const resumed = await createGuide(root, { planId: first.planId, answers: ['Vendas'], requestedBy: actor }, options);
assert.equal(plans, 1, 'retomada usa o plano aprovado sem replanejar');
assert.equal(resumed.status, 'draft');
assert.equal(submissions, 1);
assert.deepEqual(await createGuide(root, { planId: first.planId, answers: ['Vendas'], requestedBy: actor }, options), resumed, 'repetição devolve o mesmo draft');
assert.equal(generations, 1, 'repetição não gera outro pacote');
assert.equal(submissions, 1, 'repetição não duplica draft');
await assert.rejects(createGuide(root, { planId: first.planId, answers: ['Outro'], requestedBy: actor }, options), /respostas diferentes/i);
await assert.rejects(createGuide(root, { planId: first.planId, answers: ['Vendas'], requestedBy: 'user:outro-1' }, options), /ator/i);

const changed = await createGuide(root, input, options);
await assert.rejects(createGuide(root, { planId: changed.planId, answers: ['Vendas'], requestedBy: actor }, { ...options, getContext: async () => context('b'.repeat(40)) }), /fontes mudaram.*refaça o plano/i);
assert.equal(submissions, 1, 'fonte alterada não envia draft');

const updateOptions = { ...options, existing: async () => ({ path: article.path, guide: { ...article.guide, version: 3 } }) };
const update = await createGuide(root, input, updateOptions);
const updateResult = await createGuide(root, { planId: update.planId, answers: ['Vendas'], requestedBy: actor }, updateOptions);
assert.equal(updateResult.article.guide.guideId, 'usuario-acesso');
assert.equal(updateResult.article.guide.version, 4, 'atualiza o guia existente');
assert.equal(updateResult.article.path, article.path);
