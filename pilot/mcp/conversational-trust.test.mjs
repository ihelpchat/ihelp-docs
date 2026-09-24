import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateContentPackage } from './content-ai-service.mjs';
import { parseAssistantSuggestions } from './conversational-contract.mjs';
import { retrieveContext } from './assistant-service.mjs';

const root = await mkdtemp(join(tmpdir(), 'ihelp-conversation-trust-'));
await mkdir(join(root, 'content/docs/docs/teste'), { recursive: true });
const contactAction = { id: 'importar-contatos', label: 'Abrir a tela Contatos', route: '/contact', target: 'contacts-more-options' };
const robotAction = { id: 'abrir-robos', label: 'Abrir a tela Robôs', route: '/bot', target: 'robots-create' };
const request = { topic: 'Importar contatos', module: 'Contatos', description: 'Ensinar a importar a primeira planilha de contatos.' };
const emptyContext = { matches: [], code: [], support: { categories: [], rules: [] }, coverage: [] };
const body = `Abra Contatos no menu lateral e confira a lista antes de importar a planilha. Use Mais opções para começar a importação.

1. Abra Contatos pelo menu lateral e localize a lista de contatos.

Depois da importação, pesquise um contato da planilha para confirmar que o cadastro aparece na lista. Se a linha não entrar, revise os dados sinalizados e tente importar apenas as linhas corrigidas. Mantenha a planilha original para consultar os valores. O resultado esperado é encontrar o contato na lista do iHelp após concluir a operação. Confira a quantidade de linhas importadas e revise os avisos exibidos na tela antes de repetir qualquer etapa.`;
const article = (action) => ({
  path: 'docs/teste/importar-contatos-trust', title: 'Como importar contatos',
  description: 'Aprenda a importar contatos e conferir o resultado na lista do iHelp.',
  source: 'produto', contentType: 'tutorial', body, productActions: [action],
  assistantQuestion: 'Como importar contatos?',
  assistantOverview: 'Abra Contatos, escolha Importar contatos em Mais opções e confira a planilha antes de concluir.',
  assistantInitialSteps: 1, assistantSuggestions: ['Como corrigir linhas inválidas?'],
});
const ai = (action, suggestedActions) => {
  let calls = 0;
  return {
    get calls() { return calls; },
    responses: { create: async () => {
      calls += 1;
      return { model: 'test', output_text: JSON.stringify(calls === 1
        ? { status: 'ready', guidance: 'Plano pronto.', questions: [], risks: [], suggestedActions }
        : { status: 'ready', summary: 'Pacote pronto.', questions: [], articles: [article(action)] }) };
    } },
  };
};
const rogue = ai(robotAction, [robotAction]);
const noEvidence = await generateContentPackage(root, request, { client: rogue, productContext: emptyContext });
assert.equal(rogue.calls, 2, 'o plano deve vir da própria IA neste probe');
assert.equal(noEvidence.status, 'needs_information', 'plano da IA não confirma ProductAction sozinho');
assert.deepEqual(noEvidence.articles, []);
assert.match(noEvidence.questions.join(' '), /abrir-robos|productActions/);
const contactPlanOnly = await generateContentPackage(root, request, { client: ai(contactAction, [contactAction]), productContext: emptyContext });
assert.equal(contactPlanOnly.status, 'needs_information', 'nem plano coerente substitui evidência determinística');
const explicitRoute = await generateContentPackage(root, { ...request, productRoute: '/contact' }, { client: ai(contactAction, [robotAction]), productContext: emptyContext });
assert.equal(explicitRoute.status, 'ready', 'rota explícita do pedido confirma ação catalogada correspondente');
const matchingCoverage = await generateContentPackage(root, request, { client: ai(contactAction, []), productContext: { ...emptyContext, coverage: [{ module: 'Contatos', productRoutes: ['/contact'] }] } });
assert.equal(matchingCoverage.status, 'ready', 'coverage do módulo confirma a rota');
const otherModuleCoverage = await generateContentPackage(root, request, { client: ai(robotAction, [robotAction]), productContext: { ...emptyContext, coverage: [{ module: 'Robôs', productRoutes: ['/bot'] }] } });
assert.equal(otherModuleCoverage.status, 'needs_information', 'coverage de outro módulo não confirma a ação');

assert.deepEqual(parseAssistantSuggestions('[Cadastro] Como importar contatos?'), ['[Cadastro] Como importar contatos?']);
assert.deepEqual(parseAssistantSuggestions('[Cadastro] Como importar contatos? | Como corrigir linhas inválidas?'), ['[Cadastro] Como importar contatos?', 'Como corrigir linhas inválidas?']);
assert.deepEqual(parseAssistantSuggestions('["Como importar nome | telefone?"]'), ['Como importar nome | telefone?'], 'array JSON válido mantém pipe interno');
assert.deepEqual(parseAssistantSuggestions('[1]'), ['[1]'], 'array JSON inválido para sugestões volta ao legado');
await writeFile(join(root, 'content/docs/docs/teste/legado-colchetes.mdx'), `---\ntitle: "Guia legado de Cadastro"\ndescription: "Guia de cadastro para encontrar orientações de importação."\nassistantSuggestions: "[Cadastro] Como importar contatos?"\n---\n\nAbra Contatos no menu lateral e veja a lista de contatos.\n`);
const legacySource = (await retrieveContext(root, 'Guia legado de Cadastro')).find(({ path }) => path === '/docs/teste/legado-colchetes');
assert.deepEqual(legacySource?.assistantSuggestions, ['[Cadastro] Como importar contatos?']);
console.log('Confiança contextual e fallback legado passaram.');
