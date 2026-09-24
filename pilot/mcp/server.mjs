import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { createHash } from 'node:crypto';
import { auditOperation, getInventory, isSafeRequestedBy, searchContent, SubmitArticleError, submitArticle, validateArticle } from './content-service.mjs';
import { auditContent, readArticle } from './editorial-standard.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { generateContentPackage, planContent } from './content-ai-service.mjs';

const requestedBySchema = z.string().refine(isSafeRequestedBy, 'requestedBy deve ser um ID opaco user: ou service: sem dados pessoais');
const auditTarget = (module, topic) => `sha256:${createHash('sha256').update(`${module}:${topic}`).digest('hex')}`;

const productActionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  label: z.string().min(3).max(80),
  route: z.string().regex(/^\/(?!\/)[a-z0-9/_-]*$/),
  target: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/).optional(),
});

const articleSchema = z.object({
  path: z.string().describe('Caminho sem extensão, começando com docs/, tutoriais/, api/ ou blog/'),
  title: z.string(),
  description: z.string(),
  source: z.enum(['produto', 'suporte', 'api']),
  contentType: z.enum(['faq', 'tutorial', 'guia', 'referencia']),
  body: z.string().describe('Conteúdo Markdown sem frontmatter'),
  tangoUrl: z.string().url().optional(),
  productActions: z.array(productActionSchema).max(12).optional(),
});

const contentRequestSchema = z.object({
  topic: z.string().min(3).max(120),
  module: z.string().min(2).max(80),
  description: z.string().min(10).max(1_000),
  details: z.string().max(8_000).optional(),
  audience: z.string().max(300).default('Cliente em trial sem treinamento'),
  productRoute: z.string().regex(/^\/(?!\/)[a-z0-9/_-]*$/).optional(),
  tangoUrl: z.string().url().optional(),
  requestedBy: requestedBySchema,
});

const textResult = (value, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  isError,
});

export function buildServer(root = process.env.DOCS_ROOT ?? new URL('../', import.meta.url).pathname) {
  const server = new McpServer(
    { name: 'ihelp-docs', version: '0.1.0' },
    { instructions: 'Consulte a base antes de criar conteúdo. Envie sempre como draft ou pull request; nunca publique credenciais ou dados pessoais.' },
  );

  server.registerTool('docs_inventory', {
    description: 'Mostra cobertura dos módulos reais do iHelp e os gaps prioritários de FAQ/Tango.',
    inputSchema: z.object({}),
  }, async () => textResult(await getInventory(root)));

  server.registerTool('docs_search', {
    description: 'Busca conteúdo existente antes de criar ou duplicar um FAQ.',
    inputSchema: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(20).default(8) }),
  }, async ({ query, limit }) => textResult({ results: await searchContent(root, query, limit) }));

  server.registerTool('docs_get_article', {
    description: 'Lê um artigo completo existente para que a IA possa reaproveitar e revisar o conteúdo sem duplicá-lo.',
    inputSchema: z.object({ path: z.string().describe('Caminho sem extensão, começando com docs/, api/, blog/ ou tutoriais/') }),
  }, async ({ path }) => {
    try {
      return textResult(await readArticle(root, path));
    } catch (error) {
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  });

  server.registerTool('docs_audit_content', {
    description: 'Audita todos os artigos contra o padrão editorial do iHelp sem alterar arquivos.',
    inputSchema: z.object({}),
  }, async () => textResult(await auditContent(root)));

  server.registerTool('docs_validate_article', {
    description: 'Valida metadados, caminho, conteúdo, Tango e vazamento de credenciais sem gravar nada.',
    inputSchema: articleSchema,
  }, async (article) => textResult(validateArticle(article)));

  server.registerTool('docs_product_context', {
    description: 'Consulta código frontend e backend, cobertura editorial e sinais agregados do suporte sem modificar repositórios.',
    inputSchema: z.object({
      topic: z.string().min(3).max(120),
      module: z.string().min(2).max(80),
      requestedBy: requestedBySchema,
    }),
  }, async ({ topic, module, requestedBy }) => {
    const target = auditTarget(module, topic);
    await auditOperation(root, { actor: requestedBy, operation: 'docs_product_context', target, result: 'attempt' });
    try {
      const result = await getIhelpContext(root, topic, module);
      await auditOperation(root, { actor: requestedBy, operation: 'docs_product_context', target, result: result.matches.length ? 'success' : 'unavailable' });
      return textResult(result);
    } catch (error) {
      await auditOperation(root, { actor: requestedBy, operation: 'docs_product_context', target, result: 'failure' });
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  });

  server.registerTool('docs_plan_content', {
    description: 'Planeja FAQ, tutorial e ações com contexto do produto, suporte e documentação; pergunta quando faltam fatos.',
    inputSchema: contentRequestSchema,
  }, async ({ requestedBy, ...request }) => {
    const target = auditTarget(request.module, request.topic);
    await auditOperation(root, { actor: requestedBy, operation: 'docs_plan_content', target, result: 'attempt' });
    try {
      const result = await planContent(root, request);
      await auditOperation(root, { actor: requestedBy, operation: 'docs_plan_content', target, result: result.status });
      return textResult(result);
    } catch (error) {
      await auditOperation(root, { actor: requestedBy, operation: 'docs_plan_content', target, result: 'failure' });
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  });

  server.registerTool('docs_generate_package', {
    description: 'Gera FAQ, tutorial e ações guiadas sem vídeo a partir do plano validado; não escreve arquivos.',
    inputSchema: contentRequestSchema,
  }, async ({ requestedBy, ...request }) => {
    const target = auditTarget(request.module, request.topic);
    await auditOperation(root, { actor: requestedBy, operation: 'docs_generate_package', target, result: 'attempt' });
    try {
      const result = await generateContentPackage(root, request);
      await auditOperation(root, { actor: requestedBy, operation: 'docs_generate_package', target, result: result.status });
      return textResult(result);
    } catch (error) {
      await auditOperation(root, { actor: requestedBy, operation: 'docs_generate_package', target, result: 'failure' });
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  });

  server.registerTool('docs_submit_article', {
    description: 'Envia conteúdo validado como draft local ou abre pull request no GitHub. Nunca faz merge ou deploy.',
    inputSchema: articleSchema.extend({
      mode: z.enum(['draft', 'pull_request']).default('draft'),
      requestedBy: z.string().refine(isSafeRequestedBy, 'requestedBy deve ser um ID opaco user: ou service: sem dados pessoais').describe('ID opaco não sensível, como service:docs-bot; obrigatório para escrita'),
    }),
  }, async ({ mode, requestedBy, ...article }) => {
    try {
      return textResult(await submitArticle(root, article, mode, requestedBy));
    } catch (error) {
      return textResult(error instanceof SubmitArticleError
        ? { error: error.message, code: error.code }
        : { error: 'Não foi possível enviar o artigo', code: 'SUBMIT_FAILED' }, true);
    }
  });

  return server;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  serveStdio(() => buildServer());
}
