import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGuide } from './create-guide.mjs';

const root = await mkdtemp(join(tmpdir(), 'm536-private-request-'));
const actor = 'user:editor-1';
const request = { guideId: 'usuario-acesso', topic: 'Adicionar pessoa da equipe', module: 'usuarios', description: 'Criar acesso para Maria Oliveira na equipe.', requestedBy: actor };
const article = { path: 'docs/usuario-acesso', title: 'Adicionar pessoa da equipe', description: 'Como adicionar uma pessoa da equipe e verificar o acesso no iHelp.', source: 'produto', contentType: 'guia', body: 'Abra a tela de usuários e confira as permissões antes de salvar. '.repeat(7), guide: { schemaVersion: 1, guideId: 'usuario-acesso', version: 1, mode: 'real', initialStepId: 'inicio', steps: [{ stepId: 'inicio', text: 'Abra Usuários.' }] } };
const options = {
  getContext: async () => ({ code: [{ repository: 'front', ref: 'a'.repeat(40), available: true }], matches: [] }),
  plan: async () => ({ status: 'needs_information', questions: ['Qual departamento recebe Maria Oliveira?'] }),
  generate: async (_root, resumed) => {
    assert.match(resumed.description, /Maria Oliveira/);
    assert.match(resumed.details, /Maria Oliveira/);
    return { status: 'ready', articles: [article] };
  },
  existing: async () => null,
  submit: async () => ({ status: 'draft', articles: [{ path: article.path, draft: '.drafts/1' }] }),
};
const plan = await createGuide(root, request, options);
assert.equal(plan.questionIds.length, 1);
const resume = { ...request, planId: plan.planId, plan: plan.plan, questions: plan.questions, questionIds: plan.questionIds, answers: ['Maria Oliveira'] };
await assert.rejects(createGuide(root, { ...resume, description: `${request.description}x` }, options), /plano não confere, refaça/i);
await assert.rejects(createGuide(root, { ...resume, questions: ['Outra pergunta'] }, options), /plano não confere, refaça/i);
const result = await createGuide(root, resume, options);
assert.equal(result.reviewRequired, true);
assert.deepEqual(await createGuide(root, resume, options), result);

async function allFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await allFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
for (const file of await allFiles(root)) {
  if (file.includes('/.drafts/')) continue;
  assert.doesNotMatch(await readFile(file, 'utf8'), /Maria|Oliveira/, file);
}
