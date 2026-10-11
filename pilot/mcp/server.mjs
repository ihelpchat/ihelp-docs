import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { createHash } from 'node:crypto';
import { articleSchema } from './article-fields.mjs';
import { auditOperation, deleteArticle, getInventory, isSafeRequestedBy, searchContent, SubmitArticleError, submitArticle, submitContentPackage, validateArticle } from './content-service.mjs';
import { auditContent, readArticle } from './editorial-standard.mjs';
import { generateContentPackage, planContent } from './content-ai-service.mjs';
import { getIhelpContext, publicProductContext } from './product-context-service.mjs';
import { authorizeTool, registerToolPolicy, requestIdentity } from './access-control.mjs';
import { createGuide } from './create-guide.mjs';
import { atualizarPorDeploy } from './update-by-deploy.mjs';
import { refreshCodeProduct } from './code-refresh-offer.mjs';
import { captureFailureCategory, captureFailureLog } from './capture-diagnostics.mjs';
import { installCaptureRejectionSafety } from './capture-process-safety.mjs';
import { syncBusinessContext } from './business-context-sync.mjs';
import { envCompatibility } from './env-compat.mjs';

const auditTarget = (module, topic) => `sha256:${createHash('sha256').update(`${module}:${topic}`).digest('hex')}`;
let journeyRunning = false;
let journeyGate = Promise.resolve();
async function withJourneyGate(operation) {
  const previous = journeyGate;
  let release;
  journeyGate = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await operation(); } finally { release(); }
}
const probeCurrentJourneyAccount = async () => {
  const { probeJourneyAccount } = await import('./journey-runtime.mjs');
  return probeJourneyAccount(process.env);
};
const lockedJourneyProbe = () => withJourneyGate(probeCurrentJourneyAccount);
const actorTools = new Set(['docs_product_context', 'docs_plan_content', 'docs_generate_package', 'docs_submit_package', 'docs_delete_article', 'docs_update_article', 'docs_submit_article', 'criar_guia', 'atualizar_por_deploy', 'atualizar_codigo_produto']);
const requestedBySchema = z.string().optional().describe('Ator opcional; se informado, deve coincidir com o ator da credencial');
const confirmationsSchema = z.array(z.string().max(300)).max(8).optional();
const contentRequestSchema = z.object({
  topic: z.string().min(3).max(120),
  module: z.string().min(2).max(80),
  description: z.string().min(10).max(1_000),
  details: z.string().max(8_000).optional(),
  audience: z.string().max(300).default('Cliente em trial sem treinamento'),
  productRoute: z.string().regex(/^\/(?!\/)[a-z0-9/_-]*$/).optional(),
  tangoUrl: z.string().url().optional(),
  confirmations: confirmationsSchema,
  requestedBy: requestedBySchema,
});

const textResult = (value, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(value && typeof value === 'object' && !Array.isArray(value)
    ? { securityWarnings: [], ...value } : value, null, 2) }],
  isError,
});

export function journeyTaskSummary(record) {
  const blocked = record.blocked && {
    host: record.blocked.host, method: record.blocked.method, path: record.blocked.path,
    keys: record.blocked.keys, reason: record.blocked.reason,
    ...(record.blocked.keyPath ? { keyPath: record.blocked.keyPath } : {}),
  };
  const validation = /^validação do formulário: (Informe o telefone com DDD|Já existe um contato com este número de telefone|O telefone é obrigatório|Precisa ter pelo menos um canal)$/u
    .exec(record.reason ?? '')?.[1] ?? null;
  const fixtures = (record.fixtures ?? []).filter((item) => item && typeof item === 'object'
    && ['department', 'channel', 'user', 'company'].includes(item.kind)
    && (/^GET \/api\/v2\/configurations\/(?:departments|channels|users)$/u.test(item.source)
      || /^CAPTURE_QA_(?:DEPARTMENT|CHANNEL|USER|COMPANY)_IDS$/u.test(item.source)))
    .map(({ source, kind, ids }) => ({ source, kind, count: Array.isArray(ids) ? ids.length : 0 }));
  return { task: record.task, status: record.status, reason: record.reason,
    blocked: blocked ?? null, validation, fixtures, actions: record.actions?.length ?? 0,
    ...(typeof record.identityVerified === 'boolean' ? { identityVerified: record.identityVerified } : {}),
    thirdPartyDenied: record.thirdPartyDenied ?? {}, ...(record.observeError ? { observeError: record.observeError } : {}),
    ...(record.apiError ? { apiError: record.apiError } : {}),
    ...(record.creationCapture ? { creationCapture: record.creationCapture } : {}),
    ...(record.importCapture ? { importCapture: record.importCapture } : {}),
    ...(record.importResultMessage ? { importResultMessage: record.importResultMessage } : {}),
    ...(record.verification ? { verification: record.verification } : {}),
    ...(record.createdRef ? { createdRef: record.createdRef } : {}),
    ...(record.saveOutcome ? { saveOutcome: record.saveOutcome } : {}),
    ...(record.saveMessages ? { saveMessages: record.saveMessages } : {}),
    ...(record.searchProbe ? { searchProbe: record.searchProbe } : {}),
    ...(record.ownerProbe ? { ownerProbe: record.ownerProbe } : {}),
    ...(record.menuProbe ? { menuProbe: record.menuProbe } : {}),
    ...(record.botWriteProbe ? { botWriteProbe: record.botWriteProbe } : {}),
    ...(record.tagProbe ? { tagProbe: record.tagProbe } : {}),
    ...(record.actionError ? { actionError: record.actionError } : {}) };
}

export function buildServer(root = process.env.DOCS_ROOT ?? new URL('../', import.meta.url).pathname) {
  const server = new McpServer(
    { name: 'ihelp-docs', version: '0.1.0' },
    { instructions: 'Consulte a base antes de criar conteúdo. Envie sempre como draft ou pull request; nunca publique credenciais ou dados pessoais.' },
  );
  const registerTool = (name, config, callback) => {
    if (config.mutates) config = { ...config, inputSchema: config.inputSchema.safeExtend({ confirmations: confirmationsSchema }) };
    registerToolPolicy(name, config);
    return server.registerTool(name, config, async (args, extra) => {
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
  };

  registerTool('docs_inventory', {
    mutates: false,
    description: 'Mostra cobertura dos módulos reais do iHelp e os gaps prioritários de FAQ/Tango.',
    inputSchema: z.object({}),
  }, async () => textResult(await getInventory(root)));

  registerTool('lacunas', {
    mutates: false,
    description: 'Agrupa eventos saneados por tópico e devolve propostas para criar_guia; incidentes exigem revisão humana.',
    inputSchema: z.object({}),
  }, async () => {
    try {
      const { collectGaps } = await import('./lacunas.mjs');
      return textResult(await collectGaps(root, process.env.SESSION_EVENTS_FILE ?? '/tmp/ihelp-docs-session-events.jsonl'));
    }
    catch { return textResult({ error: 'Não foi possível consultar lacunas' }, true); }
  });

  registerTool('docs_search', {
    mutates: false,
    description: 'Busca conteúdo existente antes de criar ou duplicar um FAQ.',
    inputSchema: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(20).default(8) }),
  }, async ({ query, limit }) => textResult({ results: await searchContent(root, query, limit) }));

  registerTool('docs_get_article', {
    mutates: false,
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
    mutates: false,
    description: 'Audita todos os artigos contra o padrão editorial do iHelp sem alterar arquivos.',
    inputSchema: z.object({}),
  }, async () => textResult(await auditContent(root)));

  registerTool('docs_validate_article', {
    mutates: false,
    description: 'Valida metadados, caminho, conteúdo, Tango e vazamento de credenciais sem gravar nada.',
    inputSchema: articleSchema,
  }, async (article) => textResult(validateArticle(article)));

  registerTool('docs_product_context', {
    mutates: false,
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
      return textResult(publicProductContext(result));
    } catch (error) {
      await auditOperation(root, { actor: requestedBy, operation: 'docs_product_context', target: auditTarget(module, topic), result: 'failure' });
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  });

  registerTool('docs_plan_content', {
    mutates: false,
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
    mutates: false,
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

  registerTool('criar_guia', {
    mutates: true,
    description: 'Na primeira chamada, cria um plano com perguntas; na segunda, retoma pelo planId e cria somente um draft de guia canônico.',
    inputSchema: z.strictObject({
      guideId: z.string().optional(), topic: z.string().min(3).max(120).optional(),
      module: z.string().min(2).max(80).optional(), description: z.string().min(10).max(1_000).optional(),
      details: z.string().max(8_000).optional(), planId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      plan: z.unknown().optional(), questions: z.array(z.string()).max(20).optional(),
      questionIds: z.array(z.string().regex(/^[a-f0-9]{16}$/)).max(20).optional(),
      answers: z.array(z.string().min(1).max(2_000)).max(20).optional(), requestedBy: requestedBySchema,
    }),
  }, async (args) => {
    try { return textResult(await createGuide(root, args)); }
    catch (error) { return textResult({ error: error instanceof Error ? error.message : 'Falha ao criar guia' }, true); }
  });

  registerTool('atualizar_por_deploy', {
    mutates: true,
    description: 'Propõe revisão dos guias afetados por snapshots de uma versão implantada, sempre em PR draft.',
    inputSchema: z.strictObject({ before: z.unknown(), after: z.unknown(), prova: z.unknown().optional(), requestedBy: requestedBySchema }),
  }, async ({ requestedBy, before, after, prova }) => {
    try { return textResult(await atualizarPorDeploy(root, { before, after, prova, requestedBy })); }
    catch (error) { return textResult({ error: error instanceof Error ? error.message : String(error) }, true); }
  });

  registerTool('atualizar_codigo_produto', {
    mutates: true,
    description: 'Atualiza sob demanda a cópia de leitura do front e do back. Repita o pedido original depois da atualização.',
    inputSchema: z.strictObject({ requestedBy: requestedBySchema }),
  }, async () => {
    try { return textResult(await refreshCodeProduct()); }
    catch { return textResult({ error: 'Não foi possível atualizar a cópia do código' }, true); }
  });

  registerTool('capturar_telas', {
    mutates: true,
    description: 'Captura na homologação aprovada e grava PNGs mascarados no estado privado do serviço.',
    inputSchema: z.strictObject({
      path: z.string().regex(/^docs\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/),
      module: z.string().min(2).max(80),
      requestedBy: requestedBySchema,
    }),
  }, async ({ requestedBy, path, module }) => {
    if (!requestIdentity.getStore()) return textResult({ error: 'unauthorized' }, true);
    const page = path.split('/').at(-1);
    const target = auditTarget(module, path);
    await auditOperation(root, { actor: requestedBy, operation: 'capturar_telas', target, result: 'attempt' });
    try {
      const { capturePage, captureStepsLog } = await import('./screen-capture-service.mjs');
      const manifest = await capturePage({ path, module });
      console.error(captureStepsLog(manifest.steps));
      await auditOperation(root, { actor: requestedBy, operation: 'capturar_telas', target, result: 'success' });
      return textResult({ page, captured: manifest.steps.filter((step) => step.status === 'capturado').length,
        steps: manifest.steps });
    } catch (error) {
      console.error(captureFailureLog(error));
      await auditOperation(root, { actor: requestedBy, operation: 'capturar_telas', target, result: 'failure' });
      return textResult({ error: captureFailureCategory(error) }, true);
    }
  });

  registerTool('gravar_jornada', {
    mutates: true,
    description: 'Executa tarefas fictícias na homologação ou na conta de teste de produção após pré-voo.',
    inputSchema: z.strictObject({
      module: z.enum(['contatos', 'robos']),
      tasks: z.array(z.string().regex(/^(?:contatos|robos)\.[a-z_]+$/)).max(20).optional(),
      requestedBy: requestedBySchema,
    }),
  }, async ({ module, tasks, requestedBy }) => {
    if (!requestIdentity.getStore()) return textResult({ error: 'unauthorized' }, true);
    if (journeyRunning) return textResult({ error: 'ocupado' }, true);
    journeyRunning = true;
    const started = Date.now();
    const target = auditTarget(module, (tasks ?? []).join(','));
    try {
      await auditOperation(root, { actor: requestedBy, operation: 'gravar_jornada', target, result: 'attempt' });
      const { recordJourneys } = await import('./journey-runtime.mjs');
      const records = await withJourneyGate(() => recordJourneys(module, tasks));
      if (!Array.isArray(records)) {
        await auditOperation(root, { actor: requestedBy, operation: 'gravar_jornada', target,
          result: records?.mode === 'confirmacao' ? 'confirmation' : 'blocked' });
        return textResult(records, records?.mode !== 'confirmacao');
      }
      const { journeyCoverage } = await import('./journey-service.mjs');
      await auditOperation(root, { actor: requestedBy, operation: 'gravar_jornada', target, result: 'success' });
      return textResult({ tasks: records.map(journeyTaskSummary),
        coverage: journeyCoverage(records), elapsedMs: Date.now() - started });
    } catch (error) {
      const { journeyFailureCategory, journeyFailureLog } = await import('./journey-service.mjs');
      console.error(journeyFailureLog(error));
      await auditOperation(root, { actor: requestedBy, operation: 'gravar_jornada', target, result: 'failure' });
      return textResult({ error: journeyFailureCategory(error), diagnostic: journeyFailureLog(error),
        tasks: error?.results?.map(journeyTaskSummary) ?? [],
        elapsedMs: Date.now() - started }, true);
    } finally {
      const { clearJourneyProofCache } = await import('./journey-service.mjs');
      clearJourneyProofCache(lockedJourneyProbe);
      journeyRunning = false;
    }
  });

  registerTool('ler_jornada', {
    mutates: false,
    description: 'Lê uma jornada privada sanitizada, incluindo ids dos prints mascarados.',
    inputSchema: z.strictObject({
      module: z.enum(['contatos', 'robos']),
      task: z.string().regex(/^(?:contatos|robos)\.[a-z_]+$/),
      requestedBy: requestedBySchema,
    }),
  }, async ({ module, task, requestedBy }) => {
    if (!requestIdentity.getStore()) return textResult({ error: 'unauthorized' }, true);
    await auditOperation(root, { actor: requestedBy, operation: 'ler_jornada', target: auditTarget(module, task), result: 'attempt' });
    try {
      const { readJourney } = await import('./journey-service.mjs');
      const { configuredJourneyIdentity } = await import('./journey-runtime.mjs');
      return textResult(await readJourney({ module, task,
        accountHash: configuredJourneyIdentity(process.env).credentialHash,
        probeAccount: lockedJourneyProbe }));
    } catch (error) {
      const { journeyReadFailureCategory } = await import('./journey-service.mjs');
      return textResult(error.message === 'jornada de outra conta'
        ? { error: 'jornada de outra conta' }
        : { error: 'Jornada indisponível', category: journeyReadFailureCategory(error) }, true);
    }
  });

  registerTool('enviar_tela', {
    mutates: true,
    description: 'Recebe PNG/JPEG no volume privado como pendente de revisão.',
    inputSchema: z.strictObject({
      page: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
      step: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
      base64: z.string().max(3 * 1024 * 1024),
      alt: z.string().min(1).max(240),
      requestedBy: requestedBySchema,
    }),
  }, async ({ requestedBy, page, step, base64, alt }) => {
    if (!requestIdentity.getStore()) return textResult({ error: 'unauthorized' }, true);
    const target = auditTarget(page, step);
    await auditOperation(root, { actor: requestedBy, operation: 'enviar_tela', target, result: 'attempt' });
    try {
      const { uploadPage } = await import('./screen-capture-service.mjs');
      await uploadPage({ page, step, base64, alt });
      await auditOperation(root, { actor: requestedBy, operation: 'enviar_tela', target, result: 'success' });
      return textResult({ page, step, status: 'pending' });
    } catch {
      await auditOperation(root, { actor: requestedBy, operation: 'enviar_tela', target, result: 'failure' });
      return textResult({ error: 'Upload recusado' }, true);
    }
  });

  registerTool('aprovar_tela', {
    mutates: true,
    description: 'Aprova um upload pendente com token de administração separado.',
    inputSchema: z.strictObject({
      page: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
      step: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
      adminToken: z.string().min(24),
      requestedBy: requestedBySchema,
    }),
  }, async ({ requestedBy, page, step, adminToken }) => {
    if (!requestIdentity.getStore()) return textResult({ error: 'unauthorized' }, true);
    const target = auditTarget(page, step);
    await auditOperation(root, { actor: requestedBy, operation: 'aprovar_tela', target, result: 'attempt' });
    try {
      const { approvePage } = await import('./screen-capture-service.mjs');
      await approvePage({ page, step, token: adminToken, approvedBy: requestedBy });
      await auditOperation(root, { actor: requestedBy, operation: 'aprovar_tela', target, result: 'success' });
      return textResult({ page, step, status: 'approved' });
    } catch {
      await auditOperation(root, { actor: requestedBy, operation: 'aprovar_tela', target, result: 'failure' });
      return textResult({ error: 'Aprovação recusada' }, true);
    }
  });

  registerTool('baixar_telas', {
    mutates: false,
    description: 'Devolve manifesto e até quatro PNGs de uma página como base64 para revisão e PR do FAQ.',
    inputSchema: z.strictObject({
      page: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
      limit: z.number().int().min(1).max(4).default(4),
      requestedBy: requestedBySchema,
    }),
  }, async ({ page, limit }) => {
    if (!requestIdentity.getStore()) return textResult({ error: 'unauthorized' }, true);
    try {
      const { downloadPage } = await import('./screen-capture-service.mjs');
      return textResult(await downloadPage(page, { limit }));
    }
    catch { return textResult({ error: 'Telas indisponíveis ou acima do limite' }, true); }
  });

  registerTool('docs_submit_package', {
    mutates: true,
    description: 'Cria ou atualiza MDX e remove artigos em uma PR; atualiza meta.json de navegação. dry_run apenas valida.',
    inputSchema: z.object({
      articles: z.array(articleSchema).max(8).default([]),
      deletes: z.array(z.string()).max(8).default([]),
      mode: z.enum(['dry_run', 'draft', 'pull_request']).default('dry_run'),
      requestedBy: requestedBySchema,
    }),
  }, async ({ articles, deletes, mode, requestedBy, confirmations }) => {
    try {
      return textResult(await submitContentPackage(root, articles, mode, requestedBy, deletes, { confirmations }));
    } catch (error) {
      return textResult(error instanceof SubmitArticleError ? { error: error.message, code: error.code } : { error: 'Não foi possível enviar o pacote', code: 'SUBMIT_FAILED' }, true);
    }
  });

  registerTool('docs_delete_article', {
    mutates: true,
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
    mutates: true,
    description: 'Atualiza artigo e meta.json em pull request, sem merge nem deploy.',
    inputSchema: articleSchema.extend({ requestedBy: requestedBySchema }),
  }, async ({ requestedBy, confirmations, ...article }) => {
    try {
      return textResult(await submitContentPackage(root, [article], 'pull_request', requestedBy, [], { confirmations }));
    } catch (error) {
      return textResult(error instanceof SubmitArticleError ? { error: error.message, code: error.code } : { error: 'Não foi possível atualizar o artigo', code: 'SUBMIT_FAILED' }, true);
    }
  });

  registerTool('docs_submit_article', {
    mutates: true,
    description: 'Envia conteúdo validado como draft local ou abre pull request no GitHub. Nunca faz merge ou deploy.',
    inputSchema: articleSchema.extend({
      mode: z.enum(['draft', 'pull_request']).default('draft'),
      requestedBy: requestedBySchema,
    }),
  }, async ({ mode, requestedBy, confirmations, ...article }) => {
    try {
      if (mode === 'pull_request') return textResult(await submitContentPackage(root, [article], mode, requestedBy, [], { confirmations }));
      return textResult(await submitArticle(root, article, mode, requestedBy, { confirmations }));
    } catch (error) {
      return textResult(error instanceof SubmitArticleError
        ? { error: error.message, code: error.code }
        : { error: 'Não foi possível enviar o artigo', code: 'SUBMIT_FAILED' }, true);
    }
  });

  return server;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  installCaptureRejectionSafety();
  if (!process.env.BUSINESS_CONTEXT_DIR) {
    const stateDir = process.env.MCP_STATE_DIR ?? '/data';
    try {
      const result = await syncBusinessContext({ stateDir, token: process.env[envCompatibility.githubReadToken.current] });
      if (result.status === 'available') process.env.BUSINESS_CONTEXT_DIR = result.directory;
    } catch { /* sem contexto, o juiz mantém a confirmar */ }
  }
  serveStdio(() => buildServer());
}
