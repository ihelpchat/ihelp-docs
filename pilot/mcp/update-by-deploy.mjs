import { createHash } from 'node:crypto';
import { compileGuidePackage } from '../lib/guide-package.mjs';
import { calculateGuideImpact } from '../lib/guide-impact.mjs';
import actions from '../architecture/product-actions.json' with { type: 'json' };
import { readArticle } from './editorial-standard.mjs';
import { submitContentPackage } from './content-service.mjs';
import { proofOutcome } from '../scripts/guide-proof.mjs';

export const MAX_DEPLOY_PULLS = 5;
let queue = Promise.resolve();
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const shaText = ({ frontSha, backSha }) => `front ${frontSha}; back ${backSha}`;

async function execute(root, { before, after, prova, base = 'integration/claricia-v2', requestedBy = 'service:deploy' }, deps) {
  const pending = [];
  const proposals = [];
  let impact;
  let catalog;
  try {
    catalog = await (deps.package ?? compileGuidePackage)(root);
    impact = (deps.impact ?? calculateGuideImpact)({ before, after, guides: catalog.catalog.guides,
      actions: deps.actions ?? actions, sources: catalog.sources });
  } catch (error) {
    return { status: 'pendente', proposals, pending: [`impacto: ${error.message}`] };
  }
  pending.push(...impact.pending);
  if (impact.pending.some((reason) => reason.includes('snapshot inválido'))) return { status: 'pendente', proposals, pending, shas: impact.shas };
  const grouped = new Map();
  for (const change of impact.proposals) {
    if (change.kind === 'criar') { pending.push(`criar guia pendente para ${change.key}`); continue; }
    if (!grouped.has(change.guideId)) grouped.set(change.guideId, []);
    grouped.get(change.guideId).push(change);
  }
  if (!grouped.size) return { status: pending.length ? 'pendente' : 'sem impacto', proposals, pending, shas: impact.shas };
  const affectedGuides = [...grouped.keys()].map(guideId => catalog.catalog.guides.find(({ guide: item }) => item.guideId === guideId)).filter(Boolean);
  const outcome = proofOutcome(prova, { guides: affectedGuides, appSha: after.frontSha });
  const proofReason = outcome.ok ? null : `prova no navegador pendente para ${after.frontSha}: ${outcome.pending.join('; ')}`;
  if (proofReason) pending.push(proofReason);
  for (const [index, [guideId, changes]] of [...grouped].entries()) {
    if (index >= MAX_DEPLOY_PULLS) { pending.push(`${guideId}: excedeu o teto de ${MAX_DEPLOY_PULLS} PRs por evento`); continue; }
    const guide = catalog.catalog.guides.find(({ guide: item }) => item.guideId === guideId);
    if (!guide) { pending.push(`${guideId}: guia não encontrado no pacote`); continue; }
    const branch = `docs/deploy-${guideId}-${digest({ guideId, frontSha: after.frontSha, backSha: after.backSha })}`;
    const reason = changes.map(({ kind, dependency, reason: cause }) => `${kind}: ${dependency} (${cause})`).join('; ');
    const body = `Proposta editorial para ${guideId}.\n\nSHAs implantados: ${shaText(after)}.\nImpacto: ${reason}.\n${proofReason ?? `Prova no navegador: staging ${prova.appSha}.`}\n\nRevisão humana obrigatória. Sem aprovação ou merge automático.`;
    try {
      const path = guide.pathSegments.join('/');
      const original = await (deps.read ?? readArticle)(root, path);
      const note = `\n\n{/* Revisão editorial pendente: ${shaText(after)}; ${changes.map(({ kind, dependency }) => `${kind} ${dependency}`).join(', ')}. */}`;
      const article = { ...original, body: `${original.body}${note}` };
      const submitted = await (deps.submit ?? submitContentPackage)(root, [article], 'pull_request', requestedBy, [], {
        branch, base, draft: true, title: `docs: revisar ${guideId} após deploy`, body,
      });
      proposals.push({ guideId, branch, url: submitted.url, reused: Boolean(submitted.reused) });
    } catch (error) {
      pending.push(`${guideId}: ${error.code ? `${error.code}: ` : ''}${error.message}`);
    }
  }
  return { status: pending.length ? 'pendente' : 'propostas', proposals, pending, shas: impact.shas };
}

export function atualizarPorDeploy(rootOrInput, inputOrDeps, maybeDeps = {}) {
  const root = typeof rootOrInput === 'string' ? rootOrInput : new URL('../', import.meta.url).pathname;
  const input = typeof rootOrInput === 'string' ? inputOrDeps : rootOrInput;
  const deps = typeof rootOrInput === 'string' ? maybeDeps : inputOrDeps ?? {};
  const work = queue.then(() => execute(root, input, deps));
  queue = work.then(() => undefined, () => undefined);
  return work;
}
