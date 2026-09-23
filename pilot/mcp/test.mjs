import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { answerQuestion, retrieveContext } from './assistant-service.mjs';
import { normalizeFeedback, saveFeedback, summarizeFeedback } from './feedback-service.mjs';
import { renderArticle } from './content-service.mjs';
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

try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['docs_audit_content', 'docs_get_article', 'docs_inventory', 'docs_search', 'docs_submit_article', 'docs_validate_article']);

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
  const faqPath = join(testRoot, 'content/docs/docs/principais-duvidas.mdx');
  const faqOriginal = await readFile(faqPath, 'utf8');
  await writeFile(faqPath, `${faqOriginal}\n[Link quebrado](/docs/pagina-inexistente)\n`);
  const brokenAudit = await client.callTool({ name: 'docs_audit_content', arguments: {} });
  assert.match(brokenAudit.content[0].text, /link interno inexistente/);
  await writeFile(faqPath, faqOriginal);

  const submission = await client.callTool({ name: 'docs_submit_article', arguments: { ...article, mode: 'draft' } });
  assert.match(submission.content[0].text, /"status": "draft"/);
  const written = await readFile(join(testRoot, '.drafts/docs/teste/como-validar-o-mcp.mdx'), 'utf8');
  assert.match(written, /contentType: faq/);

  const unsafe = await client.callTool({ name: 'docs_submit_article', arguments: { ...article, path: '../segredo', mode: 'draft' } });
  assert.equal(unsafe.isError, true);

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
  assert.deepEqual(structured.steps, ['Abra a conversa', 'Clique em Transferir']);
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
