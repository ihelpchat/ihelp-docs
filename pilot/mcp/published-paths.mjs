import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const contentRoot = join(process.env.DOCS_ROOT ?? fileURLToPath(new URL('../', import.meta.url)), 'content/docs');

function articlePaths(directory) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...articlePaths(file));
    else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      const path = relative(contentRoot, file).split(sep).join('/');
      paths.push(`/${path.replace(/\/index\.mdx$/, '').replace(/\.mdx$/, '')}`);
    }
  }
  return paths;
}

// The assistant searches this same published MDX tree. It is immutable during a deploy.
const publishedPaths = new Set(articlePaths(contentRoot));

export function isPublishedPath(path) {
  return typeof path === 'string' && publishedPaths.has(path);
}

export function publishedPathOrNull(path) {
  return isPublishedPath(path) ? path : null;
}
