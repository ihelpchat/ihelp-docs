// Captura inteiramente coberta pela máscara de privacidade (#E2E8F0) não vai ao redator nem à lista de capturas;
// a captura útil continua indo exatamente como antes. Harness em memória, como faq-generator-v2-integration.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../architecture/faq-regua/tarefas-ouro.json' with { type: 'json' };
import { generateFaqV2 } from './faq-generator-v2.mjs';
import { EDITORIAL_CRITERIA } from './faq-editorial-judge.mjs';
import { MASK_COLOR_RGB } from './screenshot-mask.mjs';
import { encodePng } from './fixtures/png-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const area = 'robos';
const tasks = catalog.tarefas.filter(({ modulo }) => modulo === area);
const [maskedTask, usefulTask] = tasks.map(({ id }) => id);
const editorial = { proposito: 'pagina_inteira', notas: Object.fromEntries(EDITORIAL_CRITERIA.map((id) => [id, 3])), defeitosGraves: [], naoVerificaveis: [], comentario: 'Texto claro.' };
const page = { title: 'Robôs', titleEvidenceIds: ['F1'], description: null, descriptionEvidenceIds: [],
  sections: tasks.map(({ id, tarefa }) => ({ heading: tarefa, headingEvidenceIds: ['F1'], taskId: id,
    units: [{ text: 'O campo Título do Robô identifica o cadastro na lista.', kind: 'contexto', evidenceIds: ['F1'] }] })) };
const mask = [...MASK_COLOR_RGB, 255];
const maskedPng = encodePng(64, 40, () => mask);
const usefulPng = encodePng(64, 40, (x, y) => (x > 8 && x < 56 && y > 6 && y < 34) ? [255, 255, 255, 255] : mask);
const idOf = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('captura toda mascarada fica fora do payload do redator e da lista de capturas; a útil continua', async (t) => {
  const state = await mkdtemp(join(tmpdir(), 'faq-v2-mask-'));
  t.after(() => rm(state, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({ MCP_STATE_DIR: state, QA_TARGET: 'homolog',
    GUIDE_QA_STAGING_URL: 'https://faq.example.test', GUIDE_QA_ALLOWED_HOSTS: 'faq.example.test',
    GUIDE_QA_AUTHORIZED_EMAIL: 'fixture@example.test', GUIDE_QA_AUTHORIZED_PASSWORD: 'fictional' })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  await mkdir(join(state, 'journeys', area), { recursive: true });
  await writeFile(join(state, 'journeys', area, `${idOf(maskedPng)}.png`), maskedPng);
  await writeFile(join(state, 'journeys', area, `${idOf(usefulPng)}.png`), usefulPng);
  const screenshotFor = { [maskedTask]: idOf(maskedPng), [usefulTask]: idOf(usefulPng) };
  const calls = [];
  const client = { responses: { create: async (request) => {
    calls.push(request);
    const name = request.text.format.name;
    const value = name === 'faq_page_v2' || name === 'faq_rewrite_v2' ? page
      : name === 'faq_editorial_v2' ? editorial
      : name === 'faq_facts_v2' ? { claims: JSON.parse(request.input[1].content).claims.map((claim) => ({ id: claim.id, status: 'sustentada', evidenceIds: ['F1'], reason: '', sourceMention: false })) }
      : assert.fail(`unexpected request ${name}`);
    return { status: 'completed', output_text: JSON.stringify(value), usage: { input_tokens: 100, output_tokens: 20 } };
  } } };
  const result = await generateFaqV2(root, area, { client, model: 'gpt-6-astra',
    journeyReader: async ({ task }) => ({ task, status: 'concluída', verification: { confirmed: true },
      screens: screenshotFor[task] ? [{ screenshotId: screenshotFor[task], title: 'Robôs' }] : [] }),
    contextLoader: async () => ({ screenFacts: [{ text: 'Criar robô; Título do Robô; Salvar.', kind: 'field' }] }),
    businessLoader: async () => [],
  });
  const writer = calls.find((request) => request.text.format.name === 'faq_page_v2');
  assert.ok(writer, 'o redator foi chamado');
  const content = writer.input.at(-1).content;
  const images = (Array.isArray(content) ? content : []).filter((item) => item.type === 'input_image');
  assert.deepEqual(images.map((item) => item.image_url), [`data:image/png;base64,${usefulPng.toString('base64')}`],
    'só a captura útil chega ao redator; a captura inteiramente mascarada fica fora');
  const promptText = Array.isArray(content) ? content.find((item) => item.type === 'input_text')?.text : content;
  assert.deepEqual(JSON.parse(promptText).screenshots, [{ task: usefulTask }], 'a lista de capturas do prompt tem só a útil');
  assert.deepEqual(result.screenshots.map(({ task, screenshotId }) => ({ task, screenshotId })),
    [{ task: usefulTask, screenshotId: idOf(usefulPng) }], 'o resultado lista só a captura útil, inalterada');
});
