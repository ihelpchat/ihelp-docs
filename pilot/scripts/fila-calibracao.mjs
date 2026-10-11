import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFeedback } from './aprender-licoes-core.mjs';
import { assertPrivateFile } from './private-output-path.mjs';
import { installPrivateCliErrorHandler } from './private-cli-error.mjs';

const pilotRoot = resolve(import.meta.dirname, '..');

export async function buildFeedbackQueue(contentDir, feedbackDir) {
  const { review } = await loadFeedback(feedbackDir);
  const reviewed = new Set(review.filter((item) => item.pagina && item.titulo && item.decisao)
    .map((item) => `${String(item.pagina).replace(/\.(?:md|mdx)$/iu, '')}\0${item.titulo}`));
  const files = (await readdir(contentDir, { recursive: true })).filter((file) => /\.mdx?$/iu.test(file)).sort();
  const queue = [];
  for (const page of files) {
    const source = await readFile(join(contentDir, page), 'utf8');
    const headings = [...source.matchAll(/^## (.+)$/gmu)];
    const basename = page.slice(page.lastIndexOf('/') + 1, -extname(page).length);
    for (let index = 0; index < headings.length; index++) {
      const title = headings[index][1].replace(/\s+\{#.*\}$/u, '').trim();
      if (!title || reviewed.has(`${basename}\0${title}`)
        || reviewed.has(`${page.slice(0, -extname(page).length)}\0${title}`)) continue;
      const id = createHash('sha256').update(`${page}\0${title}`).digest('hex');
      queue.push({ id, pagina: page, titulo: title,
        texto: source.slice(headings[index].index, headings[index + 1]?.index ?? source.length).trim() });
    }
  }
  return queue;
}

export async function writeFeedbackQueue(file, queue) {
  const output = resolve(file);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await assertPrivateFile(output, 'FEEDBACK_QUEUE_FILE');
  await writeFile(output, `${JSON.stringify(queue, null, 2)}\n`, { mode: 0o600 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installPrivateCliErrorHandler();
  if (!process.env.FEEDBACK_DIR || !process.env.FEEDBACK_QUEUE_FILE)
    throw new Error('FEEDBACK_DIR e FEEDBACK_QUEUE_FILE são obrigatórios');
  const queue = await buildFeedbackQueue(join(pilotRoot, 'content/docs'), process.env.FEEDBACK_DIR);
  await writeFeedbackQueue(process.env.FEEDBACK_QUEUE_FILE, queue);
  console.log(JSON.stringify({ secoesPendentes: queue.length }));
}
