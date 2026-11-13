// Porta os roteiros v2 aprovados de `architecture/widget-guides-drafts` para as páginas MDX canônicas.
// Mantém os campos de busca da página atual e troca título, descrição, roteiro e corpo pelo rascunho.
// Uso: node scripts/port-widget-guides.mjs [--check]
import { readFile, writeFile } from 'node:fs/promises';
import { parseDocument, stringify } from 'yaml';
import { publishedGuideFromDraft } from '../lib/widget-guide-draft.mjs';

export const portedGuides = [
  ['usuario-acesso', 'principais-motivos-de-suporte/usuario-acesso.mdx'],
  ['recado-fora-do-horario', 'sobre-o-sistema/configuracoes/departamentos/recado-fora-do-horario.mdx'],
];
const content = new URL('../content/docs/docs/', import.meta.url);
const drafts = new URL('../architecture/widget-guides-drafts/', import.meta.url);
const productMap = JSON.parse(await readFile(new URL('../product-map/approved.json', import.meta.url), 'utf8'));
const normalized = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ').trim();
const mapLabels = new Set(productMap.manifest.labels.map(({ label, file }) => `${file}\u0000${normalized(label)}`));
const labelsByFile = new Map();
for (const { label, file } of productMap.manifest.labels) labelsByFile.set(file, [...(labelsByFile.get(file) ?? []), label]);

function body(draft, guide, productAction) {
  const sha = draft.source.sha.slice(0, 12);
  // O alvo é um rótulo real da tela (no mapa aprovado, no mesmo arquivo da evidência), para o
  // cálculo de impacto avisar quando o rótulo mudar. Sem rótulo verificável, usa o título do passo.
  const source = (step) => {
    const evidences = draft.evidenceByStep[step.stepId];
    for (const evidence of evidences) {
      const quoted = [...evidence.fragment.matchAll(/["'`]([^"'`$]{2,80})["'`]/gu)].map((match) => match[1]);
      const label = [...quoted, evidence.fragment].find((candidate) => mapLabels.has(`${evidence.path}\u0000${normalized(candidate)}`));
      if (label) return `{/* fonte: ${step.stepId} | front@${sha}:${evidence.path}:${evidence.line} | alvo: ${label} */}`;
    }
    // Sem rótulo no trecho citado: o rótulo mais longo do mesmo arquivo que o texto do passo menciona.
    for (const evidence of evidences) {
      const text = normalized(step.text);
      const label = (labelsByFile.get(evidence.path) ?? []).filter((candidate) => candidate.length >= 4 && text.includes(normalized(candidate)))
        .sort((left, right) => right.length - left.length)[0];
      if (label) return `{/* fonte: ${step.stepId} | front@${sha}:${evidence.path}:${evidence.line} | alvo: ${label} */}`;
    }
    // Passo editorial (orientação sem controle próprio na tela) usa o título; os demais precisam de rótulo.
    if (draft.editorialSteps?.includes(step.stepId)) return `{/* fonte: ${step.stepId} | front@${sha}:${evidences[0].path}:${evidences[0].line} | alvo: ${step.title} */}`;
    throw new Error(`${step.stepId}: nenhum rótulo do mapa aprovado nas evidências do passo`);
  };
  const handoff = guide.steps.filter((step) => step.next?.outcome === 'handoff');
  // O passo que conclui o roteiro (escolha com outcome complete) vira a seção "Como confirmar".
  const confirm = guide.steps.filter((step) => step.choices?.some((choice) => choice.outcome === 'complete'));
  // A página segue a ordem do rascunho (a do autor); o grafo fica no roteiro.
  const steps = guide.steps.filter((step) => !handoff.includes(step) && !confirm.includes(step));
  return [
    draft.description,
    '## Pré-requisitos',
    draft.prerequisites.map((item) => `- ${item}`).join('\n'),
    ...(productAction ? [productAction] : []),
    '## Passo a passo',
    steps.map((step, index) => `${index + 1}. ${step.text}\n${source(step)}`).join('\n'),
    '## Se não funcionar',
    handoff.map((step) => `${step.text}\n${source(step)}`).join('\n\n'),
    '## Como confirmar',
    confirm.map((step) => `${step.text}\n${source(step)}`).join('\n\n'),
  ].join('\n\n') + '\n';
}

export async function portedPage(id, file) {
  const raw = await readFile(new URL(file, content), 'utf8');
  const [, frontmatter, previousBody] = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u);
  const metadata = parseDocument(frontmatter).toJS();
  const draft = JSON.parse(await readFile(new URL(`${id}.json`, drafts), 'utf8'));
  const guide = publishedGuideFromDraft(draft, { mode: 'real' });
  const productAction = previousBody.match(/^<ProductAction\b.*\/>$/mu)?.[0];
  const next = { ...metadata, title: draft.title, description: draft.description, assistantOverview: draft.description, guide };
  return `---\n${stringify(next, { lineWidth: 0 })}---\n\n${body(draft, guide, productAction)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  for (const [id, file] of portedGuides) {
    const page = await portedPage(id, file);
    const target = new URL(file, content);
    if (check) {
      if (await readFile(target, 'utf8') !== page) throw new Error(`${file}: difere do rascunho v2`);
    } else await writeFile(target, page);
    console.log(`${id}: ${check ? 'confere' : 'portado'} (${file})`);
  }
}
