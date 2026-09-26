import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { guideSchema } from '../architecture/conversation-v1.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { planContent, generateCanonicalGuide } from './content-ai-service.mjs';
import { readArticle } from './editorial-standard.mjs';
import { submitContentPackage, validateArticle, isSafeRequestedBy } from './content-service.mjs';
import { containsSensitiveData, redactSensitiveData } from './sensitive-data.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const storeRoot = (root) => join(process.env.MCP_STATE_DIR ?? root, '.guide-plans');
const sourceDigest = (context) => digest({ code: context.code?.map(({ repository, ref, available }) => ({ repository, ref, available })), matches: context.matches?.map(({ repository, path, line, sha, excerpt }) => ({ repository, path, line, sha, excerpt })) });
const safeId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function existingGuide(root, guideId) {
  const base = join(root, 'content/docs');
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) { const found = await visit(file); if (found) return found; }
      else if (entry.isFile() && entry.name.endsWith('.mdx')) {
        const path = relative(base, file).replace(/\.mdx$/u, '');
        const raw = await readFile(file, 'utf8');
        if (new RegExp(`\\bguideId:\\s*["']?${guideId}(?:["']|\\s|$)`, 'm').test(raw)) {
          const article = await readArticle(root, path);
          if (article.guide?.guideId === guideId) return article;
        }
      }
    }
    return null;
  };
  return visit(base);
}

async function planDirectory(root) {
  const base = storeRoot(root);
  await mkdir(base, { recursive: true, mode: 0o700 });
  const stat = await lstat(base);
  if (!stat.isDirectory() || (stat.mode & 0o077)) throw new Error('Store de planos inseguro');
  return base;
}

async function planFile(root, id) { return join(await planDirectory(root), `${id}.json`); }

async function pruneExpired(root, now, ttl) {
  const base = await planDirectory(root);
  const expired = new Set();
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue;
    const file = join(base, entry.name);
    const state = JSON.parse(await readFile(file, 'utf8'));
    const expiry = state.expiresAt ?? (await lstat(file)).mtimeMs + ttl;
    if (now >= expiry) {
      expired.add(entry.name.slice(0, -5));
      await rm(file);
    }
  }
  return expired;
}

async function save(file, value, exclusive = false) {
  const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    if (exclusive) await writeFile(file, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    else await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

async function locked(file, work) {
  const lock = `${file}.lock`;
  for (let i = 0; i < 100; i++) {
    try { await mkdir(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (i === 99) throw new Error('Plano ocupado; tente novamente');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try { return await work(); }
  finally { await rm(lock, { recursive: true, force: true }); }
}

export async function createGuide(root, input, options = {}) {
  if (!isSafeRequestedBy(input.requestedBy)) throw new Error('ator inválido');
  const now = options.now?.() ?? Date.now();
  const ttl = options.planTtlMs ?? Number(process.env.MCP_GUIDE_PLAN_TTL_MS ?? 86_400_000);
  if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new Error('TTL de plano inválido');
  const expired = await pruneExpired(root, now, ttl);
  const getContext = options.getContext ?? ((request) => getIhelpContext(root, request.topic, request.module, { requireLocal: true }));
  const existing = options.existing ?? existingGuide;
  const plan = options.plan ?? planContent;
  const generate = options.generate ?? generateCanonicalGuide;
  const submit = options.submit ?? submitContentPackage;

  if (!input.planId) {
    if (typeof input.topic !== 'string' || typeof input.module !== 'string' || typeof input.description !== 'string'
      || input.answers !== undefined) throw new Error('Informe guideId, topic, module e description para criar o plano');
    const guideId = guideSchema.shape.guideId.safeParse(input.guideId);
    if (!guideId.success) throw new Error('guideId fora do catálogo canônico');
    for (const value of [input.topic, input.module, input.description, input.details].filter(Boolean)) {
      if (containsSensitiveData(value)) throw new Error('Pedido contém dado sensível');
    }
    const request = { guideId: input.guideId, topic: input.topic, module: input.module, description: input.description, details: input.details ?? '' };
    const context = await getContext(request);
    const result = await plan(root, request, { productContext: context });
    const id = randomBytes(32).toString('hex');
    const stored = { actor: input.requestedBy, request, plan: result, source: sourceDigest(context), guide: await existing(root, input.guideId), status: 'planned', expiresAt: now + ttl };
    await save(await planFile(root, id), stored, true);
    return { status: 'planned', planId: id, questions: result.questions ?? [], guidance: result.guidance ?? result.summary ?? '' };
  }

  if (!safeId(input.planId)) throw new Error('planId inválido');
  if (expired.has(input.planId)) throw new Error('plano expirado, refaça');
  if (input.guideId !== undefined || input.topic !== undefined || input.module !== undefined || input.description !== undefined || input.details !== undefined) throw new Error('Retomada aceita apenas planId e answers');
  const file = await planFile(root, input.planId);
  return locked(file, async () => {
    const stored = JSON.parse(await readFile(file, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') throw new Error('plano expirado, refaça');
      throw error;
    }));
    if (now >= (stored.expiresAt ?? (await lstat(file)).mtimeMs + ttl)) {
      await rm(file);
      throw new Error('plano expirado, refaça');
    }
    if (stored.actor !== input.requestedBy) throw new Error('Plano pertence a outro ator');
    if (!Array.isArray(input.answers) || input.answers.length !== stored.plan.questions?.length
      || input.answers.some((answer) => typeof answer !== 'string' || !answer.trim() || answer.length > 2000)) throw new Error('Responda todas as perguntas do plano');
    const answerHash = digest(input.answers.map((answer) => answer.trim()));
    const answers = input.answers.map((answer) => redactSensitiveData(answer.trim()));
    if (stored.answerHash && stored.answerHash !== answerHash) throw new Error('Plano já retomado com respostas diferentes');
    const context = await getContext(stored.request);
    if (sourceDigest(context) !== stored.source) throw new Error('As fontes mudaram; refaça o plano');
    const current = await existing(root, stored.request.guideId);
    if (digest(current) !== digest(stored.guide)) throw new Error('O guia de origem mudou; refaça o plano');
    if (stored.status === 'draft') return stored.result;
    stored.answerHash = answerHash;
    await save(file, stored);
    const request = { ...stored.request, details: redactSensitiveData(`${stored.request.details}\n${stored.plan.questions.map((question, i) => `${question}: ${answers[i]}`).join('\n')}`) };
    const packageResult = await generate(root, request, { plan: { ...stored.plan, status: 'ready' }, productContext: context, existingGuide: current });
    if (packageResult.status !== 'ready' || packageResult.articles?.length !== 1) return { status: packageResult.status, questions: packageResult.questions ?? [] };
    const article = packageResult.articles[0];
    if (article.contentType !== 'guia' || article.guide?.guideId !== stored.request.guideId) throw new Error('Gerador não devolveu guia canônico');
    article.path = current?.path ?? article.path;
    article.guide.version = current?.guide?.version ? current.guide.version + 1 : 1;
    article.guide.schemaVersion = 1;
    if (!guideSchema.safeParse(article.guide).success || !validateArticle(article).valid) throw new Error('Guia gerado não passou pela validação');
    if (sourceDigest(await getContext(stored.request)) !== stored.source
      || digest(await existing(root, stored.request.guideId)) !== digest(stored.guide)) throw new Error('As fontes mudaram; refaça o plano');
    const draftHash = digest(article);
    if (stored.draftHash && stored.draftHash !== draftHash) throw new Error('Conflito: guia gerado diferente na retomada');
    const retry = stored.draftHash === draftHash;
    stored.draftHash = draftHash;
    await save(file, stored);
    let draft;
    try { draft = await submit(root, [article], 'draft', input.requestedBy, [], { allowExistingDraft: retry }); }
    catch (error) {
      if (error.code === 'DRAFT_EXISTS') {
        delete stored.draftHash;
        await save(file, stored);
      }
      throw error;
    }
    const result = { status: 'draft', planId: input.planId, draft, reviewRequired: true };
    await save(file, { ...stored, status: 'draft', result });
    return result;
  });
}
