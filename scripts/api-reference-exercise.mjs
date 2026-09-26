import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateContentPackage } from '../pilot/mcp/content-ai-service.mjs';
import { renderArticle } from '../pilot/mcp/content-service.mjs';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (!args.includes('--topic') || !args.includes('--remove') || !args.includes('--out')) {
  throw new Error('Uso: node scripts/api-reference-exercise.mjs --topic "API de Contatos" --remove api/contatos --out <pasta>');
}
const remove = option('--remove');
if (!/^api\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/u.test(remove)) throw new Error('--remove inválido');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../pilot');
const out = resolve(option('--out'));
const copy = await mkdtemp(join(tmpdir(), 'api-reference-exercise-'));
try {
  await cp(join(root, 'architecture'), join(copy, 'architecture'), { recursive: true });
  await cp(join(root, 'content/docs'), join(copy, 'content/docs'), { recursive: true });
  const names = ['buscar-contatos', 'buscar-detalhes-do-contato', 'buscar-tags-do-contato'];
  const expected = await Promise.all(names.map(async (name) => {
    const raw = await readFile(join(root, 'content/docs', remove, `${name}.mdx`), 'utf8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?/u);
    if (!match) throw new Error(`frontmatter ausente: ${name}`);
    const field = (key) => match[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'mu'))?.[1]?.trim();
    return { path: `${remove}/${name}`, method: field('method'), endpoint: field('endpoint'), body: raw.slice(match[0].length) };
  }));
  await rm(join(copy, 'content/docs', remove), { recursive: true, force: true });
  const result = await generateContentPackage(copy, { topic: option('--topic'), module: 'api', description: `Referência da ${option('--topic')}` },
    { contextOptions: { publicReferenceRoot: root } });
  await mkdir(out, { recursive: true });
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
