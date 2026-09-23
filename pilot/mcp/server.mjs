import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { getInventory, searchContent, submitArticle, validateArticle } from './content-service.mjs';
import { auditContent, readArticle } from './editorial-standard.mjs';

const articleSchema = z.object({
  path: z.string().describe('Caminho sem extensão, começando com docs/, api/ ou blog/'),
  title: z.string(),
  description: z.string(),
  source: z.enum(['produto', 'suporte', 'api']),
  contentType: z.enum(['faq', 'tutorial', 'guia', 'referencia']),
  body: z.string().describe('Conteúdo Markdown sem frontmatter'),
  tangoUrl: z.string().url().optional(),
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

  server.registerTool('docs_submit_article', {
    description: 'Envia conteúdo validado como draft local ou abre pull request no GitHub. Nunca faz merge ou deploy.',
    inputSchema: articleSchema.extend({ mode: z.enum(['draft', 'pull_request']).default('draft') }),
  }, async ({ mode, ...article }) => {
    try {
      return textResult(await submitArticle(root, article, mode));
    } catch (error) {
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  });

  return server;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  serveStdio(() => buildServer());
}
