import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { generateContentPackage } from '../pilot/mcp/content-ai-service.mjs';
import { renderArticle } from '../pilot/mcp/content-service.mjs';

const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
if ((!option('--topic') && !option('--request')) || !option('--out')) {
  throw new Error('Uso: node scripts/api-reference-exercise.mjs (--topic <tema> | --request <arquivo.json>) [--remove api/contatos] [--reference-root copy|repo] --out <pasta>');
}
const request = option('--request') ? JSON.parse(await readFile(resolve(option('--request')), 'utf8'))
  : { topic: option('--topic'), module: 'api', description: `Referência da ${option('--topic')}` };
if (request.module !== 'api') throw new Error('--request deve conter module=api');
const remove = option('--remove') ?? [request.description, request.details].filter(Boolean).join(' ').match(/(?<!\/)\bapi\/([a-z0-9-]+)\/[a-z0-9-]+/iu)?.[0]?.replace(/\/[^/]+$/u, '');
if (!/^api\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/u.test(remove)) throw new Error('--remove inválido');
const referenceRoot = option('--reference-root') ?? 'repo';
if (!['copy', 'repo'].includes(referenceRoot)) throw new Error('--reference-root deve ser copy ou repo');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../pilot');
const out = resolve(option('--out'));
await mkdir(out, { recursive: true });
const OpenAI = createRequire(join(root, 'package.json'))('openai');
const realClient = new OpenAI();
let responses = 0;
const client = { responses: { create: async (payload) => {
  const response = await realClient.responses.create(payload);
  await writeFile(join(out, `resp-${++responses}.json`), `${JSON.stringify({ model: response.model,
    status: response.status, text: response.output_text }, null, 2)}\n`);
  return response;
} } };
const copy = await mkdtemp(join(tmpdir(), 'api-reference-exercise-'));
try {
  await cp(join(root, 'architecture'), join(copy, 'architecture'), { recursive: true });
  await cp(join(root, 'content/docs'), join(copy, 'content/docs'), { recursive: true });
  const names = (await readdir(join(root, 'content/docs', remove)).catch(() => []))
    .filter((name) => name.endsWith('.mdx')).map((name) => name.slice(0, -4));
  const expected = await Promise.all(names.map(async (name) => {
    const raw = await readFile(join(root, 'content/docs', remove, `${name}.mdx`), 'utf8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?/u);
    if (!match) throw new Error(`frontmatter ausente: ${name}`);
    const field = (key) => match[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'mu'))?.[1]?.trim();
    return { path: `${remove}/${name}`, method: field('method'), endpoint: field('endpoint'), body: raw.slice(match[0].length) };
  }));
  await rm(join(copy, 'content/docs', remove), { recursive: true, force: true });
  const result = await generateContentPackage(copy, request,
    { client, contextOptions: { publicReferenceRoot: referenceRoot === 'copy' ? copy : root } });
  await writeFile(join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'ready') for (const article of result.articles) {
    const target = join(out, `${article.path}.mdx`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, renderArticle(article));
  }
  const params = (body) => [...String(body).matchAll(/<Param\s+[^>]*name=["']([^"']+)["']/gu)].map((match) => match[1]).join(', ');
  console.log('| Página | Método esperado | Método gerado | Endpoint esperado | Endpoint gerado | Parâmetros esperados | Parâmetros gerados |');
  console.log('|---|---|---|---|---|---|---|');
  for (const reference of expected) {
    const generated = result.articles?.find((article) => article.path === reference.path);
    console.log(`| ${reference.path} | ${reference.method} | ${generated?.method ?? 'PENDENTE'} | ${reference.endpoint} | ${generated?.endpoint ?? 'PENDENTE'} | ${params(reference.body)} | ${params(generated?.body)} |`);
  }
  console.log(`status=${result.status}; saída=${out}`);
} finally {
  await rm(copy, { recursive: true, force: true });
}
