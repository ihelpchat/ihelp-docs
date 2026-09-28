import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateFreeFaqSections, renderFreeFaqSections, judgeClaims, loadBusinessContext } from './faq-editorial.mjs';
import { generateContentPackage } from './content-ai-service.mjs';

const sha = 'a'.repeat(40);
const facts = [
  { kind: 'route', text: 'Robôs', source: 'src/Fixture.tsx:1', sha },
  { kind: 'action', text: 'Criar novo robô', source: 'src/Fixture.tsx:2', sha },
  { kind: 'action', text: 'Salvar', source: 'src/Fixture.tsx:3', sha },
];
const base = { oQueE: [], paraQueServe: [], casosDeUso: [], duvidas: [], erros: [], suporte: [],
  passos: [{ tarefa: '### Cadastrar', passos: [{ text: 'Clique em **Criar novo robô**.' }] }] };
const context = { request: { module: 'Robôs', topic: 'Robô', description: 'Criar robô e exportar.' }, screenFacts: facts, business: [] };

test('replay Robô: metanarração sai da página e vai à pendência sem bloquear', () => {
  const positive = validateFreeFaqSections(base, context);
  const negative = validateFreeFaqSections({ ...base, duvidas: [{ text: 'As regras não estão confirmadas neste material.' }] }, context);
  assert.equal(positive.blocking.length, 0);
  assert.equal(negative.blocking.length, 0);
  assert.equal(negative.sections.duvidas.length, 0);
  assert.ok(negative.pending.some((item) => item.includes('metanarração')));
  assert.doesNotMatch(renderFreeFaqSections(negative.sections), /material/u);
});

test('replay Robô: título já marcado e rótulo com espaço são normalizados', () => {
  const checked = validateFreeFaqSections({ ...base, passos: [{ tarefa: '### Cadastrar',
    passos: [{ text: 'Clique em **Criar novo robô **.' }] }] }, context);
  const page = renderFreeFaqSections(checked.sections);
  assert.match(page, /### Cadastrar/u);
  assert.doesNotMatch(page, /### ###|\*\*Criar novo robô \*\*/u);
  assert.match(page, /\*\*Criar novo robô\*\*/u);
});

test('replay Agenda: Exportar sem fato de tela vira somente pendência', () => {
  const request = { topic: 'Agenda', description: 'Buscar, cadastrar e exportar contatos.' };
  const taskFacts = [{ kind: 'action', text: 'Buscar contato', source: 'src/Fixture.tsx:1', sha }];
  const checked = validateFreeFaqSections({ ...base, passos: [{ tarefa: 'Exportar',
    passos: [{ text: 'Não há informação confirmada para exportar.' }] }] },
  { request, screenFacts: taskFacts });
  assert.equal(checked.sections.passos.length, 0);
  assert.ok(checked.pending.some((item) => item.includes('tarefa sem fatos de tela: Exportar')));
});

test('fixture de business-context permite sustentar O que é', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faq-r17-'));
  try {
    const dir = join(root, 'architecture', 'business-context');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'robos.md'), '🟢 PÚBLICO\nO robô recebe o cliente.\n');
    const business = await loadBusinessContext(root, 'Robôs');
    assert.equal(business.length, 1);
    const answer = async (claims) => ({ claims: claims.map(({ id }) =>
      ({ id, status: 'sustentada', reason: '' })) });
    const positive = await judgeClaims({ ...base, oQueE: [{ text: 'O robô recebe o cliente.' }] },
      { ...context, business }, answer);
    assert.doesNotMatch(renderFreeFaqSections(positive.sections), /<AConfirmar>/u);
    const negative = await judgeClaims({ ...base, oQueE: [{ text: 'O robô recebe o cliente.' }] }, context, answer);
    assert.match(renderFreeFaqSections(negative.sections), /<AConfirmar>O robô recebe o cliente/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('replay Robô: segunda geração recebe novo julgamento com os mesmos fatos', async () => {
  const productContext = { groundingRequired: true, pending: [], coverage: [], support: { categories: [], rules: [] },
    businessContext: [], faqStyleExamples: [], screenFacts: facts,
    code: [{ available: true, role: 'frontend', repository: 'ihelpchat/front-react', ref: sha }],
    matches: [{ repository: 'ihelpchat/front-react', path: 'src/Fixture.tsx', line: 2,
      sha, ref: sha, excerpt: '2: Criar novo robô' }] };
  let generated = 0, judged = 0;
  const result = await generateContentPackage(new URL('../', import.meta.url).pathname,
    { topic: 'Robô', module: 'Robôs', description: 'Criar FAQ para criar robô.' }, { productContext,
      plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
        const name = payload.text.format.name;
        if (name === 'juiz_faq') {
          judged++;
          const { claims, sources } = JSON.parse(payload.input[1].content);
          assert.ok(sources.facts.some((fact) => fact.text === 'Criar novo robô'));
          return { model: 'fixture', output_text: JSON.stringify({ claims: claims.map(({ id }) =>
            ({ id, status: judged === 1 ? 'contradiz a fonte' : 'sustentada', reason: 'Rever frase' })) }) };
        }
        generated++;
        const sections = { ...base,
          oQueE: [{ text: 'O robô recebe a primeira mensagem do cliente.' }],
          paraQueServe: [{ text: 'Ajuda a equipe a organizar o atendimento.' }],
          casosDeUso: [{ text: 'Quando chegam pedidos fora do horário → monte uma resposta → o cliente recebe orientação.' }],
          passos: [{ tarefa: 'Cadastrar', passos: [{ text: generated === 1
            ? 'Na tela **Robôs**, clique em **Criar novo robô**.'
            : 'Clique em **Criar novo robô**.' }] }] };
        return { model: 'fixture', output_text: JSON.stringify({ status: 'ready', summary: 'FAQ.', questions: [],
          articles: [{ path: '/docs/teste/robo-novo', title: 'Robô novo', description: 'Ajuda.', source: 'produto',
            contentType: 'faq', productActions: [], assistantQuestion: 'Como criar um robô?', sections }] }) };
      } } } });
  assert.equal(result.status, 'ready', JSON.stringify({ questions: result.questions, generated, judged, pending: result.pending }));
  assert.equal(generated, 2);
  assert.equal(judged, 2);
  assert.equal(result.articles[0].path, 'docs/teste/robo-novo');
  assert.doesNotMatch(result.articles[0].body, /<AConfirmar>Cliq/u);
});
