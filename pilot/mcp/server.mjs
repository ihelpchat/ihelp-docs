import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { createHash } from 'node:crypto';
import { parseAssistantSuggestions } from './conversational-contract.mjs';
import { auditOperation, deleteArticle, getInventory, isSafeRequestedBy, searchContent, SubmitArticleError, submitArticle, submitContentPackage, validateArticle } from './content-service.mjs';
import { auditContent, readArticle } from './editorial-standard.mjs';
import { generateContentPackage, planContent } from './content-ai-service.mjs';
import { getIhelpContext } from './product-context-service.mjs';

const productActionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/).describe('ID estável do guia, como importar-contatos'),
  label: z.string().min(3).max(80),
  route: z.string().regex(/^\/(?!\/)[a-z0-9/_-]*$/).describe('Rota interna do iHelp, como /contact'),
  target: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/).optional().describe('Valor de data-help-id no produto, sem seletor CSS'),
});

const articleSchema = z.looseObject({
  path: z.string().describe('Caminho sem extensão, começando com docs/, tutoriais/, api/ ou blog/'),
  title: z.string(),
  description: z.string(),
  source: z.enum(['produto', 'suporte', 'api']),
  contentType: z.enum(['faq', 'tutorial', 'guia', 'referencia']),
  body: z.string().describe('Conteúdo Markdown sem frontmatter'),
  tangoUrl: z.string().url().optional(),
  productActions: z.array(productActionSchema).max(12).optional(),
  assistantQuestion: z.string().optional().describe('Pergunta canônica que a Claricia deve reconhecer'),
  assistantOverview: z.string().optional().describe('Visão inicial curta para quem acabou de entrar no produto'),
  assistantInitialSteps: z.coerce.number().int().optional().describe('Quantidade de passos concretos iniciais no body, entre 1 e 3'),
  assistantSuggestions: z.union([z.array(z.string()), z.string().transform(parseAssistantSuggestions)]).optional().describe('De 1 a 3 próximas perguntas ou ações distintas'),
});

const auditTarget = (module, topic) => `sha256:${createHash('sha256').update(`${module}:${topic}`).digest('hex')}`;
const requestedBySchema = z.string().refine(isSafeRequestedBy, 'requestedBy deve ser um ID opaco user: ou service: sem dados pessoais').describe('ID opaco não sensível, como user:bruno; obrigatório para IA e escrita');
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
    description: 'Consulta rotas, menus, textos de botões e componentes reais do front-react para fundamentar o conteúdo antes de escrever.',
    inputSchema: z.object({
      topic: z.string().min(3).max(120),
      module: z.string().min(2).max(80),
      requestedBy: requestedBySchema,
    }),
  }, async ({ topic, module, requestedBy }) => {
    await auditOperation(root, { actor: requestedBy, operation: 'docs_product_context', target: auditTarget(module, topic), result: 'attempt' });
    try {
      const result = await getIhelpContext(root, topic, module);
      await auditOperation(root, { actor: requestedBy, operation: 'docs_product_context', target: auditTarget(module, topic), result: result.matches.length ? 'success' : 'unavailable' });
      return textResult(result);
    } catch (error) {
      await auditOperation(root, { actor: requestedBy, operation: 'docs_product_context', target: auditTarget(module, topic), result: 'failure' });
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  });

  server.registerTool('docs_plan_content', {
    description: 'Conversa com a IA editorial: busca duplicidades, aponta informações ausentes, sugere FAQ/tutorial/guia e faz perguntas antes de criar.',
    inputSchema: contentRequestSchema,
  }, async ({ requestedBy, ...request }) => {
    await auditOperation(root, { actor: requestedBy, operation: 'docs_plan_content', target: auditTarget(request.module, request.topic), result: 'attempt' });
    try {
      const result = await planContent(root, request);
      await auditOperation(root, { actor: requestedBy, operation: 'docs_plan_content', target: auditTarget(request.module, request.topic), result: result.status });
      return textResult(result);
    } catch (error) {
      await auditOperation(root, { actor: requestedBy, operation: 'docs_plan_content', target: auditTarget(request.module, request.topic), result: 'failure' });
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  });

  server.registerTool('docs_generate_package', {
    description: 'Gera com IA a estrutura completa sem vídeo: FAQ, tutorial para iniciante, passos guiados, ações no produto e dados de navegação; para e pergunta quando faltam fatos.',
    inputSchema: contentRequestSchema,
  }, async ({ requestedBy, ...request }) => {
    await auditOperation(root, { actor: requestedBy, operation: 'docs_generate_package', target: auditTarget(request.module, request.topic), result: 'attempt' });
    try {
      const result = await generateContentPackage(root, request);
      await auditOperation(root, { actor: requestedBy, operation: 'docs_generate_package', target: auditTarget(request.module, request.topic), result: result.status });
      return textResult(result);
    } catch (error) {
      await auditOperation(root, { actor: requestedBy, operation: 'docs_generate_package', target: auditTarget(request.module, request.topic), result: 'failure' });
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  });

  server.registerTool('docs_submit_package', {
    description: 'Cria ou atualiza MDX e remove artigos em uma PR; atualiza meta.json de navegação. dry_run apenas valida.',
    inputSchema: z.object({
      articles: z.array(articleSchema).max(8).default([]),
      deletes: z.array(z.string()).max(8).default([]),
      mode: z.enum(['dry_run', 'draft', 'pull_request']).default('dry_run'),
      requestedBy: requestedBySchema,
    }),
  }, async ({ articles, deletes, mode, requestedBy }) => {
    try {
      return textResult(await submitContentPackage(root, articles, mode, requestedBy, deletes));
    } catch (error) {
      return textResult(error instanceof SubmitArticleError ? { error: error.message, code: error.code } : { error: 'Não foi possível enviar o pacote', code: 'SUBMIT_FAILED' }, true);
    }
  });

  server.registerTool('docs_delete_article', {
    description: 'Remove um artigo por PR com atualização de meta.json, ou cria um draft de revisão.',
    inputSchema: z.object({
      path: z.string().describe('Caminho sem extensão'),
      mode: z.enum(['draft', 'pull_request']).default('draft'),
      requestedBy: requestedBySchema,
    }),
  }, async ({ path, mode, requestedBy }) => {
    try {
      return textResult(await deleteArticle(root, path, mode, requestedBy));
    } catch (error) {
      return textResult(error instanceof SubmitArticleError ? { error: error.message, code: error.code } : { error: 'Não foi possível registrar a remoção', code: 'DELETE_FAILED' }, true);
    }
  });

  server.registerTool('docs_update_article', {
    description: 'Atualiza artigo e meta.json em pull request, sem merge nem deploy.',
    inputSchema: articleSchema.extend({ requestedBy: requestedBySchema }),
  }, async ({ requestedBy, ...article }) => {
    try {
      return textResult(await submitContentPackage(root, [article], 'pull_request', requestedBy));
    } catch (error) {
      return textResult(error instanceof SubmitArticleError ? { error: error.message, code: error.code } : { error: 'Não foi possível atualizar o artigo', code: 'SUBMIT_FAILED' }, true);
    }
  });

  server.registerTool('docs_submit_article', {
    description: 'Envia conteúdo validado como draft local ou abre pull request no GitHub. Nunca faz merge ou deploy.',
    inputSchema: articleSchema.extend({
      mode: z.enum(['draft', 'pull_request']).default('draft'),
      requestedBy: requestedBySchema,
    }),
  }, async ({ mode, requestedBy, ...article }) => {
    try {
      if (mode === 'pull_request') return textResult(await submitContentPackage(root, [article], mode, requestedBy));
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
