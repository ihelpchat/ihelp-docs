// Direct local HTTP proof. No browser, login, production writes, or process signals.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { generatedGuideSchema } from '../architecture/conversation-v1.mjs';
import { resolveLocator } from '../lib/product-map-query.mjs';
import map from '../product-map/approved.json' with { type: 'json' };
import { retrieveContext } from '../mcp/assistant-service.mjs';
import { prepareGuideContext, validateGuideSequence } from '../mcp/generated-guide.mjs';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required; never print it');
const output = resolve(process.argv[2] ?? '/tmp/generated-guides-direct');
await mkdir(output, { recursive: true });
const questions = [
  'Como transferir um atendimento?', 'Como criar uma resposta rápida?',
  'Como adicionar um contato?', 'Como buscar um contato?', 'Como filtrar contatos?',
  'Como criar uma etiqueta?', 'Como mudar a foto do meu perfil?',
];
const repoSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
const report = { repoSha, dirty, mapFrontSha: map.frontSha, questions: [], providerCalls: [], capDenied: 0, cleanup: {} };
let count = 0;
const upstream = process.env.GUIDE_PROOF_PROVIDER_URL ?? 'https://api.openai.com';
const proxy = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (count >= 10) { report.capDenied++; response.writeHead(400).end('{"error":{"message":"proof call cap","type":"invalid_request_error"}}'); return; }
  const call = ++count;
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  await writeFile(join(output, `request-${call}.json`), JSON.stringify(payload, null, 2), { mode: 0o600 });
  try {
    const result = await fetch(`${upstream}${request.url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: request.headers.authorization }, body: JSON.stringify(payload), signal: AbortSignal.timeout(90000) });
    const body = await result.text();
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}
    report.providerCalls.push({ call, status: result.status, format: payload.text?.format?.name, model: parsed.model, usage: parsed.usage });
    // Only public documentation/model output and usage; never request headers or credentials.
    if (result.ok) await writeFile(join(output, `response-${call}.json`), JSON.stringify({ status: parsed.status, output: parsed.output, usage: parsed.usage, model: parsed.model }, null, 2), { mode: 0o600 });
    response.writeHead(result.status, { 'Content-Type': 'application/json' }).end(body);
  } catch { report.providerCalls.push({ call, status: 'transport_error' }); response.writeHead(502).end('{}'); }
});
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
const port = proxy.address().port;
Object.assign(process.env, {
  PORT: '0', DOCS_ROOT: new URL('..', import.meta.url).pathname, MCP_STATE_DIR: join(output, 'state'),
  RAILWAY_ENVIRONMENT_NAME: '', GITHUB_READ_TOKEN: '', OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
  ASSISTANT_WIDGET_ENABLED: 'true', ASSISTANT_WIDGET_COMPANY_IDS: '', ASSISTANT_WIDGET_PILOT_GUIDES: '',
  ASSISTANT_BUDGET_FILE: join(output, 'budget.json'), ASSISTANT_DAILY_LIMIT_USD: '0.50', ASSISTANT_RESERVE_USD: '0.001',
  FEEDBACK_FILE: join(output, 'feedback.jsonl'), SESSION_EVENTS_FILE: join(output, 'sessions.jsonl'), CONVERSATIONS_FILE: join(output, 'conversations.jsonl'),
});
let httpServer;
let activeReasons = [];
const warn = console.warn;
console.warn = (...args) => { if (args[0] === '[generated-guide] rejected no_documented_procedure') activeReasons.push({ reason: 'no_documented_procedure' });
  else if (args[0] === '[generated-guide] rejected') activeReasons.push({ reason: args[1], ...(args[2] ?? {}) });
  warn(...args);
};
try {
  ({ httpServer } = await import('../mcp/http-runtime.mjs'));
  if (!httpServer.listening) await once(httpServer, 'listening');
  for (const [i, question] of questions.entries()) {
    activeReasons = [];
    const sources = await retrieveContext(process.env.DOCS_ROOT, question, 8, { scope: 'Ajuda e FAQ', procedure: true });
    const context = prepareGuideContext(sources);
    const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, scope: 'Ajuda e FAQ', sessionId: `proof-guide-${i + 1}`, origin: 'app', companyId: 1 }), signal: AbortSignal.timeout(180000) });
    const result = await response.json();
    await writeFile(join(output, `answer-${i + 1}.json`), JSON.stringify(result, null, 2), { mode: 0o600 });
    let sequenceValid = true;
    if (result.generatedGuide) try { validateGuideSequence(result.generatedGuide); } catch { sequenceValid = false; }
    const valid = sequenceValid && Boolean(result.generatedGuide && generatedGuideSchema.safeParse(result.generatedGuide).success && result.generatedGuide.steps.every((step) => resolveLocator(map, step.route, step.locator).ok));
    report.questions.push({ question, status: response.status, generatedGuide: valid, guideId: result.generatedGuide?.guideId, sourcePaths: (result.sources ?? []).map(({ path }) => path), reasons: activeReasons,
      context: { sourcePaths: sources.map(({ path }) => path), documentedSteps: context.steps, candidates: context.elements.length },
      expected: i < 3 ? 'guide' : i < 5 ? 'guide_or_specific_mapping_fallback' : 'no_documented_procedure' });
  }
} finally {
  if (httpServer) { await new Promise((done) => httpServer.close(done)); report.cleanup.faq = 'closed'; }
  await new Promise((done) => proxy.close(done)); report.cleanup.proxy = 'closed';
  console.warn = warn;
  try { const ledger = JSON.parse(await readFile(join(output, 'budget.json'), 'utf8')); report.spentUsd = ledger.spent / 1000000; report.reservations = ledger.reservations; } catch { report.spentUsd = 0; }
  report.calls = count;
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
}
const correct = report.questions.length === 7 && report.questions.every((q, i) => q.status === 200 && (i < 3 ? q.generatedGuide : i < 5 ? q.generatedGuide || q.reasons.some(({ reason, sourceStepIds }) => reason === 'unmapped_procedure' && sourceStepIds?.length > 0 || ['unopened_dialog', 'alternative_target'].includes(reason)) : !q.generatedGuide && q.reasons.some(({ reason }) => reason === 'no_documented_procedure') && !q.sourcePaths.length));
console.log(JSON.stringify({ correct, calls: count, spentUsd: report.spentUsd, results: report.questions.map(({ question, generatedGuide, reasons }) => ({ question, generatedGuide, reasons })), cleanup: report.cleanup }, null, 2));
if (!correct || count > 10 || report.spentUsd > 0.50 || Object.keys(report.reservations ?? {}).length) process.exitCode = 1;
