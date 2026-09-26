import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateCanonicalGuide } from '../lib/canonical-guides.mjs';
import { validatePublicArtifact } from '../lib/guide-package.mjs';
import approvedMap from '../product-map/approved.json' with { type: 'json' };
import { sensitiveKinds } from './sensitive-data.mjs';
import { internalLinkIssues, parseArticle, parseMdx, plainText, visit } from './editorial-standard.mjs';
import publishedBaseline from './public-label-baseline.json' with { type: 'json' };

// A mesma lista protege texto submetido ao MCP e passos dos guias submetidos.
export const jargon = Object.freeze(['template', 'API', 'Meta', 'Gupshup', 'janela de 24h', 'US$']);
const allowedHosts = new Set(['app.tango.us', 'apiv3.ihelpchat.com', 'ihelpchat.com.br', 'www.ihelpchat.com.br']);
const normalizeLabel = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
const mapLabels = new Set(approvedMap.manifest.labels.map(({ label }) => normalizeLabel(label)));
// CTA da Claricia é renderizado pelo widget público em pilot/lib/assistant.ts.
mapLabels.add(normalizeLabel('Falar com uma pessoa'));
const routes = new Set(approvedMap.manifest.routes.map(({ path }) => path));
// Conteúdo publicado anterior ao gate: exceção exata, removida ao atualizar o guia.
const publishedLabelBaseline = new Map([
  ['docs/principais-motivos-de-suporte/reconectar-canal-qr', '5af9438d1b96e027892a0d17fcb9cc124174e0a15210fdee2c62a63e71e06123'],
  ['docs/principais-motivos-de-suporte/usuario-acesso', '2694a6e6c6cf4089c49831a675a89e95696c648fe2305976c724f3010df40220'],
  ['docs/sobre-o-sistema/configuracoes/departamentos/recado-fora-do-horario', '5c398b5631d5c99b16d412ea5f85e2ab4569d3722e952ca0720ccc5f3d73e6a7'],
]);
// Radicais de ações e substantivos que identificam uma frase sobre a interface.
const UI_CUES = /\b(?:toc\w*|toq\w*|cliq\w*|cliqu\w*|apert\w*|pression\w*|selecion\w*|escolh\w*|desmarc\w*|marc\w*|acess\w*|desativ\w*|ativ\w*|preench\w*|digit\w*|entr\w*|arrast\w*|desliz\w*|abr\w*|v[aá]\s+(?:at[eé]|em|para)|bot[aã]o|aba|menu|opç[aã]o|campo|tela|[ií]cone|link|chave|caixa)\b/iu;

function checkInterfaceLabels(body) {
  const tree = parseMdx(body);
  visit(tree, (node) => {
    if (node.type !== 'paragraph') return;
    let text = '';
    const labels = [];
    for (const child of node.children ?? []) {
      const start = text.length;
      const value = plainText(child);
      text += value;
      if (child.type === 'strong' || child.type === 'inlineCode') labels.push({ value, start });
      if (child.type === 'text') for (const match of value.matchAll(/["“”]([^"“”]+)["“”]/gu)) labels.push({ value: match[1], start: start + match.index });
    }
    for (const label of labels) {
      const before = text.slice(0, label.start);
      const sentenceStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?')) + 1;
      const after = text.slice(label.start);
      const end = after.search(/[.!?](?:\s|$)/u);
      const sentence = text.slice(sentenceStart, end < 0 ? undefined : label.start + end + 1);
      if (UI_CUES.test(sentence) && !mapLabels.has(normalizeLabel(label.value))) reject(`rótulo fora do mapa: ${label.value}`);
    }
  });
}

function reject(message) { throw Object.assign(new Error(`gate público: ${message}`), { code: 'PUBLIC_GATE' }); }

function checkJargon(text) {
  for (const term of jargon) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, 'giu');
    for (const match of text.matchAll(pattern)) {
      const start = match.index + match[1].length;
      const sentence = text.slice(Math.max(0, text.lastIndexOf('.', start - 1) + 1), text.indexOf('.', start) < 0 ? undefined : text.indexOf('.', start) + 1);
      if (!/(?:\([^)]{5,}\)|\bsignifica\b|\bquer dizer\b|\bé (?:um|uma|o|a)\b)/iu.test(sentence)) reject(`jargão sem explicação: ${term}`);
    }
  }
}

export async function assertPublicSubmit(root, items, deletes = []) {
  for (const { article, rendered } of items) {
    const kinds = sensitiveKinds(rendered);
    if (kinds.credential || kinds.personal || kinds.internal || kinds.control) reject('fonte interna ou dado privado');
    if (/<(?:img|Image)\b/iu.test(article.body)) reject('print sem aprovação editorial');

    if (article.guide) {
      validatePublicArtifact(article.guide, article.path);
      validateCanonicalGuide(rendered, article.guide.guideId);
      const sources = [...rendered.matchAll(/\{\/\* fonte: ([a-z0-9-]+) \| (front|back)@([a-f0-9]{12}):([^\s|]+):(\d+) \| alvo: ([^\n]+) \*\/\}/gu)];
      if (sources.length !== article.guide.steps.length) reject('grounding incompleto');
      for (const [, , side, sha, file, , target] of sources) {
        if (sha !== (side === 'front' ? approvedMap.frontSha : approvedMap.backSha).slice(0, 12)) reject('fonte fora do mapa aprovado');
        if (!approvedMap.manifest.markers.some((entry) => target.includes(entry.id)) && !approvedMap.manifest.routes.some((entry) => target.includes(entry.path)) && !approvedMap.manifest.labels.some((entry) => target.includes(entry.label))) reject('alvo fora do mapa aprovado');
        if (!file.startsWith(side === 'front' ? 'src/' : 'Comzada.') && !file.startsWith('Controllers/')) reject('fonte fora do produto');
      }
    }

    if (article.path.startsWith('docs/') || article.path.startsWith('tutoriais/')) {
      checkJargon([article.title, article.description, article.body, ...(article.guide?.steps ?? []).map(({ text }) => text)].join('\n'));
    }
    const publishedRaw = publishedBaseline[article.path]
      ? await readFile(new URL(`../content/docs/${article.path}.mdx`, import.meta.url), 'utf8').catch(() => '')
      : '';
    const unchangedBaselineBody = publishedRaw && createHash('sha256').update(publishedRaw).digest('hex') === publishedBaseline[article.path]
      && parseArticle(publishedRaw, article.path).body === article.body;
    if (!unchangedBaselineBody && publishedLabelBaseline.get(article.path) !== createHash('sha256').update(article.body).digest('hex')) {
      for (const text of [article.body, ...(article.guide?.steps ?? []).map(({ text }) => text)]) checkInterfaceLabels(text);
    }
    const brokenLinks = await internalLinkIssues(root, article.path, article.body);
    if (brokenLinks.length) reject(brokenLinks[0]);
    for (const [raw] of article.body.matchAll(/https?:\/\/[^\s<)"']+/giu)) {
      let url;
      try { url = new URL(raw.replace(/[.,;:!?]+$/u, '')); } catch { reject('link inválido'); }
      if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password) reject('link externo proibido');
    }
    for (const match of article.body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
      const value = match[1];
      if (match[0].startsWith('!')) {
        if (!/^\/img\/help\/[A-Za-z0-9/_-]+\.(?:png|webp|jpg)$/u.test(value)) reject('print fora do catálogo público');
        try { await access(join(root, 'public', value.slice(1))); } catch { reject('print não aprovado'); }
        const published = await readFile(join(root, 'content/docs', `${article.path}.mdx`), 'utf8').catch(() => '');
        if (!published.includes(match[0])) reject('print sem aprovação editorial');
        continue;
      }
      if (value.startsWith('/')) {
        const pathname = value.split(/[?#]/u)[0];
        if (value.includes('?') || (!routes.has(pathname) && !/^\/(?:docs|api|blog|tutoriais)(?:\/|$)/u.test(pathname))) reject('link fora do catálogo público');
      } else if (value.startsWith('#') || value.startsWith('./') || value.startsWith('../') || /^[a-z0-9][a-z0-9/_-]*(?:[?#][^\s]*)?$/iu.test(value)) {
        // O validador editorial acima resolve estes links a partir da página.
      } else {
        let url;
        try { url = new URL(value); } catch { reject('link inválido'); }
        if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password) reject('link externo proibido');
      }
    }
  }
  for (const path of deletes) if (sensitiveKinds(path).internal) reject('fonte interna');
  const reviewRequired = items.some(({ article }) => Boolean(article.guide));
  return reviewRequired ? { reviewRequired: true, proofStatus: 'manual_required' } : {};
}
