import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { answerQuestion, retrieveContext } from './assistant-service.mjs';
import { generateContentPackage } from './content-ai-service.mjs';
import { renderArticle, validateArticle } from './content-service.mjs';
import { auditArticle, parseArticle, readArticle } from './editorial-standard.mjs';

const root = await mkdtemp(join(tmpdir(), 'ihelp-conversation-rework-'));
await mkdir(join(root, 'content/docs/docs/teste'), { recursive: true });
const body = `Abra Contatos no menu lateral e confira a lista antes de importar a planilha. Use Mais opções para começar a importação.

1. Abra Contatos pelo menu lateral e localize a lista de contatos.
2. Abra Mais opções e escolha Importar contatos para selecionar a planilha.
3. Confira as colunas reconhecidas e corrija as linhas sinalizadas antes de concluir.

Depois da importação, pesquise um contato da planilha para confirmar que o cadastro aparece na lista. Se a linha não entrar, revise os dados sinalizados e tente importar apenas as linhas corrigidas. Mantenha a planilha original para consultar os valores. O resultado esperado é encontrar o contato na lista do iHelp após concluir a operação.`;
const contactAction = { id: 'importar-contatos', label: 'Abrir a tela Contatos', route: '/contact', target: 'contacts-more-options' };
const robotAction = { id: 'abrir-robos', label: 'Abrir a tela Robôs', route: '/bot', target: 'robots-create' };
const suggestions = ['Como importar nome | telefone na planilha?', 'Como corrigir linhas inválidas?', 'Como confirmar os contatos importados?'];
const article = {
  path: 'docs/teste/importar-contatos-rework', title: 'Como importar contatos',
  description: 'Aprenda a importar contatos e conferir o resultado na lista do iHelp.',
  source: 'produto', contentType: 'tutorial', body,
  productActions: [contactAction],
  assistantQuestion: 'Como criar uma lista de contatos?',
  assistantOverview: 'Abra Contatos, escolha Importar contatos em Mais opções e confira a planilha antes de concluir.',
  assistantInitialSteps: 3, assistantSuggestions: suggestions,
};
assert.equal(validateArticle(article).valid, true);
const mdx = renderArticle(article);
assert.deepEqual(auditArticle(mdx, article.path), [], 'round-trip válido também deve passar auditoria');
assert.deepEqual((await (async () => {
  await writeFile(join(root, 'content/docs', `${article.path}.mdx`), mdx);
  return retrieveContext(root, article.assistantQuestion);
})()).find(({ path }) => path === `/${article.path}`).assistantSuggestions, suggestions, 'pipe interno não pode dividir sugestão');
const read = await readArticle(root, article.path);
assert.deepEqual(JSON.parse(read.assistantSuggestions), suggestions, 'leitura MDX precisa preservar a lista integral');
assert.equal(parseArticle(mdx, article.path).metadata.assistantSuggestions, JSON.stringify(suggestions));
const legacy = mdx.replace(/^assistantSuggestions: .*$/m, 'assistantSuggestions: "Como corrigir linhas inválidas? | Como confirmar os contatos importados?"');
assert.deepEqual((await (async () => {
  await writeFile(join(root, 'content/docs/docs/teste/legacy.mdx'), legacy);
  return retrieveContext(root, article.assistantQuestion);
})()).find(({ path }) => path === '/docs/teste/legacy').assistantSuggestions, suggestions.slice(1), 'frontmatter antigo continua legível');
const invalidMdx = mdx.replace(/^assistantSuggestions: .*$/m, 'assistantSuggestions: "Como corrigir linhas inválidas? | como corrigir linhas inválidas?"');
assert.match(auditArticle(invalidMdx, article.path).join(' '), /assistantSuggestions/, 'auditoria precisa rejeitar sugestões duplicadas');

const request = { topic: 'Importar contatos', module: 'Contatos', description: 'Ensinar a importar a primeira planilha de contatos.', productRoute: '/contact' };
const context = { matches: [], code: [], support: { categories: [], rules: [] }, coverage: [] };
const model = (productActions) => ({ responses: { create: async () => ({ model: 'test', output_text: JSON.stringify({ status: 'ready', summary: 'Pronto.', questions: [], articles: [{ ...article, productActions }] }) }) } });
const noApproval = await generateContentPackage(root, request, { client: model([robotAction]), plan: { status: 'ready', suggestedActions: [] }, productContext: context });
assert.equal(noApproval.status, 'needs_information', 'catálogo sozinho não confirma ação para este pedido');
assert.deepEqual(noApproval.articles, []);
assert.match(noApproval.questions.join(' '), /productActions|ação|confirmad/i);
const approved = await generateContentPackage(root, request, { client: model([contactAction]), plan: { status: 'ready', suggestedActions: [contactAction] }, productContext: context });
assert.equal(approved.status, 'ready');
assert.deepEqual(approved.articles[0].productActions, [contactAction]);

const reply = await answerQuestion(root, article.assistantQuestion, { client: { responses: { create: async () => ({ model: 'test', output_text: JSON.stringify({ answer: 'Abra Contatos para começar.', sections: [], steps: [], code: null, sources: [`/${article.path}`], suggestions: [], resolution: 'complete', found: true }) }) } } });
assert.ok(reply.suggestions.includes('Pode me guiar etapa por etapa'), 'guia progressivo precisa permanecer');
for (const suggestion of suggestions) assert.ok(reply.suggestions.includes(suggestion), `sugestão editorial ausente: ${suggestion}`);
const source = await readFile(join(new URL('../', import.meta.url).pathname, 'lib/assistant.ts'), 'utf8');
const catalog = JSON.parse(await readFile(join(new URL('../', import.meta.url).pathname, 'architecture/product-actions.json'), 'utf8'));
const compiled = ts.transpileModule(source.replace("import allowedActions from '@/architecture/product-actions.json';", `const allowedActions = ${JSON.stringify(catalog)};`).replace("from '../architecture/catalog-action.mjs'", `from '${new URL('../architecture/catalog-action.mjs', import.meta.url).href}'`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { normalizeReply } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const uiReply = normalizeReply(reply);
for (const suggestion of suggestions) assert.ok(uiReply.suggestions.includes(suggestion), `UI descartou: ${suggestion}`);
assert.ok(uiReply.suggestions.includes('Pode me guiar etapa por etapa'));
console.log('Rework conversacional: pipe, autorização contextual, auditoria e sugestões até a UI passaram.');
