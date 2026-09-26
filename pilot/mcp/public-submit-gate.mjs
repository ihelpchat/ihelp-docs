import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCanonicalGuide } from '../lib/canonical-guides.mjs';
import { validatePublicArtifact } from '../lib/guide-package.mjs';
import approvedMap from '../product-map/approved.json' with { type: 'json' };
import { sensitiveKinds } from './sensitive-data.mjs';

// A mesma lista protege texto submetido ao MCP e passos dos guias submetidos.
export const jargon = Object.freeze(['template', 'API', 'Meta', 'Gupshup', 'janela de 24h', 'US$']);
const allowedHosts = new Set(['app.tango.us', 'apiv3.ihelpchat.com', 'ihelpchat.com.br', 'www.ihelpchat.com.br']);
const mapLabels = new Set(approvedMap.manifest.labels.map(({ label }) => label.toLocaleLowerCase('pt-BR')));
const routes = new Set(approvedMap.manifest.routes.map(({ path }) => path));

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
    for (const match of article.body.matchAll(/\b(?:botão|botao)\s+["“]([^"”]+)["”]/giu)) {
      if (!mapLabels.has(match[1].toLocaleLowerCase('pt-BR'))) reject(`rótulo fora do mapa: ${match[1]}`);
    }
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
        if (value.includes('?') || value.includes('#') || (!routes.has(value) && !value.startsWith('/docs/') && !value.startsWith('/api/') && !value.startsWith('/tutoriais/'))) reject('link fora do catálogo público');
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
