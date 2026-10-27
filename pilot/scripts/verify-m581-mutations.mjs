import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

assert.ok(process.env.MAC_RESOURCE_SESSION, 'executar pela fila mac-build-control');
const planner = 'mcp/journey-plans/index.mjs';
const runtime = 'mcp/journey-runtime.mjs';
const sessionTest = 'mcp/journey-areas-m581-session.test.mjs';
const mutations = [
  { name: 'ID alheio na escrita', file: planner,
    before: '&& owns(context.fixedIds?.self, body.assigneeUserId) && uuid(body.idRef)',
    after: '&& uuid(body.idRef)', test: 'mcp/journey-areas-m581.test.mjs', pattern: 'nega envio' },
  ...[1, 2].map((position) => ({ name: `posição arbitrária ${position}`, file: planner,
    before: "step.nameFrom === 'selfOption' ? screen.state?.sessionUserOption",
    after: `step.nameFrom === 'selfOption' ? 'opção ${position}'`, test: sessionTest, pattern: 'Tarefas usa' })),
  { name: 'troca entre observação e clique', file: runtime,
    before: "  if (selfId != null && action.role === 'option' && fresh.state.sessionUserOption !== action.name) throw changed();",
    after: '', test: sessionTest, pattern: 'Tarefas usa' },
  { name: 'falso sucesso com responsável alheio', file: planner,
    before: '    && (!selfField || owns(context.fixedIds?.self, row[selfField]))',
    after: '', test: sessionTest, pattern: 'criação só confirma' },
  { name: 'chips CRM ocultos pelo label', file: runtime,
    before: "      : node.tagName === 'BUTTON' && ['Estágio inicial', 'Responsável'].includes(visual(node))\n        && node.getAttribute('title') ? node.getAttribute('title')\n",
    after: '', test: sessionTest, pattern: 'CRM observa' },
];
for (const mutation of mutations) {
  const original = await readFile(mutation.file, 'utf8');
  const digest = createHash('sha256').update(original).digest('hex');
  const mutated = original.replace(mutation.before, mutation.after);
  assert.notEqual(mutated, original, `${mutation.name}: alvo ausente`);
  try {
    await writeFile(mutation.file, mutated);
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec',
      `--test-name-pattern=${mutation.pattern}`, mutation.test], { encoding: 'utf8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.status, 1, `${mutation.name}: mutação sobreviveu ou ambiente inválido\n${output}`);
    assert.match(output, /ERR_ASSERTION/u, `${mutation.name}: RED sem asserção\n${output}`);
    console.log(`MUTATION: ${mutation.name} -> KILLED por asserção`);
  } finally {
    await writeFile(mutation.file, original);
    assert.equal(createHash('sha256').update(await readFile(mutation.file)).digest('hex'), digest);
    console.log(`RESTORED: ${mutation.file} SHA256 ${digest}`);
  }
}
console.log(`PASS: ${mutations.length} mutações detectadas e restauradas; CLEANUP: OK`);
