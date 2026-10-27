import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { assertPublicSubmit } from './public-submit-gate.mjs';
import { parseArticle } from './editorial-standard.mjs';
import baseline from './public-submit-baseline.json' with { type: 'json' };

const root = new URL('../', import.meta.url).pathname;
const path = 'docs/sobre-o-sistema/configuracoes/canais';
const adopted = await readFile(new URL(`../content/docs/${path}.mdx`, import.meta.url), 'utf8');
const unmarked = adopted.replace(/^---\nmcpGeneratedSha: [a-f0-9]{40}\n/u, '---\n');
assert.notEqual(adopted, unmarked, 'página real deve ter passado pela adoção explícita');
assert.equal(createHash('sha256').update(unmarked).digest('hex'), baseline[path], 'adoção só acrescenta o marcador ao conteúdo publicado');
const item = (rendered) => {
  const { metadata, body } = parseArticle(rendered, path);
  return { article: { path, ...metadata, body }, rendered };
};
await assertPublicSubmit(root, [item(adopted)]);
await assert.rejects(assertPublicSubmit(root, [item(adopted)], [], { ignoreBaseline: true }),
  /rótulo fora do mapa/u, 'controle: página legada depende do baseline, sem afrouxar o gate');
for (const [field, changed] of [
  ['body', `${adopted}\nTexto adicional sobre o produto.\n`],
  ['title', adopted.replace('title: "Canais"', 'title: "Canais atualizados"')],
]) {
  assert.notEqual(changed, adopted);
  await assert.rejects(assertPublicSubmit(root, [item(changed)]), /rótulo fora do mapa/u,
    `${field}: marcador não libera mudança semântica em página legada`);
}
console.log('Marcador: baseline preservado; alteração semântica no body/title exige revalidação');
