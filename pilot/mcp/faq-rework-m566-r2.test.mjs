import test from 'node:test';
import assert from 'node:assert/strict';
import { extractScreenFacts, FRONT_ROUTER } from './front-screen-facts.mjs';
import { missingFreeFaqTaskSteps, validateFreeFaqSections } from './faq-editorial.mjs';

const request = { topic: 'Robô de atendimento', module: 'Robôs',
  details: 'Como criar e editar um robô, como montar o fluxo (mensagens, opções e direcionamento para departamento ou atendente) e como ativar.' };

test('completude cobra montar o fluxo mesmo quando a extração ainda não alcançou o canvas', () => {
  const facts = [{ kind: 'action', text: 'Criar novo robô' }, { kind: 'action', text: 'Publicar' }];
  const tasks = [{ tarefa: 'Criar', passos: [{ text: 'Clique em **Criar novo robô**.' }] },
    { tarefa: 'Editar', passos: [{ text: 'Abra o robô para editar.' }] },
    { tarefa: 'Ativar', passos: [{ text: 'Clique em **Publicar**.' }] }];
  assert.deepEqual(missingFreeFaqTaskSteps(request, facts, tasks), ['tarefa sem passo: montar fluxo']);
});

test('criar o FAQ não vira tarefa de criar o objeto do produto', () => {
  assert.deepEqual(missingFreeFaqTaskSteps({ topic: 'Contatos', description: 'Criar FAQ para cadastrar contatos.' }, [], []),
    ['tarefa sem passo: cadastrar']);
});

test('segue a cadeia de componentes do editor e da janela até os controles visíveis', async () => {
  const files = { [FRONT_ROUTER]: "import Screen from '../../../../pages/Screen'; const pages = [{ path: '/bot', element: <Screen /> }];" };
  const chain = ['src/components/pages/Screen/index.tsx', ...Array.from({ length: 5 }, (_, i) => `src/components/pages/Screen/Layer${i}.tsx`)];
  for (let i = 0; i < chain.length; i++) files[chain[i]] = i === chain.length - 1
    ? 'export default function Layer() { return <><button onClick={add}>Adicionar bloco</button><button onClick={schedule}>Agendar</button></>; }'
    : `import Next from './Layer${i}'; export default function Layer() { return <Next />; }`;
  const result = await extractScreenFacts({ route: '/bot', paths: Object.keys(files), sha: 'a'.repeat(40),
    readSource: async (path) => files[path] });
  assert.ok(result.facts.some((fact) => fact.kind === 'action' && fact.text === 'Adicionar bloco'));
  assert.ok(result.facts.some((fact) => fact.kind === 'action' && fact.text === 'Agendar'));
});

test('segue componente retornado por useMemo e callback de renderização passado ao filho', async () => {
  const files = {
    [FRONT_ROUTER]: "import Screen from '../../../../pages/Screen'; const pages = [{ path: '/bot', element: <Screen /> }];",
    'src/components/pages/Screen/index.tsx': "import Canvas from './Canvas'; import Slot from './Slot'; export default function Screen() { const content = useMemo(() => <Canvas />, []); const renderDialog = () => <Canvas />; return <><div>{content}</div><Slot renderDialog={renderDialog} /></>; }",
    'src/components/pages/Screen/Canvas.tsx': 'export default function Canvas() { return <button onClick={open}>Menu de opções</button>; }',
    'src/components/pages/Screen/Slot.tsx': 'export default function Slot({ renderDialog }) { return <div>{renderDialog()}</div>; }',
  };
  const result = await extractScreenFacts({ route: '/bot', paths: Object.keys(files), sha: 'a'.repeat(40),
    readSource: async (path) => files[path] });
  assert.ok(result.facts.some((fact) => fact.kind === 'action' && fact.text === 'Menu de opções'));
});

test('lê controles dentro do render prop do formulário de agendamento', async () => {
  const files = {
    [FRONT_ROUTER]: "import Screen from '../../../../pages/Screen'; const pages = [{ path: '/contact', element: <Screen /> }];",
    'src/components/pages/Screen/index.tsx': 'export default function Screen() { return <Formik>{() => <><input aria-label="Canal" /><button onClick={save}>Agendar</button></>}</Formik>; }',
  };
  const result = await extractScreenFacts({ route: '/contact', paths: Object.keys(files), sha: 'a'.repeat(40),
    readSource: async (path) => files[path] });
  assert.ok(result.facts.some((fact) => fact.text === 'Canal'));
  assert.ok(result.facts.some((fact) => fact.kind === 'action' && fact.text === 'Agendar'));
});

test('lê opção de exportação dentro do render prop de menu', async () => {
  const files = {
    [FRONT_ROUTER]: "import Screen from '../../../../pages/Screen'; const pages = [{ path: '/contact', element: <Screen /> }];",
    'src/components/pages/Screen/index.tsx': 'export default function Screen() { return <MenuItem>{({ focus }) => <button aria-label="Exportar contatos" onClick={exportContacts}>Exportar Contatos</button>}</MenuItem>; }',
  };
  const result = await extractScreenFacts({ route: '/contact', paths: Object.keys(files), sha: 'a'.repeat(40),
    readSource: async (path) => files[path] });
  assert.ok(result.facts.some((fact) => fact.kind === 'action' && fact.text === 'Exportar contatos'));
});

test('rótulo de passo pode vir de página publicada explicitamente citada', () => {
  const title = 'Como montar um Menu de opções no robô';
  const text = `Consulte [${title}](/docs/sobre-o-sistema/menu-de-opcoes-do-robo) e escolha **Iniciar Fluxo**.`;
  const sections = { passos: [{ tarefa: 'Montar fluxo', passos: [{ text }] }] };
  const context = { request, screenFacts: [], existing: [{ title,
    path: '/docs/sobre-o-sistema/menu-de-opcoes-do-robo', body: 'Clique em **“Iniciar Fluxo”**.' }] };
  assert.equal(validateFreeFaqSections(sections, context).sections.passos.length, 1);
  assert.equal(validateFreeFaqSections(sections, { ...context, existing: [{ ...context.existing[0], body: 'Outro rótulo' }] }).sections.passos.length, 0);
});
