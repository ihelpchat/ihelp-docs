import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { buildServer } from './server.mjs';
import { renderArticle, submitArticle, submitContentPackage } from './content-service.mjs';
import { parseArticle, readArticle } from './editorial-standard.mjs';
import { assertPublicSubmit } from './public-submit-gate.mjs';

const root = await mkdtemp(join(tmpdir(), 'm537-public-gate-'));
const body = 'Abra Contatos no menu lateral. Confira a lista antes de continuar. Selecione a opção de importar. Revise o arquivo escolhido e confirme as colunas. Corrija as linhas inválidas antes de concluir. Aguarde o resultado aparecer na tela. Pesquise um contato recém cadastrado para confirmar o sucesso. Se o contato não aparecer, revise o número e repita apenas a linha corrigida. Este procedimento mantém os demais contatos já cadastrados na conta.';
const article = { path: 'docs/teste/contatos', title: 'Importar contatos', description: 'Passo a passo público para importar contatos no iHelp.', source: 'produto', contentType: 'tutorial', body };
await mkdir(join(root, 'content/docs/docs/teste'), { recursive: true });
await writeFile(join(root, 'content/docs/docs/teste/contatos.mdx'), '# Contatos\n');
const calls = [];
const oldFetch = globalThis.fetch;
const oldToken = process.env.GITHUB_TOKEN;
process.env.GITHUB_TOKEN = 'fixture-token';
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  calls.push({ path, method: init.method ?? 'GET' });
  if (path.includes('/git/ref/heads/')) return { ok: true, json: async () => ({ object: { sha: 'fixture-sha' } }) };
  if (path.endsWith('/pulls')) return { ok: true, json: async () => ({ html_url: 'https://github.com/ihelpchat/ihelp-docs/pull/123' }) };
  if ((init.method ?? 'GET') === 'GET') return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, json: async () => ({}) };
};

const registered = new Map();
const originalRegister = McpServer.prototype.registerTool;
McpServer.prototype.registerTool = function (name, config, callback) {
  registered.set(name, { config, callback });
  return originalRegister.call(this, name, config, callback);
};
try {
  buildServer(root);
  const writers = [...registered].filter(([, { config }]) => config.mutates).map(([name]) => name);
  assert.deepEqual(writers.sort(), ['criar_guia', 'docs_delete_article', 'docs_submit_article', 'docs_submit_package', 'docs_update_article'].sort(), 'nova ferramenta mutates precisa entrar no teste');

  const actionVerbs = ['Clique em', 'Toque em', 'Aperte', 'Selecione', 'Escolha', 'Marque', 'Desmarque', 'Abra', 'Vá em', 'Acesse', 'Ative', 'Desative', 'Preencha', 'Digite em'];
  const rejected = [
    ...actionVerbs.map((verb) => ({ ...article, body: `${body}\n\n${verb} "Botão imaginário" para continuar.` })),
    { ...article, body: `${body}\n\nClique em “Botão imaginário” para continuar.` },
    { ...article, body: `${body}\n\nClique em **Botão imaginário** para continuar.` },
    { ...article, body: `${body}\n\n[Abra a página](/docs/nao-existe-em-lugar-nenhum).` },
    { ...article, body: `${body}\n\n[Abra a página](./nao-existe-em-lugar-nenhum).` },
    { ...article, body: `${body}\n\n[Abra a página](/docs/nao-existe-em-lugar-nenhum#passo).` },
    { ...article, body: `${body}\n\n[Instrução interna](https://intranet.example.test/manual).` },
    { ...article, body: `${body}\n\n[Abra o link](https://evil.example.test/coleta).` },
    { ...article, body: `${body}\n\n![Print de teste](/img/help/print-nao-aprovado.png)` },
    { ...article, body: `${body}\n\nUse template para continuar.` },
    { ...article, body: `${body}\n\nToque no botão **Algo inventado**.` },
    { ...article, body: `${body}\n\nPressione o ícone "Fantasma".` },
    { ...article, body: `${body}\n\nNa tela **Inexistente**, confira.` },
    { ...article, body: `${body}\n\nNo botão **Inventado**, confira.` },
    { ...article, body: `${body}\n\n<a href="/docs/nao-existe">Abra a página</a>.` },
    { ...article, body: `${body}\n\n<Card href="/docs/nao-existe">Abra a página</Card>.` },
    { ...article, body: `${body}\n\n<Link href={variavel}>Abra a página</Link>.` },
    { ...article, body: `${body}\n\n<Card href={'/docs/nao-existe'}>Abra a página</Card>.` },
    { ...article, body: `${body}\n\n[Abra a página](../nao-existe).` },
    { ...article, body: `${body}\n\n<CodeTabs labels={[<a href={'/docs/nao-existe'}>Rota</a>]} />` },
    { ...article, body: `${body}\n\n<Card data={[{ href: '/docs/nao-existe' }]} />` },
    { ...article, body: `${body}\n\n<Card data={{ '/docs/nao-existe': true }} />` },
    { ...article, body: `${body}\n\n<Card href={\`/docs/\${x}\`} />` },
    { ...article, body: `${body}\n\nClique em [**Botão imaginário**](/docs/teste/contatos).` },
    { ...article, body: `${body}\n\nToque no botão [**Algo inventado**](/docs/teste/contatos).` },
    { ...article, body: `${body}\n\nClique em \`Botão imaginário\` para continuar.` },
  ];
  for (const unsafe of rejected) {
    const before = calls.length;
    await assert.rejects(submitContentPackage(root, [unsafe], 'pull_request', 'user:tester'), /gate|fonte|link|print|jargão|aprovad|mapa/i);
    assert.equal(calls.length, before, 'pacote inválido não pode consultar nem escrever no GitHub');
  }

  const validLabel = { ...article, body: `${body}\n\n## Inicio\n\nClique em “IMPORTAR CONTÁTOS” para continuar. [Veja esta página](/docs/teste/contatos#inicio).` };
  const validLabelResult = await submitContentPackage(root, [validLabel], 'pull_request', 'user:tester');
  assert.equal(validLabelResult.status, 'pull_request', 'rótulo aprovado com variação de acento e link existente passa');
  const validJsx = await submitContentPackage(root, [{ ...article, body: `${body}\n\n<Card href={'/docs/teste/contatos'}>Abra a página</Card>.` }], 'pull_request', 'user:tester');
  assert.equal(validJsx.status, 'pull_request', 'atributo JSX com string estática e rota existente passa');
  const validData = await submitContentPackage(root, [{ ...article, body: `${body}\n\n<Card data={{ href: '/docs/teste/contatos', count: -1, enabled: true, empty: null }} />` }], 'pull_request', 'user:tester');
  assert.equal(validData.status, 'pull_request', 'objeto de dados literais e rota existente passa');
  const validApi = await submitContentPackage(root, [{ ...article, path: 'api/teste/contatos', body: `${body}\n\nUse \`contactId\` para identificar o contato.` }], 'pull_request', 'user:tester');
  assert.equal(validApi.status, 'pull_request', 'código inline na referência de API não é rótulo');

  const baselinePath = 'api/crm/automacoes/listar-automacoes';
  const published = await readFile(new URL(`../content/docs/${baselinePath}.mdx`, import.meta.url), 'utf8');
  const parsed = parseArticle(published, baselinePath);
  const renamed = { path: baselinePath, ...parsed.metadata, title: `${parsed.metadata.title} atualizado`, body: parsed.body };
  const beforeRenamed = calls.length;
  await assert.rejects(submitContentPackage(root, [renamed], 'pull_request', 'user:tester'), /gate|rótulo/i);
  assert.equal(calls.length, beforeRenamed, 'título alterado em página legada exige revalidação antes de writes');

  const beforeIndividual = calls.length;
  await assert.rejects(submitArticle(root, rejected[2], 'pull_request', 'user:tester'), /gate|link|aprovad/i);
  assert.equal(calls.length, beforeIndividual, 'submit individual não pode contornar o gate');

  const throughTool = registered.get('docs_submit_article').callback;
  const beforeTool = calls.length;
  const result = await throughTool({ ...rejected[2], mode: 'pull_request', requestedBy: 'user:tester' });
  assert.equal(result.isError, true, 'registro mutates deve rejeitar o bypass pelo submit individual');
  assert.equal(calls.length, beforeTool, 'ferramenta individual não escreve no GitHub');

  const valid = await submitContentPackage(root, [article], 'pull_request', 'user:tester');
  assert.equal(valid.status, 'pull_request', 'pacote público válido passa');
  assert.ok(calls.some(({ path, method }) => path.endsWith('/git/refs') && method === 'POST'));

  const guide = await readArticle(new URL('../', import.meta.url).pathname, 'docs/principais-motivos-de-suporte/reconectar-canal-qr');
  const guideRaw = await readFile(new URL('../content/docs/docs/principais-motivos-de-suporte/reconectar-canal-qr.mdx', import.meta.url), 'utf8');
  const manual = await assertPublicSubmit(root, [{ article: guide, rendered: guideRaw }]);
  assert.deepEqual(manual, { reviewRequired: true, proofStatus: 'manual_required' }, 'prova manual pendente não aprova guia automaticamente');
} finally {
  McpServer.prototype.registerTool = originalRegister;
  globalThis.fetch = oldFetch;
  if (oldToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = oldToken;
}
