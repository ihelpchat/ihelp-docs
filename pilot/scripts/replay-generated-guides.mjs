// Replay public captured replies locally: no provider SDK, network, or environment credentials.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { validateGeneratedGuide } from '../mcp/generated-guide.mjs';
import { retrieveContext } from '../mcp/assistant-service.mjs';
import { resolveLocator } from '../lib/product-map-query.mjs';
import map from '../product-map/approved.json' with { type: 'json' };
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: replay-generated-guides.mjs CAPTURE_DIRECTORY OUTPUT_JSON');
const captured = JSON.parse(await readFile(join(resolve(input), 'report.json'), 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'guide-offline-replay-'));
let fakeSafetyCalls = 0;
const client = { responses: { create: async payload => {
  if (payload.text?.format?.name !== 'seguranca_resposta') throw Error('Only deterministic safety stub is allowed');
  fakeSafetyCalls++;
  return { status: 'completed', usage: { input_tokens: 0, output_tokens: 0 }, output_text: '{"mentionsSource":false,"unsupportedAction":false}' };
} } };
const report = {
  repoSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  capturedSha: captured.repoSha, mapFrontSha: map.frontSha, providerCalls: 0, spentUsd: 0, questions: [],
  targets: {
    newShortcut: resolveLocator(map, '/configuracoes/atalhos', { kind: 'button', name: 'Novo atalho' }).ok,
    emptyShortcut: resolveLocator(map, '/configuracoes/atalhos', { kind: 'button', name: 'Novo atalho — Nenhum atalho criado' }).ok,
    phone: resolveLocator(map, '/contact', { kind: 'field', name: 'Telefone', within: 'dialog' }).ok,
  },
};
try {
  for (const [index, previous] of captured.questions.entries()) {
    const reply = JSON.parse(await readFile(join(resolve(input), `answer-${index + 1}.json`), 'utf8'));
    const sources = await retrieveContext(new URL('..', import.meta.url).pathname, previous.question, 8, { scope: 'Ajuda e FAQ', procedure: true });
    const row = { question: previous.question, recordedGenerated: Boolean(reply.generatedGuide), accepted: false, sourcePaths: sources.map(source => source.path) };
    if (reply.generatedGuide) {
      try {
        await validateGeneratedGuide(reply.generatedGuide, { map, client, documentedSteps: sources.flatMap(source => source.documentedSteps), budget: { file: join(temporary, 'budget.json') } });
        row.accepted = true;
      } catch (error) { row.reason = error.message; if (error.stepId) row.stepId = error.stepId; }
    } else {
      row.reason = previous.reasons?.[0]?.reason ?? 'recorded_text';
      row.recordedReasons = previous.reasons;
      if (index === 2) row.note = 'Recorded model refusal retained; Telefone now resolves, but no new selection was requested.';
    }
    report.questions.push(row);
  }
  report.fakeSafetyCalls = fakeSafetyCalls;
  // These are replay expectations, not a new real-provider acceptance claim.
  const expected = ['accepted', 'unopened_dialog', 'unmapped_procedure', 'alternative_target', 'accepted', 'no_documented_procedure', 'no_documented_procedure'];
  report.correct = report.questions.length === 7 && report.questions.every((row, index) => (row.accepted ? 'accepted' : row.reason) === expected[index]) && Object.values(report.targets).every(Boolean);
  await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.correct) process.exitCode = 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
