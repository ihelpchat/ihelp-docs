import test from 'node:test';
import assert from 'node:assert/strict';
import { extractScreenFacts } from './front-screen-facts.mjs';
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
  [modal]: `import ContactPage from './index';\nexport default function Modal() { return <><input name="nome" aria-label="Nome" required /><input type="file" accept=".csv,.xlsx" /><button onClick={() => toast.success('Contato criado')}>Criar</button></>; }`,
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

test('código front não sai no contexto público e eco é bloqueado', () => {
  const excerpt = 'const internal = makePrivate(x, y, z); internal.execute(a, b, c);';
  const context = { screenCode: [{ path: page, excerpt }], code: [{ screenCode: [{ path: page, excerpt }] }] };
  assert.doesNotMatch(JSON.stringify(publicProductContext(context)), /makePrivate/u);
  const output = guardModelOutput({ articles: [{ body: excerpt }] }, context, 'package');
  assert.equal(output.value.status, 'needs_information');
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
    const reference = use === 'component={Forwarded}' ? `<Panel ${use} />`
      : use === 'element: Forwarded' ? `{render({${use}})}` : `{${use}}`;
    const files = { ...base, [page]: base[page].replace('<Modal />', `<Modal />${reference}`) };
    assert.equal((await run(files)).files.includes(component), true, use);
  }
  const fakeUse = { ...base, [page]: `${base[page]}\n// <Forwarded />\nconst text = 'Forwarded()';` };
  assert.equal((await run(fakeUse)).files.includes(component), false);
});

test('uso JSX após template interpolado continua visível ao lexer', async () => {
  const files = { ...sources, [page]: sources[page].replace('<Modal />', '<div className={`${active ? "on" : "off"}`}><Modal /></div>') };
  assert.equal((await run(files)).files.includes(modal), true);
});

test('ação prioriza aria-label e title próprios antes do texto JSX', async () => {
  const button = '<button onClick={remove} aria-label="Excluir selecionados" title="Excluir contatos marcados">Excluir Selecionados ({n})</button>';
  const files = { ...sources, [page]: sources[page].replace('<Modal />', `${button}<Modal />`) };
  const withAria = (await run(files)).facts.filter((fact) => fact.kind === 'action' && fact.handler === 'remove');
  assert.deepEqual(withAria.map((fact) => fact.text), ['Excluir selecionados']);
  assert.equal(withAria[0].ariaLabel, 'Excluir selecionados');
  assert.equal(withAria[0].body, 'Excluir Selecionados (…)');
  assert.equal(withAria[0].title, 'Excluir contatos marcados');
  const withoutAria = (await run({ ...files, [page]: files[page].replace(' aria-label="Excluir selecionados"', '') }))
    .facts.filter((fact) => fact.kind === 'action' && fact.handler === 'remove');
  assert.deepEqual(withoutAria.map((fact) => fact.text), ['Excluir contatos marcados']);
});

test('rótulo JSX cortado não publica ação', async () => {
  for (const label of ['Excluir Selecionados (', 'Excluir Selecionados "']) {
    const files = { ...sources, [page]: sources[page].replace('<Modal />',
      `<button onClick={remove}>${label}</button><Modal />`) };
    assert.equal((await run(files)).facts.some((fact) => fact.kind === 'action' && fact.handler === 'remove'), false);
  }
});

test('função do mesmo arquivo só contribui quando o componente a alcança', async () => {
  const files = { ...sources, [page]: `${sources[page]}\nfunction Unused() { return <button onClick={remove}>Excluir Empresa</button>; }` };
  assert.doesNotMatch(JSON.stringify((await run(files)).facts), /Excluir Empresa/u);
  const rendered = { ...files, [page]: files[page].replace('<Modal />', '<Modal /><Unused />') };
  assert.match(JSON.stringify((await run(rendered)).facts), /Excluir Empresa/u);
});

test('fatos trazem dono e assunto do componente que os renderiza', async () => {
  const result = await run({ ...sources, [modal]: sources[modal].replace('function Modal()', 'function ImportContactsModal()')
    .replace('export default function ImportContactsModal()', 'export default function ImportContactsModal()') });
  const upload = result.facts.find((fact) => fact.kind === 'upload');
  assert.equal(upload.owner, 'ImportContactsModal');
  assert.match(upload.subject, /contato/u);
  assert.match(upload.subject, /importacao/u);
});

test('referência local não renderiza; alias renderizado e chamada em JSX alcançam a função', async () => {
  const base = { ...sources, [page]: `${sources[page]}\nfunction Unused() { return <button onClick={remove}>Excluir Empresa</button>; }` };
  const referenced = { ...base, [page]: base[page].replace('return <><button', 'const X = Unused; return <><button') };
  assert.doesNotMatch(JSON.stringify((await run(referenced)).facts), /Excluir Empresa/u);
  const alias = { ...referenced, [page]: referenced[page].replace('<Modal />', '<Modal /><X />') };
  assert.match(JSON.stringify((await run(alias)).facts), /Excluir Empresa/u);
  const called = { ...base, [page]: base[page].replace('<Modal />', '<Modal />{show && Unused()}') };
  assert.match(JSON.stringify((await run(called)).facts), /Excluir Empresa/u);
});

test('função aninhada só entra quando chamada pelo retorno', async () => {
  const files = { ...sources, [page]: sources[page].replace('return <>',
    'function Unused() { return <button onClick={remove}>Excluir Empresa</button> } return <>') };
  assert.doesNotMatch(JSON.stringify((await run(files)).facts), /Excluir Empresa/u);
  const called = { ...files, [page]: files[page].replace('<Modal />', '<Modal />{Unused()}') };
  assert.match(JSON.stringify((await run(called)).facts), /Excluir Empresa/u);
});

test('JSX local só entra quando referenciado pelo retorno', async () => {
  const files = { ...sources, [page]: sources[page].replace('return <>',
    'const extra = <button onClick={remove}>Excluir Empresa</button>; return <>') };
  assert.doesNotMatch(JSON.stringify((await run(files)).facts), /Excluir Empresa/u);
  const used = { ...files, [page]: files[page].replace('<Modal />', '<Modal />{extra}') };
  assert.match(JSON.stringify((await run(used)).facts), /Excluir Empresa/u);
});

test('plano recebe fatos e conserva todas as perguntas do modelo', async () => {
  const sha = 'a'.repeat(40);
  const fact = { kind: 'action', text: 'Adicionar Contato', owner: 'ContactPage',
    subject: 'contato', source: `${page}:2`, repository: 'ihelpchat/front-react', sha };
  const questions = ['Qual o nome do botão para adicionar contato?', 'Qual é o prazo de cadastro?'];
  let prompt;
  const result = await planContent(new URL('../', import.meta.url).pathname,
    { topic: 'Contato', module: 'Contatos', description: 'Explique como cadastrar.' }, {
      productContext: { groundingRequired: true, code: [{ available: true }], matches: [],
        screenFacts: [fact], support: { categories: [], rules: [] }, coverage: [] },
      client: { responses: { create: async (input) => {
        prompt = input.input;
        return { model: 'fixture', output_text: JSON.stringify({ status: 'needs_information',
          guidance: 'Confirmar botões.', risks: [], suggestedActions: [], grounding: [], questions }) };
      } } },
    });
  assert.deepEqual(result.questions, questions);
  assert.deepEqual(result.discardedQuestions, []);
  assert.match(JSON.stringify(prompt), /FATOS DA TELA/u);
  assert.match(JSON.stringify(prompt), /Adicionar Contato/u);
  assert.match(JSON.stringify(prompt), /não pergunte o que os FATOS DA TELA já respondem; cite o fato/iu);
});

test('import nomeado segue somente cada componente renderizado, inclusive alias', async () => {
  const x = 'src/components/pages/Contacts/X.tsx';
  const named = { ...sources, [page]: `import { Unused, Used } from './X';\nexport default function ContactPage() { return <Used />; }`,
    [x]: `export function Unused() { return <button onClick={remove}>Excluir Empresa</button> }\nexport function Used() { return <button onClick={add}>Adicionar Contato</button> }` };
  const one = (await run(named)).facts;
  assert.match(JSON.stringify(one), /Adicionar Contato/u);
  assert.doesNotMatch(JSON.stringify(one), /Excluir Empresa/u);
  const both = { ...named, [page]: named[page].replace('<Used />', '<><Used /><Unused /></>') };
  assert.match(JSON.stringify((await run(both)).facts), /Excluir Empresa/u);
  const alias = { ...named, [page]: named[page].replace('{ Unused, Used }', '{ Used as U }').replace('<Used />', '<U />') };
  assert.match(JSON.stringify((await run(alias)).facts), /Adicionar Contato/u);
});

test('handler alcançado vincula feedback à ação; sem vínculo não coleta', async () => {
  const live = { ...sources, [page]: `export default function ContactPage() { const save = () => toast.success('Contato criado'); return <button onClick={save}>Salvar</button>; }` };
  const fact = (await run(live)).facts.find((item) => item.kind === 'message' && item.text === 'Contato criado');
  assert.equal(fact?.owner, 'Salvar');
  const detached = { ...live, [page]: live[page].replace('onClick={save}', 'onClick={other}') };
  assert.equal((await run(detached)).facts.some((item) => item.kind === 'message' && item.text === 'Contato criado'), false);
});

test('handler segue chamadas locais até dois níveis, sem trazer JSX', async () => {
  const body = `function third() { toast.success('Três'); } function second() { toast.success('Dois'); third(); } function first() { toast.success('Um'); second(); } const save = () => first();`;
  const files = { ...sources, [page]: `export default function ContactPage() { ${body} return <button onClick={save}>Salvar</button>; }` };
  const messages = (await run(files)).facts.filter((item) => item.kind === 'message').map((item) => item.text);
  assert.deepEqual(messages.sort(), ['Dois', 'Um']);
});

test('eventos inline e useCallback citam confirmação, toast e destino, sem JSX do handler', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    const save = useCallback(() => { toast.success('Salvo'); navigate('/contact/detail'); }, []);
    return <><button onClick={save}>Salvar</button><button onConfirm={() => window.confirm('Excluir contato?')}>Excluir</button></>;
  }` };
  const facts = (await run(files)).facts;
  assert.equal(facts.find((fact) => fact.text === 'Salvo')?.owner, 'Salvar');
  assert.equal(facts.find((fact) => fact.text === 'Excluir contato?')?.owner, 'Excluir');
  assert.equal(facts.find((fact) => fact.kind === 'destination')?.route, '/contact/detail');
});

test('onSubmit com wrapper de formulário segue callback local', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    const save = () => addNotification({ title: 'Sucesso!', description: 'Contato criado' });
    return <form onSubmit={handleSubmit(save)}><button>Salvar</button></form>;
  }` };
  const facts = (await run(files)).facts.filter((fact) => fact.kind === 'message');
  assert.deepEqual(facts.map((fact) => [fact.text, fact.owner]),
    [['Sucesso!', 'Salvar'], ['Contato criado', 'Salvar']]);
});

test('handler só atribui feedback e destino de funções executadas', async () => {
  const body = `const save = () => { const later = () => { toast.success('Falso'); navigate('/private'); }; toast.success('Ok'); };`;
  const files = { ...sources, [page]: `export default function ContactPage() { ${body} return <button onClick={save}>Salvar</button>; }` };
  const facts = (await run(files)).facts;
  assert.equal(facts.some((fact) => fact.kind === 'message' && fact.text === 'Ok' && fact.owner === 'Salvar'), true);
  assert.equal(facts.some((fact) => fact.text === 'Falso' || fact.route === '/private'), false);
  const called = { ...files, [page]: files[page].replace("toast.success('Ok'); };", "later(); toast.success('Ok'); };") };
  const reached = (await run(called)).facts;
  assert.equal(reached.some((fact) => fact.text === 'Falso' && fact.owner === 'Salvar'), true);
  assert.equal(reached.some((fact) => fact.route === '/private' && fact.owner === 'Salvar'), true);
});

test('promise callback executado atribui feedback à ação', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() { const save = () => Promise.resolve().then(() => toast.success('Ok')); return <button onClick={save}>Salvar</button>; }` };
  assert.equal((await run(files)).facts.some((fact) => fact.kind === 'message' && fact.text === 'Ok' && fact.owner === 'Salvar'), true);
});

test('callbacks de timer e mutation são alcançados apenas nas APIs permitidas', async () => {
  const body = `const save = () => { setTimeout(() => toast.success('Timer'), 1); mutate({}, { onSuccess: () => toast.success('Mutation') }); };`;
  const files = { ...sources, [page]: `export default function ContactPage() { ${body} return <button onClick={save}>Salvar</button>; }` };
  const facts = (await run(files)).facts;
  assert.deepEqual(facts.filter((fact) => fact.kind === 'message').map((fact) => fact.text).sort(), ['Mutation', 'Timer']);
  const unknown = { ...files, [page]: files[page].replace('mutate({},', 'register({},') };
  assert.deepEqual((await run(unknown)).facts.filter((fact) => fact.kind === 'message').map((fact) => fact.text), ['Timer']);
});

test('tooltip mais próximo nomeia botão de ícone e liga handler', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() { const handleSave = () => toast.success('Salvo'); return <CustomTooltip title="Salvar"><button onClick={handleSave}><Check /></button></CustomTooltip>; }` };
  const facts = (await run(files)).facts;
  assert.equal(facts.some((fact) => fact.kind === 'action' && fact.text === 'Salvar' && fact.handler === 'handleSave'), true);
  assert.equal(facts.some((fact) => fact.kind === 'message' && fact.text === 'Salvo' && fact.owner === 'Salvar'), true);
  const bare = { ...files, [page]: files[page].replace('<CustomTooltip title="Salvar">', '<>').replace('</CustomTooltip>', '</>') };
  assert.equal((await run(bare)).facts.some((fact) => fact.kind === 'action' && fact.handler === 'handleSave'), false);
});

test('arrow inline não executa função aninhada nem usa chamada interna como handler', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    return <button onClick={() => { const never = () => toast.success('Falso'); }}>Salvar</button>;
  }` };
  const facts = (await run(files)).facts;
  assert.deepEqual(facts.filter((fact) => fact.kind === 'action').map((fact) => [fact.text, fact.handler]),
    [['Salvar', '(inline)']]);
  assert.equal(facts.some((fact) => fact.kind === 'message'), false);
});

test('arrow inline executando toast diretamente atribui feedback à ação', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    return <button onClick={() => { toast.success('Ok'); }}>Salvar</button>;
  }` };
  const facts = (await run(files)).facts;
  assert.deepEqual(facts.filter((fact) => fact.kind === 'action').map((fact) => [fact.text, fact.handler]),
    [['Salvar', '(inline)']]);
  assert.deepEqual(facts.filter((fact) => fact.kind === 'message').map((fact) => [fact.text, fact.owner]),
    [['Ok', 'Salvar']]);
});

test('JSX de função aninhada não executada não vira texto visível', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    return <button onClick={() => { const never = () => <span title="Falso">Oculto</span>; }}>Salvar</button>;
  }` };
  const facts = (await run(files)).facts;
  assert.equal(facts.some((fact) => fact.text === 'Falso' || fact.text === 'Oculto'), false);
  assert.equal(facts.find((fact) => fact.kind === 'action')?.ownerTitle, undefined);
});

test('arrow inline delegando a função local usa o nome e o feedback da função', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    const save = () => toast.success('Ok');
    return <button onClick={() => save()}>Salvar</button>;
  }` };
  const facts = (await run(files)).facts;
  assert.deepEqual(facts.filter((fact) => fact.kind === 'action').map((fact) => [fact.text, fact.handler]),
    [['Salvar', 'save']]);
  assert.deepEqual(facts.filter((fact) => fact.kind === 'message').map((fact) => [fact.text, fact.owner]),
    [['Ok', 'Salvar']]);
});

test('callback map em filho JSX inclui elemento, sem colher feedback da função', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    return <ul>{items.map(i => { const never = () => toast.success('Falso'); return <li title="Nome do contato">{i.nome}</li>; })}</ul>;
  }` };
  const facts = (await run(files)).facts;
  assert.equal(facts.some((fact) => fact.kind === 'text' && fact.text === '…'), false);
  assert.equal(facts.some((fact) => fact.kind === 'message'), false);
  assert.equal(facts.some((fact) => fact.kind === 'text' && fact.text === 'Nome do contato' && fact.property === 'title'), true);
});

test('yup usado pelo formulário define required e mensagem; ausência fica unknown', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    const schema = yup.object({ phone: yup.string().required('Telefone obrigatório') });
    useForm({ resolver: yupResolver(schema) });
    return <form><input name="phone" label="Telefone" /><input name="notes" label="Notas" /></form>;
  }` };
  const fields = (await run(files)).facts.filter((fact) => fact.kind === 'field');
  assert.equal(fields.find((fact) => fact.name === 'phone')?.required, true);
  assert.equal(fields.find((fact) => fact.name === 'phone')?.message, 'Telefone obrigatório');
  assert.equal(fields.find((fact) => fact.name === 'notes')?.required, 'unknown');
  const detached = { ...files, [page]: files[page].replace('yupResolver(schema)', 'yupResolver(other)') };
  assert.equal((await run(detached)).facts.find((fact) => fact.kind === 'field' && fact.name === 'phone')?.required, 'unknown');
});

test('optional explícito é false; zodResolver vincula schema ao campo', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    const schema = z.object({ phone: z.string().optional() });
    useForm({ resolver: zodResolver(schema) });
    return <form><input name="phone" label="Telefone" /></form>;
  }` };
  assert.equal((await run(files)).facts.find((fact) => fact.kind === 'field')?.required, false);
  const required = { ...files, [page]: files[page].replace('z.string().optional()', "z.string().min(1, 'Telefone obrigatório')") };
  assert.equal((await run(required)).facts.find((fact) => fact.kind === 'field')?.required, true);
});

test('Formik validationSchema liga campo; schema solto não liga', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    const schema = yup.object({ phone: yup.string().required('Obrigatório') });
    return <Formik validationSchema={schema}><input name="phone" /></Formik>;
  }` };
  assert.equal((await run(files)).facts.find((fact) => fact.kind === 'field')?.required, true);
  const detached = { ...files, [page]: files[page].replace('validationSchema={schema}', 'validationSchema={other}') };
  assert.equal((await run(detached)).facts.find((fact) => fact.kind === 'field')?.required, 'unknown');
});

test('limite de upload vem do handler executado e não do handler solto', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    const upload = file => { if (file.size > 1048576) alert('Arquivo grande'); };
    return <input type="file" accept=".csv" onChange={upload} />;
  }` };
  assert.equal((await run(files)).facts.find((fact) => fact.kind === 'uploadLimit')?.maxBytes, 1048576);
  const detached = { ...files, [page]: files[page].replace('onChange={upload}', 'onChange={other}') };
  assert.equal((await run(detached)).facts.some((fact) => fact.kind === 'uploadLimit'), false);
});

test('maxSize em prop de upload é limite com dono', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() { return <Dropzone accept=".csv" maxSize={1048576} />; }` };
  const fact = (await run(files)).facts.find((item) => item.kind === 'uploadLimit');
  assert.equal(fact?.maxBytes, 1048576);
  assert.equal(fact?.owner, 'Dropzone');
});

test('schema importado e usado via useFormik define campo; import sem uso não define', async () => {
  const schemaPath = 'src/components/pages/Contacts/schema.ts';
  const files = { ...sources,
    [page]: `import { contactSchema } from './schema'; export default function ContactPage() {
      useFormik({ validationSchema: contactSchema });
      return <form><input name="phone" label="Telefone" /></form>;
    }`,
    [schemaPath]: `export const contactSchema = yup.object({ phone: yup.string().required('Telefone obrigatório') });`,
  };
  const field = (await run(files)).facts.find((fact) => fact.kind === 'field' && fact.name === 'phone');
  assert.equal(field?.required, true);
  assert.equal(field?.validationSource, `${schemaPath}:1`);
  const unused = { ...files, [page]: files[page].replace('validationSchema: contactSchema', 'validationSchema: other') };
  assert.equal((await run(unused)).facts.find((fact) => fact.kind === 'field' && fact.name === 'phone')?.required, 'unknown');
});

test('files[i].size no handler com return define limite', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    const upload = files => { if (files[i].size > 2048) return; };
    return <input type="file" onChange={upload} />;
  }` };
  assert.equal((await run(files)).facts.find((fact) => fact.kind === 'uploadLimit')?.maxBytes, 2048);
});

test('colunas importadas e usadas no formulário preservam required explícito', async () => {
  const mapping = 'src/components/pages/Contacts/mapping.ts';
  const files = { ...sources,
    [page]: `import { SYSTEM_COLUMNS } from './mapping'; export default function ContactPage() { return <form>{SYSTEM_COLUMNS.map(c => <label>{c.label}</label>)}</form>; }`,
    [mapping]: `export const SYSTEM_COLUMNS = [ { key: 'Nome', label: 'Nome', required: true }, { key: 'Email', label: 'E-mail', required: false } ];`,
  };
  const columns = (await run(files)).facts.filter((fact) => fact.kind === 'column');
  assert.deepEqual(columns.map((fact) => [fact.name, fact.text, fact.required]),
    [['Nome', 'Nome', true], ['Email', 'E-mail', false]]);
  const detached = { ...files, [page]: files[page].replace('SYSTEM_COLUMNS.map', 'OTHER_COLUMNS.map') };
  assert.deepEqual((await run(detached)).facts.filter((fact) => fact.kind === 'column'), []);
});

test('Controller rules e required JSX usam evidência explícita', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() { return <form>
    <Controller name="phone" rules={{ required: 'Telefone obrigatório' }} />
    <input name="optional" required={false} />
    <input name="conditional" required={condition} />
  </form>; }` };
  const fields = (await run(files)).facts.filter((fact) => fact.kind === 'field');
  assert.deepEqual(fields.map((fact) => [fact.name, fact.required]),
    [['phone', true], ['optional', false], ['conditional', 'unknown']]);
  assert.equal(fields[0].message, 'Telefone obrigatório');
});

test('limite sem feedback executado nem return não vira fato', async () => {
  const files = { ...sources, [page]: `export default function ContactPage() {
    const upload = file => { if (file.size > 1024) { const never = () => alert('Grande'); } };
    return <input type="file" onChange={upload} />;
  }` };
  assert.equal((await run(files)).facts.some((fact) => fact.kind === 'uploadLimit'), false);
});
