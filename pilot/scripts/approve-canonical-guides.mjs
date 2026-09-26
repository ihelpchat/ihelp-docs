import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { approvedTextEntries } from '../lib/canonical-guides.mjs';

const files = [
  ['principais-motivos-de-suporte/reconectar-canal-qr.mdx', 'reconectar-canal-qr'],
  ['principais-motivos-de-suporte/usuario-acesso.mdx', 'usuario-acesso'],
  ['sobre-o-sistema/configuracoes/departamentos/recado-fora-do-horario.mdx', 'recado-fora-do-horario'],
];
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const content = option('--content-dir', new URL('../content/docs/docs/', import.meta.url).pathname);
const output = option('--output', new URL('../content/canonical-guides.approved.json', import.meta.url).pathname);
if (!content || !output) throw new Error('--content-dir e --output exigem um caminho');

function differences(before, after) {
  const lengths = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let left = before.length - 1; left >= 0; left--) {
    for (let right = after.length - 1; right >= 0; right--) {
      lengths[left][right] = before[left].hash === after[right].hash
        ? lengths[left + 1][right + 1] + 1
        : Math.max(lengths[left + 1][right], lengths[left][right + 1]);
    }
  }
  const output = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left].hash === after[right].hash) {
      left++;
      right++;
    } else {
      const removed = [];
      const added = [];
      while (left < before.length || right < after.length) {
        if (left < before.length && right < after.length && before[left].hash === after[right].hash) break;
        if (left < before.length && (right === after.length || lengths[left + 1][right] >= lengths[left][right + 1])) removed.push(before[left++]);
        else added.push(after[right++]);
      }
      for (let index = 0; index < Math.max(removed.length, added.length); index++) {
        output.push({ before: removed[index], after: added[index] });
      }
    }
  }
  return output;
}

let previous;
try { previous = JSON.parse(await readFile(output, 'utf8')); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  previous = { guides: {} };
}
const guides = {};
let added = 0;
let changed = 0;
let removed = 0;
for (const [file, id] of files) {
  const entries = approvedTextEntries(await readFile(join(content, file), 'utf8'), id);
  guides[id] = entries;
  const old = previous.guides?.[id] ?? [];
  for (const { before, after } of differences(old, entries)) {
    if (before && after) {
      changed++;
      console.log(`${id}: alterada: ${before.sentence} => ${after.sentence}`);
    } else if (after) {
      added++;
      console.log(`${id}: nova: ${after.sentence}`);
    } else {
      removed++;
      console.log(`${id}: removida: ${before.sentence}`);
    }
  }
}
const difference = added + changed + removed;
const approval = {
  aprovadoPor: difference ? 'pendente: Bruno' : previous.aprovadoPor,
  aprovadoEm: difference ? null : previous.aprovadoEm ?? null,
  geradoEm: difference ? new Date().toISOString() : previous.geradoEm,
  guides,
};
const lines = [
  '{',
  `  "aprovadoPor": ${JSON.stringify(approval.aprovadoPor)},`,
  `  "aprovadoEm": ${JSON.stringify(approval.aprovadoEm)},`,
  `  "geradoEm": ${JSON.stringify(approval.geradoEm)},`,
  '  "guides": {',
  ...files.flatMap(([, id], index) => [
    `    ${JSON.stringify(id)}: [`,
    ...guides[id].map((entry, entryIndex) => `      ${JSON.stringify(entry)}${entryIndex < guides[id].length - 1 ? ',' : ''}`),
    `    ]${index < files.length - 1 ? ',' : ''}`,
  ]),
  '  }',
  '}',
];
await writeFile(output, `${lines.join('\n')}\n`);
console.log(`novas: ${added}, alteradas: ${changed}, removidas: ${removed}`);
