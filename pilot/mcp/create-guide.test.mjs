import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGuide } from './create-guide.mjs';
import { auditOperation, submitContentPackage } from './content-service.mjs';
import { generateCanonicalGuide } from './content-ai-service.mjs';

const root = await mkdtemp(join(tmpdir(), 'm536-'));
const actor = 'user:editor-1';
const input = { guideId: 'usuario-acesso', topic: 'Adicionar pessoa da equipe', module: 'usuarios', description: 'Criar acesso para uma pessoa da equipe.', requestedBy: actor };
const resume = (plan, answers, requestedBy = actor) => ({ ...input, planId: plan.planId, plan: plan.plan, questions: plan.questions, questionIds: plan.questionIds, answers, requestedBy });
const context = (sha = 'a'.repeat(40)) => ({ groundingRequired: true, code: [{ repository: 'front', ref: sha, available: true }], matches: [{ repository: 'front', path: 'src/pages/Users.tsx', line: 10, sha, ref: sha, excerpt: 'Criar usuário' }], support: { categories: [], rules: [] }, coverage: [] });
const article = { path: 'docs/usuario-acesso', title: 'Adicionar pessoa da equipe', description: 'Como adicionar uma pessoa da equipe e verificar o acesso no iHelp.', source: 'produto', contentType: 'guia', body: 'Abra a tela de usuários e confira as permissões antes de salvar. '.repeat(7), guide: { schemaVersion: 1, guideId: 'usuario-acesso', version: 1, mode: 'real', initialStepId: 'inicio', steps: [{ stepId: 'inicio', text: 'Abra Usuários.' }] } };
let plans = 0;
let generations = 0;
let submissions = 0;
let submittedArticle;
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
    submittedArticle = articles[0];
    assert.equal(mode, 'draft');
    assert.equal(articles.length, 1);
    return { status: 'draft', articles: [{ path: articles[0].path, draft: '.drafts/1' }] };
  },
};
const first = await createGuide(root, input, options);
assert.match(first.planId, /^[a-f0-9]{32,}$/);
assert.deepEqual(first.questions, ['Qual departamento recebe o acesso?']);
assert.equal(generations, 0);
const resumed = await createGuide(root, resume(first, ['Vendas'], actor), options);
assert.equal(plans, 1, 'retomada usa o plano aprovado sem replanejar');
assert.equal(resumed.status, 'draft');
assert.equal(submissions, 1);
assert.deepEqual(await createGuide(root, resume(first, ['Vendas'], actor), options), resumed, 'repetição devolve o mesmo draft');
assert.equal(generations, 1, 'repetição não gera outro pacote');
assert.equal(submissions, 1, 'repetição não duplica draft');
await assert.rejects(createGuide(root, resume(first, ['Vendas'], actor), { ...options, getContext: async () => context('c'.repeat(40)) }), /fontes mudaram.*refaça o plano/i);
await assert.rejects(createGuide(root, resume(first, ['Outro'], actor), options), /respostas diferentes/i);
await assert.rejects(createGuide(root, resume(first, ['Vendas'], 'user:outro-1'), options), /ator/i);

const changed = await createGuide(root, input, options);
await assert.rejects(createGuide(root, resume(changed, ['Vendas'], actor), { ...options, getContext: async () => context('b'.repeat(40)) }), /fontes mudaram.*refaça o plano/i);
assert.equal(submissions, 1, 'fonte alterada não envia draft');

const updateOptions = { ...options, existing: async () => ({ path: article.path, guide: { ...article.guide, version: 3 } }) };
const update = await createGuide(root, input, updateOptions);
const updateResult = await createGuide(root, resume(update, ['Vendas'], actor), updateOptions);
assert.equal(submittedArticle.guide.guideId, 'usuario-acesso');
assert.equal(submittedArticle.guide.version, 4, 'atualiza o guia existente');
assert.equal(submittedArticle.path, article.path);

const privacyOptions = { ...options, generate: async (_root, request) => {
  assert.doesNotMatch(request.details, /pessoa@example\.com/);
  return { status: 'ready', articles: [article] };
} };
const privacy = await createGuide(root, input, privacyOptions);
await createGuide(root, resume(privacy, ['Envie para pessoa@example.com'], actor), privacyOptions);
assert.doesNotMatch(await readFile(join(root, '.guide-plans', `${privacy.planId}.json`), 'utf8'), /pessoa@example\.com/);

const privateRoot = await mkdtemp(join(tmpdir(), 'm536-private-'));
const namedArticle = { ...article, body: `${article.body} Maria Oliveira confirmou a operação.` };
const namedOptions = { ...options, generate: async (_root, request) => {
  assert.match(request.details, /Maria Oliveira/, 'resposta só existe durante a geração');
  return { status: 'ready', articles: [namedArticle] };
} };
const namedPlan = await createGuide(privateRoot, input, namedOptions);
const namedResult = await createGuide(privateRoot, resume(namedPlan, ['Maria Oliveira'], actor), namedOptions);
assert.equal(namedResult.reviewRequired, true, 'draft exige revisão humana');
const namedState = JSON.parse(await readFile(join(privateRoot, '.guide-plans', `${namedPlan.planId}.json`), 'utf8'));
assert.equal(typeof namedState.answerHash, 'string');
assert.doesNotMatch(JSON.stringify(namedState), /Maria Oliveira/, 'plano não guarda resposta nem artigo gerado');
assert.equal(namedState.result?.article, undefined);
assert.deepEqual(await createGuide(privateRoot, resume(namedPlan, ['Maria Oliveira'], actor), namedOptions), namedResult);

const ttlRoot = await mkdtemp(join(tmpdir(), 'm536-ttl-'));
let now = 1_000_000;
const timed = { ...options, now: () => now, planTtlMs: 1_000 };
const old = await createGuide(ttlRoot, input, timed);
now += 999;
await assert.rejects(createGuide(ttlRoot, resume(old, ['Vendas'], actor), { ...timed, getContext: async () => context('b'.repeat(40)) }), /fontes mudaram/i);
now += 1;
await assert.rejects(createGuide(ttlRoot, resume(old, ['Vendas'], actor), timed), /plano expirado, refaça/i);
assert.equal((await readdir(join(ttlRoot, '.guide-plans'))).some((name) => name === `${old.planId}.json`), false);
const abandoned = await createGuide(ttlRoot, input, timed);
now += 1_001;
await createGuide(ttlRoot, input, timed);
assert.equal((await readdir(join(ttlRoot, '.guide-plans'))).some((name) => name === `${abandoned.planId}.json`), false, 'toda chamada limpa planos vencidos');

const realDraftRoot = await mkdtemp(join(tmpdir(), 'm536-draft-'));
const draftOptions = { ...options, submit: undefined };
const draftPlan = await createGuide(realDraftRoot, input, draftOptions);
const draft = await createGuide(realDraftRoot, resume(draftPlan, ['Vendas'], actor), draftOptions);
assert.equal(draft.draft.status, 'draft');
assert.match(await readFile(join(realDraftRoot, draft.draft.articles[0].path), 'utf8'), /guideId: usuario-acesso/);
assert.deepEqual(await createGuide(realDraftRoot, resume(draftPlan, ['Vendas'], actor), draftOptions), draft);

const retryRoot = await mkdtemp(join(tmpdir(), 'm536-retry-'));
let submitAttempts = 0;
const retryOptions = { ...options, submit: async (...args) => {
  submitAttempts++;
  return submitContentPackage(...args.slice(0, 5), { ...args[5], audit: async (stateRoot, event) => {
    if (submitAttempts === 1 && event.result === 'success') throw new Error('Falha injetada no audit final');
    return auditOperation(stateRoot, event);
  } });
} };
const retryPlan = await createGuide(retryRoot, input, retryOptions);
const retryInput = resume(retryPlan, ['Vendas'], actor);
await assert.rejects(createGuide(retryRoot, retryInput, retryOptions), /SUBMIT_FAILED|Não foi possível enviar/);
const retryResult = await createGuide(retryRoot, retryInput, retryOptions);
assert.equal(retryResult.status, 'draft');
assert.equal(retryResult.reviewRequired, true);
assert.equal(submitAttempts, 2, 'retomada conclui após falha posterior à gravação');
assert.deepEqual(await createGuide(retryRoot, retryInput, retryOptions), retryResult);
assert.equal((await readdir(join(retryRoot, '.drafts/docs'))).length, 1, 'não duplica draft');

const conflictRoot = await mkdtemp(join(tmpdir(), 'm536-conflict-'));
let conflictAttempts = 0;
const conflictOptions = { ...options, submit: async (...args) => {
  conflictAttempts++;
  return submitContentPackage(...args.slice(0, 5), { ...args[5], audit: async (stateRoot, event) => {
    if (conflictAttempts === 1 && event.result === 'success') throw new Error('Falha injetada no audit final');
    return auditOperation(stateRoot, event);
  } });
} };
const conflictPlan = await createGuide(conflictRoot, input, conflictOptions);
const conflictInput = resume(conflictPlan, ['Vendas'], actor);
await assert.rejects(createGuide(conflictRoot, conflictInput, conflictOptions), /SUBMIT_FAILED|Não foi possível enviar/);
const conflictPath = join(conflictRoot, '.drafts', `${article.path}.mdx`);
await writeFile(conflictPath, 'draft divergente');
await assert.rejects(createGuide(conflictRoot, conflictInput, conflictOptions), /conflito|diferente/i);
assert.equal(await readFile(conflictPath, 'utf8'), 'draft divergente', 'não sobrescreve draft divergente');

const occupiedRoot = await mkdtemp(join(tmpdir(), 'm536-occupied-'));
const occupiedPlan = await createGuide(occupiedRoot, input, { ...options, submit: undefined });
await submitContentPackage(occupiedRoot, [article], 'draft', actor);
const occupiedInput = resume(occupiedPlan, ['Vendas'], actor);
await assert.rejects(createGuide(occupiedRoot, occupiedInput, { ...options, submit: undefined }), /Draft já existe/);
await assert.rejects(createGuide(occupiedRoot, occupiedInput, { ...options, submit: undefined }), /Draft já existe/, 'draft de outro plano não vira retomada aceita');

const citation = { repository: 'front', path: 'src/pages/Users.tsx', lineStart: 10, lineEnd: 10, sha: 'a'.repeat(40) };
const generated = { ...article, assistantQuestion: 'Como adicionar uma pessoa?', assistantOverview: 'Abra a tela de usuários.', assistantInitialSteps: 1, assistantSuggestions: ['Como conferir o acesso?'], productActions: [], guide: { ...article.guide, steps: [{ stepId: 'inicio', text: 'Abra Usuários.', actionId: null, choices: [] }] } };
const sentences = [generated.description, 'Abra a tela de usuários e confira as permissões antes de salvar.', generated.assistantOverview, ...generated.assistantSuggestions, generated.guide.steps[0].text];
generated.grounding = sentences.map((text) => ({ text, citations: [citation] }));
const model = { responses: { create: async () => ({ model: 'fake', output_text: JSON.stringify({ status: 'ready', questions: [], article: generated }) }) } };
const canonical = await generateCanonicalGuide(root, input, { productContext: context(), existingGuide: null, plan: { status: 'ready', questions: [] }, client: model });
assert.equal(canonical.status, 'ready');
assert.equal(canonical.articles[0].guide.guideId, 'usuario-acesso');
assert.equal(canonical.articles[0].grounding, undefined, 'citações ficam no gate, não no MDX');
