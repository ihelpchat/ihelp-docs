import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { answerQuestion, retrieveContext } from './assistant-service.mjs';
import { normalizeFeedback, saveFeedback, summarizeFeedback } from './feedback-service.mjs';
import { renderArticle, submitArticle } from './content-service.mjs';
import { normalizeBody, parseArticle, renderNormalizedArticle } from './editorial-standard.mjs';

const projectRoot = new URL('../', import.meta.url).pathname;
const testRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-mcp-'));
await cp(join(projectRoot, 'architecture'), join(testRoot, 'architecture'), { recursive: true });
await cp(join(projectRoot, 'content'), join(testRoot, 'content'), { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(projectRoot, 'mcp/server.mjs')],
  cwd: projectRoot,
  env: { ...process.env, DOCS_ROOT: testRoot },
  stderr: 'pipe',
});
const client = new Client({ name: 'ihelp-docs-test', version: '1.0.0' });

const article = {
  path: 'docs/teste/como-validar-o-mcp',
  title: 'Como validar o MCP',
  description: 'Passo a passo seguro para validar o MCP de documentação do iHelp.',
  source: 'produto',
  contentType: 'faq',
  body: `Use a ferramenta de validação antes de enviar o conteúdo. Ela confere os metadados, o caminho e as regras básicas de segurança do artigo.

## Como validar

1. Pesquise primeiro se a resposta já existe na documentação.
2. Carregue o artigo completo quando a intenção for revisar uma página atual.
3. Escreva a resposta direta antes dos detalhes e preserve somente fatos confirmados.
4. Adicione texto alternativo a todas as imagens e remova qualquer dado pessoal.
5. Valide o artigo e corrija todos os apontamentos antes do envio.

O conteúdo aprovado deve seguir para um draft ou pull request. Confira títulos, links, permissões e resultado esperado durante a revisão humana; o MCP nunca faz merge ou deploy automaticamente.`,
};
const auditFile = join(testRoot, '.audit/docs-submissions.jsonl');
const auditEvents = async () => (await readFile(auditFile, 'utf8')).trim().split('\n').map(JSON.parse);

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['docs_audit_content', 'docs_get_article', 'docs_inventory', 'docs_product_context', 'docs_search', 'docs_submit_article', 'docs_validate_article']);

  const validation = await client.callTool({ name: 'docs_validate_article', arguments: article });
  assert.match(validation.content[0].text, /"valid": true/);

  const weakValidation = await client.callTool({
    name: 'docs_validate_article',
    arguments: { ...article, body: 'Resposta curta demais.', description: 'Descrição curta.' },
  });
  assert.match(weakValidation.content[0].text, /60 palavras/);
  assert.match(weakValidation.content[0].text, /40 caracteres/);
  const normalizedFaq = normalizeBody('## Como acesso o iHelp?\n\nUse suas credenciais.', 'FAQ', 'Respostas para dúvidas frequentes de acesso ao iHelp.', 'docs/principais-duvidas');
  assert.match(normalizedFaq, /^### Como acesso o iHelp\?/m);
  assert.doesNotMatch(normalizedFaq, /Respostas para dúvidas frequentes/);
  const quotedArticle = `---\ntitle: "Benefícios"\ndescription: "Veja uma opção \\"melhorada\\" para organizar o atendimento no iHelp."\nsource: produto\ncontentType: guia\n---\n\nEste conteúdo explica uma opção melhorada para organizar o atendimento sem alterar os fatos do produto. Ele também apresenta as decisões e os cuidados necessários para aplicar a orientação com segurança na rotina da equipe.`;
  const normalizedQuoted = renderNormalizedArticle(parseArticle(quotedArticle, 'docs/teste/beneficios'));
  assert.match(normalizedQuoted, /description: "Veja uma opção \\"melhorada\\"/);
  assert.equal(renderNormalizedArticle(parseArticle(normalizedQuoted, 'docs/teste/beneficios')), normalizedQuoted, 'normalização precisa ser idempotente');
  assert.doesNotMatch(normalizeBody('## Etapa\r\n\r\nTexto com espaço. \r\n', 'Teste', 'Descrição completa para testar finais de linha legados.'), /[ \t\r]+$/m);

  const inventory = await client.callTool({ name: 'docs_inventory', arguments: {} });
  assert.match(inventory.content[0].text, /"modules": 22/);

  const search = await client.callTool({ name: 'docs_search', arguments: { query: 'transferir atendimento' } });
  assert.match(search.content[0].text, /Atendimento/);

  const existing = await client.callTool({ name: 'docs_get_article', arguments: { path: 'docs/sobre-o-sistema/atendimento' } });
  assert.match(existing.content[0].text, /Como transferir um atendimento/);

  const audit = await client.callTool({ name: 'docs_audit_content', arguments: {} });
  const articleCount = (await readdir(join(testRoot, 'content/docs'), { recursive: true })).filter((path) => path.endsWith('.mdx')).length;
  assert.equal(JSON.parse(audit.content[0].text).total, articleCount);
  assert.equal((await client.listTools()).tools.find((tool) => tool.name === 'docs_submit_article').inputSchema.required.includes('requestedBy'), true);
  const faqPath = join(testRoot, 'content/docs/docs/principais-duvidas.mdx');
  const faqOriginal = await readFile(faqPath, 'utf8');
  await writeFile(faqPath, `${faqOriginal}\n[Link quebrado](/docs/pagina-inexistente)\n`);
  const brokenAudit = await client.callTool({ name: 'docs_audit_content', arguments: {} });
  assert.match(brokenAudit.content[0].text, /link interno inexistente/);
  await writeFile(faqPath, faqOriginal);

  const missingActor = await client.callTool({ name: 'docs_submit_article', arguments: { ...article, mode: 'draft' } });
  assert.equal(missingActor.isError, true);
  const invalidActor = await client.callTool({ name: 'docs_submit_article', arguments: { ...article, mode: 'draft', requestedBy: 'bruno@example.com' } });
  assert.equal(invalidActor.isError, true);
  const secretActor = await client.callTool({ name: 'docs_submit_article', arguments: { ...article, mode: 'draft', requestedBy: 'sk-test-secret' } });
  assert.equal(secretActor.isError, true);
  const submission = await client.callTool({ name: 'docs_submit_article', arguments: { ...article, mode: 'draft', requestedBy: 'service:docs-bot' } });
  assert.deepEqual(JSON.parse(submission.content[0].text), { status: 'draft', path: '.drafts/docs/teste/como-validar-o-mcp.mdx' });
  const written = await readFile(join(testRoot, '.drafts/docs/teste/como-validar-o-mcp.mdx'), 'utf8');
  assert.match(written, /contentType: faq/);

  const unsafe = await client.callTool({ name: 'docs_submit_article', arguments: { ...article, path: '../segredo', mode: 'draft', requestedBy: 'service:docs-bot' } });
  assert.equal(unsafe.isError, true);
  const duplicate = await client.callTool({ name: 'docs_submit_article', arguments: { ...article, mode: 'draft', requestedBy: 'service:docs-bot' } });
  assert.equal(duplicate.isError, true);
  assert.doesNotMatch(duplicate.content[0].text, new RegExp(testRoot));
  assert.match(duplicate.content[0].text, /DRAFT_EXISTS/);
  const pullRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-pr-audit-'));
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'fake-test-token';
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return { ok: true, json: async () => requestCount === 1 ? { object: { sha: 'test-sha' } } : requestCount === 4 ? { html_url: 'https://github.com/ihelpchat/ihelp-docs/pull/123' } : {} };
  };
  try {
    const pull = await submitArticle(pullRoot, article, 'pull_request', 'service:docs-bot');
    assert.deepEqual(Object.keys(pull).sort(), ['branch', 'filePath', 'status', 'url']);
    assert.equal(pull.status, 'pull_request');
    assert.equal(pull.url, 'https://github.com/ihelpchat/ihelp-docs/pull/123');
    assert.equal(requestCount, 4);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
  const entries = [...await auditEvents(), ...(await readFile(join(pullRoot, '.audit/docs-submissions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)];
  assert.deepEqual(entries.map(({ result }) => result), ['attempt', 'success', 'attempt', 'failure', 'attempt', 'failure', 'attempt', 'external_request', 'success']);
  assert.deepEqual(entries.map(({ target }) => target), [article.path, article.path, null, null, article.path, article.path, article.path, article.path, article.path]);
  assert.match(entries[7].reference, /^docs\/ia-como-validar-o-mcp-\d+$/);
  for (const entry of entries) {
    assert.equal(entry.actor, 'service:docs-bot');
    assert.equal(entry.operation, 'docs_submit_article');
    assert.match(entry.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  }
  const rawAudit = JSON.stringify(entries);
  assert.doesNotMatch(rawAudit, /Use a ferramenta de validação|fake-test-token|bruno@example.com|sk-test-secret/);

  const directRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-direct-'));
  await assert.rejects(submitArticle(directRoot, { ...article, path: 'docs/teste/sem-ator' }, 'draft'), /requestedBy/);
  await assert.rejects(readFile(join(directRoot, '.drafts/docs/teste/sem-ator.mdx')));
  const externalDraftRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-external-'));
  const symlinkRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-symlink-'));
  await symlink(externalDraftRoot, join(symlinkRoot, '.drafts'));
  await assert.rejects(submitArticle(symlinkRoot, article, 'draft', 'service:docs-bot'), /draft|symlink|path/i);
  await assert.rejects(readFile(join(externalDraftRoot, `${article.path}.mdx`)));
  assert.deepEqual((await readFile(join(symlinkRoot, '.audit/docs-submissions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).map(({ result }) => result), ['attempt', 'failure']);

  const failRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-pr-failure-'));
  const priorFetch = globalThis.fetch;
  const priorToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'fake-test-token';
  let pullsCreated = 0;
  let postedBody;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/pulls')) {
      pullsCreated += 1;
      postedBody = JSON.parse(init.body).body;
      await chmod(join(failRoot, '.audit/docs-submissions.jsonl'), 0o400);
      return { ok: true, json: async () => ({ html_url: 'https://github.com/ihelpchat/ihelp-docs/pull/456' }) };
    }
    return { ok: true, json: async () => String(url).includes('/git/ref/') ? { object: { sha: 'test-sha' } } : {} };
  };
  try {
    await assert.rejects(submitArticle(failRoot, article, 'pull_request', 'service:docs-bot'), /github\.com\/ihelpchat\/ihelp-docs\/pull\/456/);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = priorToken;
  }
  assert.equal(pullsCreated, 1);
  assert.match(postedBody, /service:docs-bot/);
  assert.match(postedBody, /docs_submit_article/);
  assert.match(postedBody, /docs\/teste\/como-validar-o-mcp/);
  assert.match(postedBody, /\d{4}-\d\d-\d\dT.*Z/);
  assert.doesNotMatch(postedBody, /Use a ferramenta de validação|fake-test-token/);
  const failureEvents = (await readFile(join(failRoot, '.audit/docs-submissions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(failureEvents.map(({ result }) => result), ['attempt', 'external_request']);
  assert.equal(failureEvents[1].actor, 'service:docs-bot');
  assert.equal(failureEvents[1].target, article.path);
  assert.equal(failureEvents[1].operation, 'docs_submit_article');
  assert.match(failureEvents[1].at, /^\d{4}-\d\d-\d\dT.*Z$/);

  const remoteErrorRoot = await mkdtemp(join(tmpdir(), 'ihelp-docs-remote-error-'));
  const savedFetch = globalThis.fetch;
  const savedToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'fake-test-token';
  globalThis.fetch = async () => ({ ok: false, status: 422, text: async () => 'token=secret-from-provider' });
  try {
    await assert.rejects(submitArticle(remoteErrorRoot, article, 'pull_request', 'service:docs-bot'), (error) => {
      assert.doesNotMatch(error.message, /secret-from-provider|token=/);
      assert.match(error.message, /GitHub API 422/);
      return true;
    });
  } finally {
    globalThis.fetch = savedFetch;
    if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedToken;
  }
  const mockFetchFile = join(await mkdtemp(join(tmpdir(), 'ihelp-docs-fetch-')), 'mock.mjs');
  await writeFile(mockFetchFile, `import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
globalThis.fetch = async (url) => {
  if (process.env.MOCK_GITHUB_OUTCOME === '422') return { ok: false, status: 422, text: async () => 'token=secret-from-provider' };
  if (String(url).endsWith('/pulls')) {
    await chmod(join(process.env.DOCS_ROOT, '.audit/docs-submissions.jsonl'), 0o400);
    return { ok: true, json: async () => ({ html_url: 'https://github.com/ihelpchat/ihelp-docs/pull/789' }) };
  }
  return { ok: true, json: async () => String(url).includes('/git/ref/') ? { object: { sha: 'test-sha' } } : {} };
};`);
  for (const outcome of ['422', 'created']) {
    const root = await mkdtemp(join(tmpdir(), 'ihelp-docs-tool-error-'));
    const mockedTransport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', mockFetchFile, join(projectRoot, 'mcp/server.mjs')],
      cwd: projectRoot,
      env: { ...process.env, DOCS_ROOT: root, GITHUB_TOKEN: 'fake-test-token', MOCK_GITHUB_OUTCOME: outcome },
      stderr: 'pipe',
    });
    const mockedClient = new Client({ name: `ihelp-docs-error-${outcome}`, version: '1.0.0' });
    try {
      await mockedClient.connect(mockedTransport);
      const result = await mockedClient.callTool({ name: 'docs_submit_article', arguments: { ...article, mode: 'pull_request', requestedBy: 'service:docs-bot' } });
      assert.equal(result.isError, true);
      assert.doesNotMatch(result.content[0].text, /secret-from-provider|token=/);
      assert.doesNotMatch(result.content[0].text, new RegExp(root));
      if (outcome === '422') assert.match(result.content[0].text, /GITHUB_HTTP_ERROR/);
      else assert.match(result.content[0].text, /github\.com\/ihelpchat\/ihelp-docs\/pull\/789/);
    } finally {
      await mockedClient.close();
    }
  }

  const context = await retrieveContext(testRoot, 'como transferir um atendimento');
  assert.match(context[0].title, /Atendimento/);
  const fakeClient = {
    responses: {
      create: async (request) => {
        assert.equal(request.store, false);
        assert.match(request.input[1].content, /Atendimento/);
        return { output_text: 'Abra o atendimento e use a opção de transferência.\n\nFontes: Atendimento (/docs/sobre-o-sistema/atendimento)', model: 'gpt-test' };
      },
    },
  };
  const assistant = await answerQuestion(testRoot, 'como transferir um atendimento', { client: fakeClient });
  assert.equal(assistant.model, 'gpt-test');
  assert.match(assistant.answer, /transferência/);
  // Resposta estruturada: passos, código e fontes; fonte fora da recuperação local é descartada.
  const structuredClient = {
    responses: {
      create: async (request) => {
        assert.equal(request.text.format.type, 'json_schema');
        assert.match(request.input[0].content, /Esta página|esta página/);
        assert.match(request.input[0].content, /Nunca diga.*documentação não explica/);
        return {
          model: 'gpt-test',
          output_text: JSON.stringify({
            answer: 'Abra a conversa e transfira.',
            sections: [{ title: 'Antes de começar', items: ['Confirme o departamento de destino'] }],
            steps: ['Abra a conversa', 'Clique em Transferir'],
            code: null,
            sources: ['/docs/sobre-o-sistema/atendimento', '/docs/pagina-inventada'],
            suggestions: ['Como reabrir?'],
            resolution: 'partial',
            found: true,
          }),
        };
      },
    },
  };
  const structured = await answerQuestion(testRoot, 'como transferir', {
    client: structuredClient,
    scope: 'Ajuda e FAQ',
    page: { path: '/docs/sobre-o-sistema/atendimento', title: 'Atendimento' },
  });
  assert.deepEqual(structured.steps, [{ text: 'Abra a conversa' }, { text: 'Clique em Transferir' }]);
  assert.deepEqual(structured.sections, [{ title: 'Antes de começar', items: ['Confirme o departamento de destino'] }]);
  assert.equal(structured.resolution, 'partial');
  assert.deepEqual(structured.sources.map((source) => source.path), ['/docs/sobre-o-sistema/atendimento']);
  assert.equal(structured.sources[0].kind, 'Ajuda');
  assert.deepEqual(structured.sources[0].media, { kind: 'video', url: '/videos/atendimento.mp4', embedUrl: '/videos/atendimento.mp4' });
  assert.equal(structured.sources[0].path, '/docs/sobre-o-sistema/atendimento', 'URL inventada não vira CTA');

  const mediaDir = join(testRoot, 'content/docs/docs/teste');
  await mkdir(mediaDir, { recursive: true });
  await writeFile(join(mediaDir, 'claricia-tango.mdx'), `---\ntitle: "Guia Claricia Tango"\ndescription: "Guia de teste da mídia real."\n---\n<TutorialCard title="Fluxo" url="https://app.tango.us/app/workflow/Fluxo-586c4a6cabce4edd8032e657bf2979ae" embedUrl="https://app.tango.us/app/embed/586c4a6cabce4edd8032e657bf2979ae" />\n`);
  await writeFile(join(mediaDir, 'claricia-sem-midia.mdx'), `---\ntitle: "Guia Claricia Sem Mídia"\ndescription: "Guia de teste sem vídeo."\n---\nResposta completa sem vídeo.\n`);
  await writeFile(join(mediaDir, 'claricia-url-insegura.mdx'), `---\ntitle: "Guia Claricia URL Insegura"\ndescription: "Guia de teste da URL."\n---\n<VideoEmbed url="javascript:alert(1)" />\n`);
  const mediaClient = (path) => ({ responses: { create: async () => ({ model: 'gpt-test', output_text: JSON.stringify({ answer: 'Consulte o guia.', sources: [path, 'https://evil.example/falso'], resolution: 'partial', found: true }) }) } });
  const tangoReply = await answerQuestion(testRoot, 'Guia Claricia Tango', { client: mediaClient('/docs/teste/claricia-tango') });
  assert.deepEqual(tangoReply.sources.map((source) => source.path), ['/docs/teste/claricia-tango']);
  assert.deepEqual(tangoReply.sources[0].media, { kind: 'tango', url: 'https://app.tango.us/app/workflow/Fluxo-586c4a6cabce4edd8032e657bf2979ae', embedUrl: 'https://app.tango.us/app/embed/586c4a6cabce4edd8032e657bf2979ae' });
  assert.equal(tangoReply.resolution, 'partial');
  const plainReply = await answerQuestion(testRoot, 'Guia Claricia Sem Mídia', { client: mediaClient('/docs/teste/claricia-sem-midia') });
  assert.equal(plainReply.sources[0].media, undefined);
  const unsafeReply = await answerQuestion(testRoot, 'Guia Claricia URL Insegura', { client: mediaClient('/docs/teste/claricia-url-insegura') });
  assert.equal(unsafeReply.sources[0].media, undefined);
  const tellaPath = '/docs/primeiros-passos/acessando-a-plataforma';
  const tellaReply = await answerQuestion(testRoot, 'Como acessar a plataforma?', {
    client: mediaClient(tellaPath),
    page: { path: tellaPath, title: 'Acessando a Plataforma' },
  });
  assert.deepEqual(tellaReply.sources.map((source) => source.path), [tellaPath]);
  assert.deepEqual(tellaReply.sources[0].media, {
    kind: 'video',
    url: 'https://www.tella.tv/video/faq-como-alterar-sua-senha-no-ihelp-1-8jwf',
    embedUrl: 'https://www.tella.tv/video/faq-como-alterar-sua-senha-no-ihelp-1-8jwf/embed',
  });
  const apiScoped = await retrieveContext(testRoot, 'mensagem', 6, { scope: 'API' });
  assert.ok(apiScoped.length && apiScoped.every((source) => source.path.startsWith('/api')));

  const feedbackFile = join(testRoot, 'feedback', 'events.jsonl');
  assert.throws(() => normalizeFeedback({ type: 'article', value: 'talvez', path: '/docs' }), /Feedback inválido/);
  await saveFeedback(feedbackFile, { eventId: 'evt-1', type: 'article', value: 'up', path: '/docs/atendimento' });
  await saveFeedback(feedbackFile, { eventId: 'evt-2', type: 'assistant', value: 'down', path: '/assistente', question: 'Como reconecto?' });
  await saveFeedback(feedbackFile, { eventId: 'evt-2', type: 'assistant', value: 'up', path: '/assistente', question: 'Como reconecto?' });
  const feedbackSummary = await summarizeFeedback(feedbackFile);
  assert.equal(feedbackSummary.total, 2);
  assert.equal(feedbackSummary.positiveRate, 100);
  assert.deepEqual(feedbackSummary.byType.assistant, { up: 1, down: 0 });

  // Barra de continuação dentro de bloco de código não pode virar quebra de parágrafo.
  const curlBody = 'Texto\\\nquebra\n\n```bash\ncurl -X POST https://exemplo \\\n  -H "a: b"\n```\n';
  assert.match(normalizeBody(curlBody, 'Título', 'Descrição', '/api/teste'), /https:\/\/exemplo \\\n {2}-H/);

  const withTango = renderArticle({ ...article, tangoUrl: 'https://app.tango.us/app/embed/c547fbf6-a68a-4f30-9cf4-bbf79f6f65d1' });
  assert.match(withTango, /app\/workflow\/Como-validar-o-MCP-c547fbf6a68a4f309cf4bbf79f6f65d1/);
  assert.doesNotMatch(withTango, /embedUrl=/);
  const workflowUrl = 'https://app.tango.us/app/workflow/Como-validar-o-MCP-c547fbf6a68a4f309cf4bbf79f6f65d1';
  assert.match(renderArticle({ ...article, tangoUrl: workflowUrl }), new RegExp(workflowUrl));
  console.log('MCP smoke passou: inventário, busca, validação, draft, bloqueio de path e contexto do assistente.');
} finally {
  await client.close();
}
