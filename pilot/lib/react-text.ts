import { isValidElement, type ReactNode } from 'react';

/** Texto puro de uma árvore React já renderizada pelo MDX. */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}

/** Primeiro href encontrado na árvore. */
export function firstHref(node: ReactNode): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = firstHref(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ href?: string; children?: ReactNode }>(node)) return undefined;
  if (typeof node.props.href === 'string') return node.props.href;
  return firstHref(node.props.children);
}
