import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/server';
import { buildServer } from './server.mjs';
import { atualizarPorDeploy } from './update-by-deploy.mjs';
import { readArticle } from './editorial-standard.mjs';
import { renderArticle } from './content-service.mjs';
import { assertPublicSubmit } from './public-submit-gate.mjs';

const sha = (letter) => letter.repeat(40);
const route = (index) => ({ path: `/guide-${index}`, label: `Guia ${index}` });
const snapshot = (letter, routes) => ({ frontSha: sha(letter), backSha: sha('b'), manifest: { routes, labels: [], markers: [], permissions: [] } });
const guides = Array.from({ length: 7 }, (_, index) => ({ pathSegments: ['docs', `guide-${index}`], title: `Guia ${index}`,
  guide: { guideId: `guide-${index}`, steps: [{ stepId: 'open', actionId: `action-${index}` }] } }));
const actions = Object.fromEntries(guides.map((_, index) => [`action-${index}`, { route: `/guide-${index}` }]));
const before = snapshot('a', guides.map((_, index) => route(index)));
const after = snapshot('c', guides.map((_, index) => ({ ...route(index), label: `Atualizado ${index}` })));
const article = (index) => ({ path: `docs/guide-${index}`, title: `Guia ${index}`, description: 'Orientação pública completa para a pessoa usar o iHelp com segurança.',
  source: 'produto', contentType: 'guia', body: 'Texto público de exemplo para a revisão editorial do guia no iHelp. '.repeat(15) });

function harness() {
  const pulls = new Map();
  const writes = [];
  const dependencies = {
    package: async () => ({ catalog: { guides }, sources: {} }), actions,
    read: async (_, path) => article(Number(path.split('-').at(-1))),
    submit: async (_, items, mode, actor, deletes, options) => {
      assert.equal(mode, 'pull_request');
      const current = pulls.get(options.branch);
      if (current) return { ...current, reused: true };
      writes.push({ items, mode, actor, deletes, options });
      const pull = { status: 'pull_request', branch: options.branch, url: `https://github.com/ihelpchat/ihelp-docs/pull/${pulls.size + 1}` };
      pulls.set(options.branch, pull);
      return pull;
    },
  };
  const run = (input, overrides = {}) => atualizarPorDeploy('/fixture', { before, after, requestedBy: 'service:deploy', ...input }, { ...dependencies, ...overrides });
  return { run, writes, pulls };
}

const once = harness();
const first = await once.run({});
assert.equal(first.proposals.length, 5);
assert.equal(once.pulls.size, 5);
assert.equal(first.pending.filter((reason) => reason.includes('excedeu o teto')).length, 2);
const second = await once.run({});
assert.equal(once.pulls.size, 5, 'evento repetido não cria segunda PR');
assert.deepEqual(second.proposals.map(({ branch }) => branch), first.proposals.map(({ branch }) => branch));
const parallel = harness();
await Promise.all([parallel.run({}), parallel.run({})]);
assert.equal(parallel.pulls.size, 5, 'eventos paralelos usam uma PR por guia');
assert.equal(parallel.writes.length, 5, 'segundo evento concorrente não escreve');

const noImpact = harness();
const empty = await noImpact.run({ after: snapshot('c', before.manifest.routes) });
assert.equal(empty.status, 'sem impacto');
assert.equal(noImpact.writes.length, 0);
const direct = await atualizarPorDeploy({ before, after: snapshot('c', before.manifest.routes), requestedBy: 'service:deploy' }, {
  package: async () => ({ catalog: { guides }, sources: {} }), actions,
});
assert.equal(direct.status, 'sem impacto', 'assinatura pública aceita o objeto do evento');

const mismatch = harness();
const wrongProof = await mismatch.run({ prova: { mode: 'staging', appSha: sha('d'), authorized: 'passed', denied: 'passed', steps: [] } });
assert.ok(wrongProof.pending.some((reason) => reason.includes(`prova no navegador pendente para ${sha('c')}`)));
assert.ok(mismatch.writes.every(({ options }) => options.draft === true && options.body.includes('prova no navegador pendente')));
const verifiedFlag = await harness().run({ prova: { verificado: true, appSha: sha('d') } });
assert.ok(verifiedFlag.pending.some((reason) => reason.includes('prova no navegador pendente')));

const rejected = harness();
const gate = await rejected.run({}, { submit: async () => { throw Error('PUBLIC_GATE: rótulo fora do mapa'); } });
assert.ok(gate.pending.some((reason) => reason.includes('PUBLIC_GATE: rótulo fora do mapa')));
assert.equal(rejected.pulls.size, 0);

const invalid = await harness().run({ after: { ...after, frontSha: 'inválido' } });
assert.ok(invalid.pending.some((reason) => reason.includes('snapshot inválido em frontSha')));

const registered = new Map();
const originalRegister = McpServer.prototype.registerTool;
McpServer.prototype.registerTool = function (name, config, callback) {
  registered.set(name, config);
  return originalRegister.call(this, name, config, callback);
};
try { buildServer('/fixture'); } finally { McpServer.prototype.registerTool = originalRegister; }
assert.equal(registered.get('atualizar_por_deploy')?.mutates, true, 'ferramenta entra na derivação de escrita');
const root = new URL('../', import.meta.url).pathname;
const canonical = await readArticle(root, 'docs/principais-motivos-de-suporte/usuario-acesso');
const note = `\n\n{/* Revisão editorial pendente: front ${sha('c')}; back ${sha('b')}; atualizar route. */}`;
const reviewOnly = { ...canonical, body: canonical.body + note };
await assertPublicSubmit(root, [{ article: reviewOnly, rendered: renderArticle(reviewOnly) }]);
const changedText = { ...reviewOnly, body: `${canonical.body}\n\nClique em Botão imaginário.${note}` };
await assert.rejects(assertPublicSubmit(root, [{ article: changedText, rendered: renderArticle(changedText) }]), /frase não aprovada|rótulo fora do mapa/u);
console.log('Atualização por deploy: idempotência, teto, proof, gate e política OK');
