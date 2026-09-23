import type { Folder, Item, Node, Root } from 'fumadocs-core/page-tree';
import { source } from '@/lib/source';

export type Section = 'docs' | 'api' | 'tutoriais' | 'blog';

export type NavItem = {
  title: string;
  url?: string;
  method?: string;
  children?: NavItem[];
};

export type NavGroup = {
  title: string;
  url?: string;
  items: NavItem[];
};

export function sectionOf(url: string): Section | undefined {
  const first = url.split('/').filter(Boolean)[0];
  if (first === 'docs' || first === 'api' || first === 'tutoriais' || first === 'blog') return first;
  return undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

const methodByUrl = new Map(source.getPages().map((page) => [page.url, page.data.method]));
const indexUrls = new Set(source.getPages().filter((page) => /(^|\/)index\.mdx?$/.test(page.path)).map((page) => page.url));

function toItem(node: Node): NavItem | undefined {
  if (node.type === 'separator') return undefined;
  if (node.type === 'page') {
    return { title: text(node.name), url: node.url, method: methodByUrl.get(node.url) };
  }
  const { index, rest } = splitIndex(node);
  const children = rest.map(toItem).filter((item): item is NavItem => Boolean(item));
  return { title: text(node.name), url: index?.url, children };
}

/**
 * Quando o meta.json lista "index" explicitamente, o Fumadocs trata a página como filha comum.
 * Aqui ela volta a ser a página da pasta, para o menu não repetir o título.
 */
function splitIndex(folder: Folder) {
  if (folder.index) return { index: folder.index, rest: folder.children };
  const index = folder.children.find((child): child is Item => child.type === 'page' && indexUrls.has(child.url));
  return { index, rest: index ? folder.children.filter((child) => child !== index) : folder.children };
}

function firstUrl(node: Node): string {
  if (node.type === 'page') return node.url;
  if (node.type === 'folder') return node.index?.url ?? node.children.map(firstUrl).find(Boolean) ?? '';
  return '';
}

function sectionRoot(tree: Root, section: Section): Folder | undefined {
  return tree.children.find(
    (node): node is Folder =>
      node.type === 'folder' && firstUrl(node).startsWith(`/${section}`),
  );
}

/** Groups for the sidebar: loose pages first, then one group per top-level folder. */
export function getNavGroups(section: 'docs' | 'api'): NavGroup[] {
  const root = sectionRoot(source.getPageTree(), section);
  if (!root) return [];
  const loose: NavItem[] = [];
  const groups: NavGroup[] = [];
  const { index: rootIndex, rest } = splitIndex(root);
  if (rootIndex) loose.push({ title: section === 'api' ? 'Visão geral' : 'Início', url: rootIndex.url });

  for (const node of rest) {
    const item = toItem(node);
    if (!item) continue;
    if (node.type === 'folder') {
      const items = item.children ?? [];
      if (item.url) items.unshift({ title: 'Visão geral', url: item.url, method: methodByUrl.get(item.url) });
      groups.push({ title: item.title, url: item.url, items });
    } else {
      loose.push(item);
    }
  }

  if (section === 'api') {
    // “Começar” reúne visão geral e conceitos, como no desenho.
    const concepts = groups.findIndex((group) => group.url === undefined && group.items.some((item) => item.url?.startsWith('/api/conceitos')));
    const start = concepts >= 0 ? groups.splice(concepts, 1)[0].items : [];
    return [{ title: 'Começar', items: [...loose, ...start] }, ...groups];
  }
  // Como no desenho: a página inicial fica no cabeçalho, e “Principais dúvidas” mora em “Dúvidas e dicas”.
  const faq = loose.find((item) => item.url === '/docs/principais-duvidas');
  const tips = groups.find((group) => group.items.some((item) => item.url?.startsWith('/docs/duvidas-e-dicas')));
  if (faq && tips) tips.items.unshift(faq);
  const others = loose.filter((item) => item !== faq && item.url !== rootIndex?.url);
  return others.length ? [{ title: '', items: others }, ...groups] : groups;
}

export function getSiteCounts() {
  const pages = source.getPages();
  return {
    articles: pages.filter((page) => page.url.startsWith('/docs')).length,
    endpoints: pages.filter((page) => page.url.startsWith('/api') && page.data.method).length,
    news: pages.filter((page) => page.url.startsWith('/blog/')).length,
  };
}

/** Quantos documentos cada escopo do assistente consulta (mostrado enquanto ele responde). */
export function getScopeCounts() {
  const pages = source.getPages();
  const count = (prefix: string) => pages.filter((page) => page.url.startsWith(prefix)).length;
  return {
    Tudo: pages.length,
    'Ajuda e FAQ': count('/docs/'),
    API: count('/api'),
    Tutoriais: count('/tutoriais'),
    Novidades: count('/blog/'),
  };
}
