import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { generateContentPackage } from './content-ai-service.mjs';
import { renderArticle, submitArticle, validateArticle } from './content-service.mjs';
import { retrieveContext } from './assistant-service.mjs';
import { auditArticle, parseArticle, readArticle } from './editorial-standard.mjs';

const projectRoot = new URL('../', import.meta.url).pathname;
const root = await mkdtemp(join(tmpdir(), 'ihelp-conversational-'));
await mkdir(join(root, 'content/docs/docs/teste'), { recursive: true });
const body = `Abra Contatos no menu lateral e confirme que a lista de contatos aparece. Use Mais opções para começar a importação de uma planilha.

1. Abra Contatos pelo menu lateral e localize a lista de contatos.
2. Abra Mais opções e escolha Importar contatos para selecionar a planilha.
3. Confira as colunas reconhecidas e corrija as linhas sinalizadas antes de concluir.

Depois da importação, pesquise um contato da planilha para confirmar que o cadastro aparece na lista. Se a linha não entrar, revise os dados sinalizados e tente importar apenas as linhas corrigidas. Mantenha a planilha original para consultar os valores. O resultado esperado é encontrar o contato na lista do iHelp após concluir a operação.`;
const guide = {
  path: 'docs/teste/importar-contatos', title: 'Como importar contatos',
  description: 'Aprenda a importar contatos e conferir o resultado na lista do iHelp.',
  source: 'produto', contentType: 'tutorial', body,
  productActions: [{ id: 'importar-contatos', label: 'Abrir a tela Contatos', route: '/contact', target: 'contacts-more-options' }],
  assistantQuestion: 'Como importar contatos?',
  assistantOverview: 'Abra Contatos, escolha Importar contatos em Mais opções e confira a planilha antes de concluir.',
  assistantInitialSteps: 3,
  assistantSuggestions: ['Como corrigir linhas inválidas?', 'Como confirmar os contatos importados?'],
};
const request = { topic: 'Importar contatos', module: 'Contatos', description: 'Ensinar a importar uma planilha de contatos com segurança.', productRoute: '/contact' };
const aiClient = { responses: { create: async (input) => {
  assert.deepEqual(['assistantQuestion', 'assistantOverview', 'assistantInitialSteps', 'assistantSuggestions'].filter((key) => input.text.format.schema.properties.articles.items.required.includes(key)), ['assistantQuestion', 'assistantOverview', 'assistantInitialSteps', 'assistantSuggestions']);
  assert.match(input.input[0].content, /catálogo|ProductAction/i);
  assert.match(input.input[1].content, /Importar contatos|Contatos/);
  return { model: 'test', output_text: JSON.stringify({ status: 'ready', summary: 'Pronto para revisão.', questions: [], articles: [guide] }) };
} } };
const generated = await generateContentPackage(root, request, {
  client: aiClient, plan: { status: 'ready', guidance: 'Use ações confirmadas.', questions: [], suggestedActions: guide.productActions },
  productContext: { matches: [], code: [], support: { categories: [], rules: [] }, coverage: [] },
});
assert.equal(generated.status, 'ready');
assert.equal(generated.articles.length, 1);
assert.deepEqual(generated.articles[0].assistantSuggestions, guide.assistantSuggestions);
const mdx = renderArticle(generated.articles[0]);
for (const field of ['assistantQuestion', 'assistantOverview', 'assistantInitialSteps', 'assistantSuggestions']) assert.match(mdx, new RegExp(`^${field}:`, 'm'));
assert.deepEqual(parseArticle(mdx, guide.path).metadata.assistantSuggestions, guide.assistantSuggestions.join(' | '));
assert.deepEqual(auditArticle(mdx, guide.path), []);
const contentPath = join(root, 'content/docs', `${guide.path}.mdx`);
await writeFile(contentPath, mdx);
const read = await readArticle(root, guide.path);
assert.equal(read.assistantQuestion, guide.assistantQuestion);
const source = (await retrieveContext(root, guide.assistantQuestion)).find(({ path }) => path === `/${guide.path}`);
assert.equal(source.assistantQuestion, guide.assistantQuestion);
assert.equal(source.assistantOverview, guide.assistantOverview);
assert.equal(source.assistantInitialSteps, 3);
assert.deepEqual(source.assistantSuggestions, guide.assistantSuggestions);
const submitted = await submitArticle(root, { ...guide, path: 'docs/teste/importar-contatos-draft' }, 'draft', 'service:docs-bot');
assert.equal(submitted.status, 'draft');
assert.match(await readFile(join(root, submitted.path), 'utf8'), /assistantSuggestions:/);
const audit = (await readFile(join(root, '.audit/docs-submissions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
assert.deepEqual(audit.map(({ actor, operation, result }) => ({ actor, operation, result })), [
  { actor: 'service:docs-bot', operation: 'docs_submit_article', result: 'attempt' },
  { actor: 'service:docs-bot', operation: 'docs_submit_article', result: 'success' },
]);
for (const [field, value] of [
  ['assistantQuestion', '  '], ['assistantOverview', 'Use.'], ['assistantInitialSteps', 0],
  ['assistantInitialSteps', 4], ['assistantSuggestions', ['Como corrigir linhas inválidas?', 'como corrigir linhas inválidas?']],
  ['assistantSuggestions', ['Contato']],
]) assert.equal(validateArticle({ ...guide, [field]: value }).valid, false, `${field} inválido precisa falhar`);
assert.equal(validateArticle({ ...guide, body: body.replace('3. Confira as colunas reconhecidas e corrija as linhas sinalizadas antes de concluir.', '3. Abra Contatos pelo menu lateral e localize a lista de contatos.') }).valid, false, 'passo duplicado precisa falhar');
assert.equal(validateArticle({ ...guide, body: body.replace('3. Confira as colunas reconhecidas e corrija as linhas sinalizadas antes de concluir.', '') }).valid, false, 'contagem sem passos concretos precisa falhar');
assert.equal(validateArticle({ ...guide, assistantSuggestions: undefined }).valid, false, 'campo explicitamente vazio não pode sumir');
assert.equal(validateArticle({ title: guide.title, description: guide.description, path: guide.path, source: guide.source, contentType: guide.contentType, body }).valid, true, 'artigo antigo sem contrato continua válido');

const transport = new StdioClientTransport({ command: process.execPath, args: [join(projectRoot, 'mcp/server.mjs')], cwd: projectRoot, env: { ...process.env, DOCS_ROOT: root }, stderr: 'pipe' });
const client = new Client({ name: 'conversational-contract-test', version: '1' });
try {
  await client.connect(transport);
  const tool = (await client.listTools()).tools.find(({ name }) => name === 'docs_submit_article');
  for (const field of ['assistantQuestion', 'assistantOverview', 'assistantInitialSteps', 'assistantSuggestions']) assert.ok(tool.inputSchema.properties[field], `${field} precisa entrar no input MCP`);
  const validation = await client.callTool({ name: 'docs_validate_article', arguments: guide });
  assert.equal(JSON.parse(validation.content[0].text).valid, true);
  const bad = await client.callTool({ name: 'docs_validate_article', arguments: { ...guide, assistantQuestion: ' ' } });
  assert.equal(JSON.parse(bad.content[0].text).valid, false);
} finally { await client.close(); }
console.log('Contrato conversacional: geração, validação, MDX, Claricia e audit passaram.');
