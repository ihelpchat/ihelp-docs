import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'iHelp';
export const docsRoute = '/';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function withBasePath(path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || !basePath) return path;
  return `${basePath}${path}`;
}

// fill this with your actual GitHub info, for example:
export const gitConfig = {
  user: 'ihelpchat',
  repo: 'ihelp-docs',
  branch: 'main',
};

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
