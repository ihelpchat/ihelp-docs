import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { createHash } from 'node:crypto';
import { articleSchema } from './article-fields.mjs';
import { auditOperation, deleteArticle, getInventory, isSafeRequestedBy, searchContent, SubmitArticleError, submitArticle, submitContentPackage, validateArticle } from './content-service.mjs';
import { auditContent, readArticle } from './editorial-standard.mjs';
import { generateContentPackage, planContent } from './content-ai-service.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { authorizeTool, requestIdentity } from './access-control.mjs';

const auditTarget = (module, topic) => `sha256:${createHash('sha256').update(`${module}:${topic}`).digest('hex')}`;
const actorTools = new Set(['docs_product_context', 'docs_plan_content', 'docs_generate_package', 'docs_submit_package', 'docs_delete_article', 'docs_update_article', 'docs_submit_article']);
const requestedBySchema = z.string().optional().describe('Ator opcional; se informado, deve coincidir com o ator da credencial');
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
  const registerTool = (name, config, callback) => server.registerTool(name, config, async (args, extra) => {
    const identity = requestIdentity.getStore();
    if (identity) {
      try {
        const actor = authorizeTool(identity, name, args);
        return callback({ ...args, requestedBy: actor }, extra);
      } catch (error) {
        if (error.message === 'requestedBy forged') {
          await auditOperation(root, { actor: identity.actor, operation: name, result: 'forbidden' });
          return textResult({ error: error.message, status: 403 }, true);
        }
        return textResult({ error: error.message }, true);
      }
    }
    if (actorTools.has(name) && !isSafeRequestedBy(args.requestedBy)) return textResult({ error: 'requestedBy inválido para stdio' }, true);
    return callback(args, extra);
  });

  registerTool('docs_inventory', {
    description: 'Mostra cobertura dos módulos reais do iHelp e os gaps prioritários de FAQ/Tango.',
    inputSchema: z.object({}),
  }, async () => textResult(await getInventory(root)));

  registerTool('docs_search', {
    description: 'Busca conteúdo existente antes de criar ou duplicar um FAQ.',
    inputSchema: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(20).default(8) }),
  }, async ({ query, limit }) => textResult({ results: await searchContent(root, query, limit) }));

  registerTool('docs_get_article', {
    description: 'Lê um artigo completo existente para que a IA possa reaproveitar e revisar o conteúdo sem duplicá-lo.',
    inputSchema: z.object({ path: z.string().describe('Caminho sem extensão, começando com docs/, api/, blog/ ou tutoriais/') }),
  }, async ({ path }) => {
    try {
      return textResult(await readArticle(root, path));
    } catch (error) {
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  });

  registerTool('docs_audit_content', {
    description: 'Audita todos os artigos contra o padrão editorial do iHelp sem alterar arquivos.',
    inputSchema: z.object({}),
  }, async () => textResult(await auditContent(root)));

  registerTool('docs_validate_article', {
    description: 'Valida metadados, caminho, conteúdo, Tango e vazamento de credenciais sem gravar nada.',
    inputSchema: articleSchema,
  }, async (article) => textResult(validateArticle(article)));

  registerTool('docs_product_context', {
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

  registerTool('docs_plan_content', {
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

  registerTool('docs_generate_package', {
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

  registerTool('docs_submit_package', {
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

  registerTool('docs_delete_article', {
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

  registerTool('docs_update_article', {
    description: 'Atualiza artigo e meta.json em pull request, sem merge nem deploy.',
    inputSchema: articleSchema.extend({ requestedBy: requestedBySchema }),
  }, async ({ requestedBy, ...article }) => {
    try {
      return textResult(await submitContentPackage(root, [article], 'pull_request', requestedBy));
    } catch (error) {
      return textResult(error instanceof SubmitArticleError ? { error: error.message, code: error.code } : { error: 'Não foi possível atualizar o artigo', code: 'SUBMIT_FAILED' }, true);
    }
  });

  registerTool('docs_submit_article', {
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
