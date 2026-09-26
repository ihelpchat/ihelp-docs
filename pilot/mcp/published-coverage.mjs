import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { topicForQuestion } from './closed-router.mjs';
import { actionForQuestion } from './gap-classification.mjs';

const phrases = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string')
  : typeof value === 'string' ? [value] : [];

/** Published MDX pages and their topic/action keys, using the event classifiers. */
export async function publishedCoverage(root) {
  const directory = join(root, 'content/docs');
  const pages = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.mdx')) continue;
      const raw = await readFile(file, 'utf8');
      const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
      if (!frontmatter) continue;
      const parsed = parseDocument(frontmatter[1]);
      if (parsed.errors.length) continue;
      const metadata = parsed.toJS();
      if (!metadata || metadata.draft === true) continue;
      const headings = [...raw.slice(frontmatter[0].length).matchAll(/^#{2,3}\s+(.+)$/gmu)]
        .map((match) => match[1]);
      const declared = [metadata.title, metadata.assistantQuestion,
        ...phrases(metadata.aliases), ...phrases(metadata.questions),
        ...phrases(metadata.assistantAliases), ...phrases(metadata.assistantQuestions), ...headings];
      const keys = new Set(declared.filter((value) => typeof value === 'string').flatMap((value) => {
        const topic = topicForQuestion(value);
        const action = actionForQuestion(value);
        return topic && action ? [JSON.stringify([topic, action])] : [];
      }));
      const pageId = metadata.guide?.guideId ?? relative(directory, file).replace(/\.mdx$/u, '');
      pages.push({ pageId, kind: metadata.guide ? 'guide' : 'article', keys: [...keys] });
    }
  }
  await visit(directory);
  return pages.toSorted((a, b) => a.pageId.localeCompare(b.pageId));
}
