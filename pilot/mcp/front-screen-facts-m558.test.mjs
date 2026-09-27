import test from 'node:test';
import assert from 'node:assert/strict';
import { extractScreenFacts, discardAnsweredScreenQuestions } from './front-screen-facts.mjs';
import { canReadFrontFile } from './local-product-context.mjs';
import { publicProductContext } from './product-context-service.mjs';
import { validateGroundedOutput, planContent } from './content-ai-service.mjs';
import { guardModelOutput } from './model-output-guard.mjs';

const router = 'src/components/core/components/Router/utils/pagesData.tsx';
const page = 'src/components/pages/Contacts/index.tsx';
const modal = 'src/components/pages/Contacts/Modal.tsx';
const sources = {
  [router]: `import ContactPage from '../../../../pages/Contacts';\nconst pages = [{ path: '/contact', element: <ContactPage /> }];`,
  [page]: `import Modal from './Modal';\nexport default function ContactPage() { return <><button onClick={open}>Adicionar Contato</button><Modal /></>; }`,
  [modal]: `import ContactPage from './index';\nexport default function Modal() { return <><input name="nome" aria-label="Nome" required /><input type="file" accept=".csv,.xlsx" />{toast.success('Contato criado')}</>; }`,
  'src/components/pages/Other/index.tsx': `export default () => <button>Segredo fora da cadeia</button>`,
};
const run = (files = sources) => extractScreenFacts({ route: '/contact', paths: Object.keys(files),
  readSource: async (path) => files[path], sha: 'a'.repeat(40) });

test('rota, página e componente: fatos citáveis; fora da cadeia e ciclo param', async () => {
  const result = await run();
  assert.deepEqual(result.files, [router, page, modal]);
  assert.ok(result.facts.some((fact) => fact.kind === 'action' && fact.text === 'Adicionar Contato' && fact.handler === 'open' && fact.source === `${page}:2`));
  assert.ok(result.facts.some((fact) => fact.kind === 'field' && fact.name === 'nome' && fact.required === true && fact.source === `${modal}:2`));
  assert.ok(result.facts.some((fact) => fact.kind === 'upload' && fact.accept === '.csv,.xlsx' && fact.source === `${modal}:2`));
  assert.ok(result.facts.some((fact) => fact.text === 'Contato criado' && fact.source === `${modal}:2`));
  assert.doesNotMatch(JSON.stringify(result), /Segredo fora da cadeia/u);
});

test('uma troca no import para fora de src não é lida', async () => {
  const files = { ...sources, [page]: sources[page].replace("'./Modal'", "'../../../../../outside/Modal'") };
  const read = [];
  const result = await extractScreenFacts({ route: '/contact', paths: Object.keys(files),
    readSource: async (path) => { read.push(path); return files[path]; }, sha: 'a'.repeat(40) });
  assert.equal(read.includes(modal), false);
  assert.equal(result.facts.some((fact) => fact.kind === 'upload'), false);
});

test('uma troca de linha conserva a linha real', async () => {
  const files = { ...sources, [page]: `\n${sources[page]}` };
  const result = await run(files);
  assert.ok(result.facts.some((fact) => fact.text === 'Adicionar Contato' && fact.source === `${page}:3`));
});

test('só descarta pergunta com fato correspondente e registra', () => {
  const facts = [{ kind: 'action', text: 'Adicionar Contato', source: `${page}:2` },
    { kind: 'upload', accept: '.csv,.xlsx', source: `${modal}:2` }];
  const result = discardAnsweredScreenQuestions(['Qual o nome do botão para adicionar contato?', 'Quais formatos são aceitos na importação?', 'Qual o prazo para importar?'], facts);
  assert.deepEqual(result.questions, ['Qual o prazo para importar?']);
  assert.equal(result.discarded.length, 2);
  assert.equal(result.discarded[0].source, `${page}:2`);
});

test('porta única limita leitura a TS/TSX autorizado do front', () => {
  assert.equal(canReadFrontFile(router), true);
  assert.equal(canReadFrontFile(page), true);
  for (const path of ['../src/components/Secret.tsx', 'src/secret.tsx', 'src/components/.env.tsx',
    'src/components/PasswordStore.tsx', 'src/components/Widget.jsx', 'src/components/__tests__/Widget.tsx'])
    assert.equal(canReadFrontFile(path), false, path);
});

test('fato da tela entra no grounding com linha e SHA exatos', () => {
  const sha = 'a'.repeat(40), repository = 'ihelpchat/front-react';
  const context = { groundingRequired: true, code: [{ available: true }], matches: [], screenFacts: [
    { kind: 'action', text: 'Adicionar Contato', source: `${page}:2`, repository, sha }], module: 'Contatos' };
  const statement = { guidance: 'Clique em Adicionar Contato.', grounding: [{ text: 'Clique em Adicionar Contato.',
    citations: [{ repository, path: page, lineStart: 2, lineEnd: 2, sha }] }] };
  assert.equal(validateGroundedOutput(statement, context, ['guidance']), true);
  statement.grounding[0].citations[0].lineStart = 3;
  statement.grounding[0].citations[0].lineEnd = 3;
  assert.equal(validateGroundedOutput(statement, context, ['guidance']), false);
});

test('plano descarta pergunta respondida e preserva a não respondida', async () => {
  const sha = 'a'.repeat(40);
  const context = { groundingRequired: true, code: [{ available: true }], matches: [],
    screenFacts: [{ kind: 'action', text: 'Adicionar Contato', source: `${page}:2`, repository: 'ihelpchat/front-react', sha }],
    support: { categories: [], rules: [] }, coverage: [] };
  const result = await planContent(new URL('../', import.meta.url).pathname,
    { topic: 'Contato', module: 'Contatos', description: 'Explique como cadastrar.' }, { productContext: context,
      client: { responses: { create: async () => ({ model: 'fixture', output_text: JSON.stringify({
        status: 'needs_information', guidance: 'Confirmar botões.', risks: [], suggestedActions: [], grounding: [],
        questions: ['Qual o nome do botão para adicionar contato?', 'Qual é o prazo de cadastro?'],
      }) }) } } });
  assert.deepEqual(result.questions, ['Qual é o prazo de cadastro?']);
  assert.equal(result.discardedQuestions[0].source, `${page}:2`);
});

test('código front não sai no contexto público e eco é bloqueado', () => {
  const excerpt = 'const internal = makePrivate(x, y, z); internal.execute(a, b, c);';
  const context = { screenCode: [{ path: page, excerpt }], code: [{ screenCode: [{ path: page, excerpt }] }] };
  assert.doesNotMatch(JSON.stringify(publicProductContext(context)), /makePrivate/u);
  const output = guardModelOutput({ articles: [{ body: excerpt }] }, context, 'package');
  assert.equal(output.value.status, 'needs_information');
});

test('ação só é respondida por rótulo com o mesmo verbo', () => {
  const question = 'Qual o nome do botão para excluir contato?';
  const add = { kind: 'action', text: 'Adicionar Contato', source: `${page}:2` };
  const remove = { ...add, text: 'Excluir contato' };
  assert.deepEqual(discardAnsweredScreenQuestions([question], [add]).questions, [question]);
  assert.deepEqual(discardAnsweredScreenQuestions([question], [add, remove]).questions, []);
});

test('campo obrigatório de cadastro: uma alteração em required muda o descarte', () => {
  const question = 'Quais campos são obrigatórios no cadastro?';
  const required = { kind: 'field', name: 'nome', required: true, source: `${modal}:2` };
  assert.deepEqual(discardAnsweredScreenQuestions([question], [required]).questions, []);
  assert.deepEqual(discardAnsweredScreenQuestions([question], [{ ...required, required: false }]).questions, [question]);
});

test('nome visível de conceito usa sinônimo controlado', () => {
  const question = '“Carteirizar” é o nome usado na interface?';
  const owner = { kind: 'text', text: 'Proprietário do Contato', source: `${modal}:2` };
  assert.deepEqual(discardAnsweredScreenQuestions([question], [owner]).questions, []);
  assert.deepEqual(discardAnsweredScreenQuestions([question], [{ ...owner, text: 'Telefone' }]).questions, [question]);
});

test('import local não usado fica fora da cadeia; uso em JSX o inclui', async () => {
  const unused = 'src/components/pages/Contacts/Unused.tsx';
  const files = { ...sources, [page]: `import Unused from './Unused';\n${sources[page]}`,
    [unused]: 'export default function Unused() { return <button onClick={remove}>Excluir Empresa</button>; }' };
  const absent = await run(files);
  assert.equal(absent.files.includes(unused), false);
  assert.doesNotMatch(JSON.stringify(absent.facts), /Excluir Empresa/u);
  const rendered = { ...files, [page]: files[page].replace('<Modal />', '<Modal /><Unused />') };
  assert.equal((await run(rendered)).files.includes(unused), true);
});

test('chamada e passagem de componente contam como uso; comentário e string não contam', async () => {
  const component = 'src/components/pages/Contacts/Forwarded.tsx';
  const base = { ...sources, [page]: `import Forwarded from './Forwarded';\n${sources[page]}`,
    [component]: 'export default function Forwarded() { return <button onClick={save}>Salvar</button>; }' };
  for (const use of ['Forwarded()', 'component={Forwarded}', 'element: Forwarded']) {
    const files = { ...base, [page]: `${base[page]}\n${use}` };
    assert.equal((await run(files)).files.includes(component), true, use);
  }
  const fakeUse = { ...base, [page]: `${base[page]}\n// <Forwarded />\nconst text = 'Forwarded()';` };
  assert.equal((await run(fakeUse)).files.includes(component), false);
});

test('uso JSX após template interpolado continua visível ao lexer', async () => {
  const files = { ...sources, [page]: sources[page].replace('<Modal />', '<div className={`${active ? "on" : "off"}`}><Modal /></div>') };
  assert.equal((await run(files)).files.includes(modal), true);
});

test('fato de outro assunto na mesma cadeia não responde cadastro ou ação de contato', () => {
  const attendance = { kind: 'field', name: 'phoneNumbers', required: true,
    source: 'src/components/shared/Attendance/NewAttendance.tsx:10' };
  const task = { kind: 'action', text: 'Excluir Tarefa', source: 'src/components/pages/Contacts/Tasks.tsx:20' };
  assert.deepEqual(discardAnsweredScreenQuestions(['Quais campos são obrigatórios no cadastro de contato?'], [attendance]).questions,
    ['Quais campos são obrigatórios no cadastro de contato?']);
  assert.deepEqual(discardAnsweredScreenQuestions(['Qual o nome do botão para excluir contato?'], [task]).questions,
    ['Qual o nome do botão para excluir contato?']);
});
