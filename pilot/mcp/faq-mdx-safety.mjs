import { createProcessor } from '@mdx-js/mdx';

const processor = createProcessor();
const allowedElements = {
  AConfirmar: new Set(),
  ProductAction: new Set(['id', 'label', 'route', 'target']),
  TutorialCard: new Set(['compact', 'title', 'url', 'description']),
};

function parseMarkdown(source) {
  try {
    return processor.parse(source);
  } catch (error) {
    throw new Error(`MDX inválido na montagem: ${error.message}`);
  }
}

function textOf(node) {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') return node.value;
  if (node.type === 'break') return ' ';
  return (node.children ?? []).map(textOf).join(node.type === 'root' ? ' ' : '');
}

export function plainMarkdownText(source) {
  return textOf(parseMarkdown(String(source))).replace(/\s+/gu, ' ').trim();
}

export function validateFaqMdx(source) {
  const tree = parseMarkdown(String(source));
  function inspect(node) {
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression')
      throw new Error('expressão MDX proibida na montagem');
    if (node.type === 'mdxjsEsm') throw new Error('ESM proibido no MDX da montagem');
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      const attributes = allowedElements[node.name];
      if (!attributes || node.attributes.some((attribute) => attribute.type !== 'mdxJsxAttribute'
        || !attributes.has(attribute.name) || (attribute.value !== null && typeof attribute.value !== 'string')))
        throw new Error(`elemento JSX proibido no MDX da montagem: ${node.name}`);
    }
    if (node.type === 'text' && /\*\*|__|`/u.test(node.value))
      throw new Error('marcador de formatação solto no MDX renderizado');
    for (const child of node.children ?? []) inspect(child);
  }
  inspect(tree);
  return textOf(tree);
}
